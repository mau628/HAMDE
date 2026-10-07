#!/usr/bin/env node
/**
 * Uses the extension the way a person does: opens files in a real VS Code, types in
 * the editor, saves, undoes, and looks at what ended up on disk.
 *
 * This is the one test in which both halves of the extension run together. The
 * webview's side of the protocol is tested as a page (tests/e2e/vscodeWebview.spec.ts)
 * and the extension's side inside VS Code (test/smoke); only here does a key press
 * travel all the way from the webview to a file.
 *
 * Playwright drives VS Code's window directly, which is how it can reach into the
 * webview. Which VS Code is in ./environment.mjs.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { _electron as electron } from '@playwright/test'
import { downloadAndUnzipVSCode } from '@vscode/test-electron'

import { createScratch, executable, extensionPath, version } from './environment.mjs'

/** A one-pixel PNG. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const REDO = process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y'

const { scratch, workspace, profile, extensions, remove } = await createScratch()

// A repository-shaped workspace: the document and its image in sibling folders.
await mkdir(join(workspace, 'docs'))
await mkdir(join(workspace, 'assets'))
await writeFile(join(workspace, 'assets', 'pixel.png'), PIXEL)
// One level above the workspace: reachable by path, and not to be read.
await writeFile(join(scratch, 'outside.png'), PIXEL)
// The images are not on the first line: that is where the cursor starts, and the
// line the cursor is on shows its source instead of the picture.
await writeFile(
  join(workspace, 'docs', 'guide.md'),
  'Guide\n\n![inside](../assets/pixel.png)\n\n![outside](../../outside.png)\n',
)

// Windows line endings, to see that typing and saving leave them alone.
const note = join(workspace, 'note.md')
await writeFile(note, 'first\r\nsecond\r\n')

const failures = []

async function step(name, action) {
  try {
    await action()
    console.log('  ok    ' + name)
  } catch (error) {
    console.log('  FAIL  ' + name + '\n        ' + (error?.message ?? error))
    failures.push(name)
  }
}

/** Waits for a value to become what is expected, and says what it was if not. */
async function expectEventually(read, expected, timeout = 20_000) {
  const deadline = Date.now() + timeout
  let actual
  for (;;) {
    actual = await read()
    if (actual === expected) return
    if (Date.now() > deadline) {
      throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

const app = await electron.launch({
  executablePath:
    executable ??
    // The same download the smoke tests use, wherever this is run from.
    (await downloadAndUnzipVSCode({ version, cachePath: join(extensionPath, '.vscode-test') })),
  args: [
    workspace,
    '--user-data-dir=' + profile,
    // An empty folder: without it VS Code would load the extensions you have installed.
    '--extensions-dir=' + extensions,
    '--extensionDevelopmentPath=' + extensionPath,
    '--disable-workspace-trust',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--no-sandbox',
    '--disable-gpu-sandbox',
  ],
})

try {
  const window = await app.firstWindow()
  await window.waitForSelector('.monaco-workbench', { timeout: 60_000 })

  // The editor is two frames down: VS Code's webview, then the extension's page.
  const editor = window
    .frameLocator('iframe.webview.ready')
    .frameLocator('iframe#active-frame')
    .locator('.cm-content')
  const shown = async () => (await editor.locator('.cm-line').allTextContents()).join('\n')
  const onDisk = () => readFile(note, 'utf8')

  const item = (name) => window.getByRole('treeitem', { name, exact: true })

  /**
   * Opens a file from the Explorer, as a person would.
   *
   * VS Code picks the editor for a file from what it knows at that moment, and for
   * the first seconds of a first start it has not heard of the extension yet: the
   * file opens as text. So until HAMDE shows up, close the tab and open it again.
   */
  async function open(name) {
    const deadline = Date.now() + 90_000
    for (;;) {
      await item(name).click()
      if (await editor.waitFor({ timeout: 5_000 }).then(() => true, () => false)) return
      if (Date.now() > deadline) throw new Error(name + ' never opened in HAMDE')
      await window.locator('.tab', { hasText: name }).locator('.codicon-close').click()
    }
  }

  await item('docs').click()
  await open('guide.md')

  await step('an image in a sibling folder is shown', async () => {
    const image = editor.locator('.cm-md-image__img')
    await expectEventually(() => image.evaluate((element) => element.naturalWidth), 1)
  })

  await step('an image outside the workspace is not read', async () => {
    await expectEventually(
      () => editor.locator('.cm-md-image__missing').textContent(),
      'Image not found: ../../outside.png',
    )
  })

  // Closed with the keyboard from inside the webview: VS Code's own shortcuts have
  // to keep working while the editor has the focus.
  await editor.click()
  await window.keyboard.press('ControlOrMeta+W')
  await editor.waitFor({ state: 'detached' })
  await open('note.md')

  await step('the document is shown', async () => {
    await expectEventually(shown, 'first\nsecond\n')
  })

  await step('typing reaches VS Code, which marks the file modified', async () => {
    await editor.click()
    await window.keyboard.press('ControlOrMeta+End')
    await window.keyboard.type('third')

    await expectEventually(shown, 'first\nsecond\nthird')
    await expectEventually(async () => (await window.locator('.tab.dirty').count()) > 0, true)
  })

  await step('saving writes it, and the file keeps its CRLF line endings', async () => {
    await window.keyboard.press('ControlOrMeta+S')
    await expectEventually(onDisk, 'first\r\nsecond\r\nthird')
  })

  await step('a new line is written with the file’s own line ending', async () => {
    await window.keyboard.press('Enter')
    await window.keyboard.type('fourth')
    await expectEventually(shown, 'first\nsecond\nthird\nfourth')

    await window.keyboard.press('ControlOrMeta+S')
    await expectEventually(onDisk, 'first\r\nsecond\r\nthird\r\nfourth')
  })

  await step('undo, typed in the editor, undoes exactly one edit', async () => {
    await window.keyboard.type('!')
    await expectEventually(shown, 'first\nsecond\nthird\nfourth!')

    await window.keyboard.press('ControlOrMeta+Z')
    await expectEventually(shown, 'first\nsecond\nthird\nfourth')
    // Twice would have taken more; give a second undo time to show itself.
    await window.waitForTimeout(500)
    await expectEventually(shown, 'first\nsecond\nthird\nfourth')
  })

  await step('redo brings it back', async () => {
    await window.keyboard.press(REDO)
    await expectEventually(shown, 'first\nsecond\nthird\nfourth!')
  })

  await step('the editor and the file still agree after undo and redo', async () => {
    await window.keyboard.type('?')
    await window.keyboard.press('ControlOrMeta+S')
    await expectEventually(onDisk, 'first\r\nsecond\r\nthird\r\nfourth!?')
  })

  await step('a change made on disk appears in the editor', async () => {
    // Not in the same instant as the save above. A file rewritten within
    // milliseconds of VS Code's own write is one VS Code's document can miss
    // altogether, and on Windows the file may still be locked then.
    await window.waitForTimeout(1500)
    await writeFile(note, 'replaced on disk\r\n')
    await expectEventually(shown, 'replaced on disk\n')
  })
} catch (error) {
  console.log('  FAIL  could not drive VS Code\n        ' + (error?.stack ?? error))
  failures.push('setup')
} finally {
  await app.close().catch(() => {})
  await remove()
}

if (failures.length > 0) {
  console.error(failures.length + ' editing test(s) failed')
  process.exit(1)
}
console.log('  editing tests passed')
