import { expect, test, type Page } from '@playwright/test'

import { installFakePicker } from './support/installFakePicker'

const FOLDER = {
  'note.md': '# Note\n\nOriginal body.\n',
  'other.md': '# Other\n',
}

/** What the app has written through the file system API, by path. */
async function writtenFiles(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries(
      (window as unknown as { __writtenFiles: Map<string, string> }).__writtenFiles,
    ),
  )
}

/** Advances a file timestamp behind the app's back, as another program would. */
async function touchOnDisk(page: Page, path: string): Promise<void> {
  await page.evaluate(
    (target) => (window as unknown as { __touchFile: (path: string) => void }).__touchFile(target),
    path,
  )
}

async function openNote(page: Page, name = 'note.md') {
  await installFakePicker(page, FOLDER)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name }).click()
  await expect(page.locator('.status__path')).toHaveText(name)
  await page.locator('.cm-content').click()
}

test('writes an edit to disk after the debounce', async ({ page }) => {
  await openNote(page)

  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('Added by the test.')

  await expect(page.locator('.status__state')).toHaveText('Saved')

  const files = await writtenFiles(page)
  expect(files['note.md']).toContain('Added by the test.')
  // The rest of the document survives the write untouched.
  expect(files['note.md']).toContain('# Note')
})

test('shows unsaved, then saving, then saved', async ({ page }) => {
  await openNote(page)
  await expect(page.locator('.status__state')).toHaveText('Saved')

  await page.keyboard.type('x')
  await expect(page.locator('.status__state')).toHaveText('Unsaved changes')

  await expect(page.locator('.status__state')).toHaveText('Saved')
})

test('does not write while the user is still typing', async ({ page }) => {
  await openNote(page)

  // Keystrokes closer together than the 500 ms quiet period.
  for (const character of 'abcdefgh') {
    await page.keyboard.type(character)
    await page.waitForTimeout(80)
  }

  expect(await writtenFiles(page)).toEqual({})

  await expect(page.locator('.status__state')).toHaveText('Saved')
  const files = await writtenFiles(page)
  // One write for the whole burst, containing every character.
  expect(Object.keys(files)).toEqual(['note.md'])
  expect(files['note.md']).toContain('abcdefgh')
})

test('Ctrl+S writes immediately and suppresses the browser save dialog', async ({ page }) => {
  await openNote(page)

  await page.keyboard.type('saved by hand')
  await page.keyboard.press('ControlOrMeta+s')

  // No waiting for the debounce: the file is on disk already.
  await expect.poll(async () => (await writtenFiles(page))['note.md']).toContain('saved by hand')
  await expect(page.locator('.status__state')).toHaveText('Saved')
})

test('saves before switching to another document', async ({ page }) => {
  await openNote(page)

  await page.keyboard.type('pending text')
  // Switch straight away, well inside the debounce window.
  await page.getByRole('button', { name: 'other.md' }).click()

  await expect(page.locator('.status__path')).toHaveText('other.md')

  const files = await writtenFiles(page)
  expect(files['note.md']).toContain('pending text')
})

test('saves when the window loses focus', async ({ page }) => {
  await openNote(page)

  await page.keyboard.type('typed then blurred')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))

  await expect.poll(async () => (await writtenFiles(page))['note.md']).toContain(
    'typed then blurred',
  )
})

test('saves when the tab is hidden', async ({ page }) => {
  await openNote(page)

  await page.keyboard.type('typed then hidden')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })

  await expect.poll(async () => (await writtenFiles(page))['note.md']).toContain(
    'typed then hidden',
  )
})

test('reopening a document shows what was saved, not what was on disk before', async ({ page }) => {
  await openNote(page)

  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('Second paragraph.')
  await expect(page.locator('.status__state')).toHaveText('Saved')

  await page.getByRole('button', { name: 'other.md' }).click()
  await expect(page.locator('.status__path')).toHaveText('other.md')

  await page.getByRole('button', { name: 'note.md' }).click()
  await expect(page.locator('.cm-content')).toContainText('Second paragraph.')
})

test('keeps saving across consecutive edits without a false conflict', async ({ page }) => {
  await openNote(page)

  for (const word of ['first', 'second', 'third']) {
    await page.keyboard.type(' ' + word)
    await expect(page.locator('.status__state')).toHaveText('Saved')
  }

  const files = await writtenFiles(page)
  expect(files['note.md']).toContain('first second third')
})

test('reports a conflict instead of overwriting a file that changed on disk', async ({ page }) => {
  await openNote(page)

  // Simulate another program saving the file: the stamp the app holds is stale.
  await touchOnDisk(page, 'note.md')

  await page.keyboard.type('mine')

  await expect(page.locator('.status')).toHaveClass(/status--conflict/)
  await expect(page.locator('.status__state')).toContainText('Changed outside the editor')

  // Nothing was written, and the text is still in the editor.
  expect(await writtenFiles(page)).toEqual({})
  await expect(page.locator('.cm-content')).toContainText('mine')
})

test('does not leave the document while its text cannot be saved', async ({ page }) => {
  await openNote(page)

  await touchOnDisk(page, 'note.md')
  await page.keyboard.type('mine')
  await expect(page.locator('.status')).toHaveClass(/status--conflict/)

  await page.getByRole('button', { name: 'other.md' }).click()

  // Still on note.md: switching would have discarded the unsaved text.
  await expect(page.locator('.status__path')).toHaveText('note.md')
  await expect(page.locator('.cm-content')).toContainText('mine')
})

test('saving issues no network request', async ({ page }) => {
  const external: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== 'localhost') external.push(request.url())
  })

  await openNote(page)
  await page.keyboard.type('offline edit')
  await expect(page.locator('.status__state')).toHaveText('Saved')

  expect(external).toEqual([])
})
