import { expect, test, type Page } from '@playwright/test'

import { installFakePicker } from './support/installFakePicker'

const FOLDER = {
  'note.md': '# Note\n\nOriginal body.\n',
  'other.md': '# Other\n',
}

async function writtenFiles(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries(
      (window as unknown as { __writtenFiles: Map<string, string> }).__writtenFiles,
    ),
  )
}

/** Rewrites the file behind the app's back, as another editor would. */
async function editOnDisk(page: Page, path: string, contents: string): Promise<void> {
  await page.evaluate(
    ([target, text]) =>
      (
        window as unknown as { __editFileOnDisk: (path: string, contents: string) => void }
      ).__editFileOnDisk(target!, text!),
    [path, contents],
  )
}

async function openNote(page: Page) {
  await installFakePicker(page, FOLDER)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name: 'note.md' }).click()
  await expect(page.locator('.status__path')).toHaveText('note.md')
  await page.locator('.cm-content').click()
}

/** Gets the app into a conflict: the file changed on disk, and the user typed. */
async function reachConflict(page: Page) {
  await openNote(page)
  await editOnDisk(page, 'note.md', '# Note\n\nWritten by another program.\n')

  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('Typed here.')

  await expect(page.locator('.conflict')).toBeVisible()
}

test('opening a document writes nothing', async ({ page }) => {
  await openNote(page)

  // Long enough for the debounce to have fired if loading counted as an edit.
  await page.waitForTimeout(900)

  expect(await writtenFiles(page)).toEqual({})
  await expect(page.locator('.status__state')).toHaveText('Saved')
})

test('switching documents writes neither of them', async ({ page }) => {
  await openNote(page)
  await page.getByRole('button', { name: 'other.md' }).click()
  await expect(page.locator('.status__path')).toHaveText('other.md')
  await page.waitForTimeout(900)

  expect(await writtenFiles(page)).toEqual({})
})

test('offers Reload and Overwrite when the file changed outside the editor', async ({ page }) => {
  await reachConflict(page)

  await expect(page.locator('.conflict__message')).toContainText('changed outside the editor')
  await expect(page.locator('.conflict').getByRole('button', { name: /Reload/ })).toBeVisible()
  await expect(page.locator('.conflict').getByRole('button', { name: /Overwrite/ })).toBeVisible()

  // Nothing has been written while the user decides.
  expect(await writtenFiles(page)).toEqual({})
})

test('shows no conflict bar during normal editing', async ({ page }) => {
  await openNote(page)
  await page.keyboard.type('plain edit')
  await expect(page.locator('.status__state')).toHaveText('Saved')

  await expect(page.locator('.conflict')).toBeHidden()
})

test('Reload replaces the editor with what is on disk and writes nothing', async ({ page }) => {
  await reachConflict(page)

  await page.locator('.conflict').getByRole('button', { name: /Reload/ }).click()

  await expect(page.locator('.cm-content')).toContainText('Written by another program.')
  await expect(page.locator('.cm-content')).not.toContainText('Typed here.')
  await expect(page.locator('.conflict')).toBeHidden()
  await expect(page.locator('.status__state')).toHaveText('Saved')
  expect(await writtenFiles(page)).toEqual({})
})

test('Reload leaves the discarded text recoverable with undo', async ({ page }) => {
  await reachConflict(page)

  await page.locator('.conflict').getByRole('button', { name: /Reload/ }).click()
  await expect(page.locator('.cm-content')).toContainText('Written by another program.')

  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+z')

  // The user can still get their own text back, which is why Reload replaces the
  // document through an undoable transaction.
  await expect(page.locator('.cm-content')).toContainText('Typed here.')
})

test('saving works normally after a Reload', async ({ page }) => {
  await reachConflict(page)
  await page.locator('.conflict').getByRole('button', { name: /Reload/ }).click()
  await expect(page.locator('.conflict')).toBeHidden()

  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('After reload.')

  await expect(page.locator('.status__state')).toHaveText('Saved')
  const files = await writtenFiles(page)
  expect(files['note.md']).toContain('After reload.')
  expect(files['note.md']).toContain('Written by another program.')
})

test('Overwrite writes the editor version over the file', async ({ page }) => {
  await reachConflict(page)

  await page.locator('.conflict').getByRole('button', { name: /Overwrite/ }).click()

  await expect(page.locator('.conflict')).toBeHidden()
  await expect(page.locator('.status__state')).toHaveText('Saved')

  const files = await writtenFiles(page)
  expect(files['note.md']).toContain('Typed here.')
  expect(files['note.md']).not.toContain('Written by another program.')
})

test('saving works normally after an Overwrite', async ({ page }) => {
  await reachConflict(page)
  await page.locator('.conflict').getByRole('button', { name: /Overwrite/ }).click()
  await expect(page.locator('.conflict')).toBeHidden()

  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' More.')

  await expect(page.locator('.status__state')).toHaveText('Saved')
  expect((await writtenFiles(page))['note.md']).toContain('Typed here. More.')
})

test('leaves the document only once the conflict is resolved', async ({ page }) => {
  await reachConflict(page)

  await page.getByRole('button', { name: 'other.md' }).click()
  await expect(page.locator('.status__path')).toHaveText('note.md')

  await page.locator('.conflict').getByRole('button', { name: /Overwrite/ }).click()
  await expect(page.locator('.conflict')).toBeHidden()

  await page.getByRole('button', { name: 'other.md' }).click()
  await expect(page.locator('.status__path')).toHaveText('other.md')
})

test('resolving a conflict issues no network request', async ({ page }) => {
  const external: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== 'localhost') external.push(request.url())
  })

  await reachConflict(page)
  await page.locator('.conflict').getByRole('button', { name: /Overwrite/ }).click()
  await expect(page.locator('.conflict')).toBeHidden()

  expect(external).toEqual([])
})
