import { expect, test, type Page } from '@playwright/test'

import { dropFiles, droppedWrites, installDropSupport } from './support/dropFiles'
import { installFakePicker } from './support/installFakePicker'

const FOLDER = {
  'README.md': '# Readme\n\nRoot note.\n',
}

const LOOSE = { name: 'loose.md', contents: '# Loose\n\nFrom the desktop.\n' }

async function start(page: Page, options: { folder?: boolean } = {}) {
  await installDropSupport(page)
  await installFakePicker(page, FOLDER)
  await page.goto('/')
  if (options.folder) {
    await page.getByRole('button', { name: 'Open Folder' }).click()
    await expect(page.getByRole('button', { name: 'README.md' })).toBeVisible()
  }
}

test('opens a dropped file in a section of its own, apart from the folder', async ({ page }) => {
  await start(page, { folder: true })

  await dropFiles(page, [LOOSE])

  const section = page.getByRole('region', { name: 'Outside the folder' })
  await expect(section.getByRole('button', { name: 'loose.md' })).toBeVisible()
  // Not listed in the folder's tree.
  await expect(page.locator('.explorer__tree').first().getByText('loose.md')).toBeHidden()

  await expect(page.locator('.cm-content')).toContainText('From the desktop.')
  await expect(page.locator('.status__path')).toHaveText('loose.md (dropped file)')
})

test('works with no folder open', async ({ page }) => {
  await start(page)

  await dropFiles(page, [LOOSE])

  await expect(page.getByRole('region', { name: 'Dropped files' })).toBeVisible()
  await expect(page.locator('.cm-content')).toContainText('From the desktop.')
})

test('does not paste the dropped file into the open document', async ({ page }) => {
  await start(page, { folder: true })
  await page.getByRole('button', { name: 'README.md' }).click()
  await expect(page.locator('.cm-content')).toContainText('Root note.')

  await dropFiles(page, [LOOSE])

  await expect(page.locator('.cm-content')).toContainText('From the desktop.')
  await page.getByRole('button', { name: 'README.md' }).click()
  await expect(page.locator('.cm-content')).not.toContainText('From the desktop.')
})

test('opens read-only until editing is allowed, then saves to the file', async ({ page }) => {
  await start(page)
  await dropFiles(page, [LOOSE])

  await expect(page.getByRole('region', { name: 'Read-only document' })).toBeVisible()
  await expect(page.locator('.status__state')).toHaveText('Read-only')

  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('Ignored.')
  await expect(page.locator('.cm-content')).not.toContainText('Ignored.')

  await page.getByRole('button', { name: 'Allow editing' }).click()
  await expect(page.getByRole('region', { name: 'Read-only document' })).toBeHidden()

  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('Edited here.')
  await expect(page.locator('.status__state')).toHaveText('Saved')

  const written = await droppedWrites(page)
  expect(written['loose.md']).toContain('Edited here.')
  expect(written['loose.md']).toContain('# Loose')
})

test('opens editable straight away when writing is already allowed', async ({ page }) => {
  await start(page)
  await dropFiles(page, [{ ...LOOSE, permission: 'granted' }])

  await expect(page.locator('.cm-content')).toContainText('From the desktop.')
  await expect(page.getByRole('region', { name: 'Read-only document' })).toBeHidden()
})

test('stays read-only when the browser refuses to allow writing', async ({ page }) => {
  await start(page)
  await dropFiles(page, [{ ...LOOSE, grantOnRequest: false }])

  await page.getByRole('button', { name: 'Allow editing' }).click()

  await expect(page.getByText('The browser did not allow writing to it.')).toBeVisible()
  await expect(page.locator('.status__state')).toHaveText('Read-only')
})

test('lists several dropped files and skips what is not Markdown', async ({ page }) => {
  await start(page, { folder: true })

  await dropFiles(page, [
    LOOSE,
    { name: 'photo.png', contents: 'not markdown' },
    { name: 'second.md', contents: '# Second\n' },
  ])

  const section = page.getByRole('region', { name: 'Outside the folder' })
  await expect(section.getByRole('button', { name: 'loose.md' })).toBeVisible()
  await expect(section.getByRole('button', { name: 'second.md' })).toBeVisible()
  await expect(page.getByText('Only Markdown files can be opened. Skipped photo.png.')).toBeVisible()

  // The first one dropped is the one opened.
  await expect(page.locator('.cm-content')).toContainText('From the desktop.')
  await section.getByRole('button', { name: 'second.md' }).click()
  await expect(page.locator('.cm-content')).toContainText('Second')
})

test('closes a dropped file and takes it off the list', async ({ page }) => {
  await start(page, { folder: true })
  await dropFiles(page, [LOOSE])

  const section = page.getByRole('region', { name: 'Outside the folder' })
  await section.getByRole('button', { name: 'loose.md' }).hover()
  await section.getByRole('button', { name: 'Close' }).click()

  await expect(section).toBeHidden()
  await expect(page.locator('.cm-content')).not.toContainText('From the desktop.')
})

test('keeps a dropped file open when the folder is closed', async ({ page }) => {
  await start(page, { folder: true })
  await dropFiles(page, [LOOSE])

  await page.getByRole('button', { name: 'Close folder' }).click()

  await expect(page.getByRole('region', { name: 'Dropped files' })).toBeVisible()
  await expect(page.locator('.cm-content')).toContainText('From the desktop.')
})

test('shows a drop target while files are dragged over the page', async ({ page }) => {
  await start(page, { folder: true })

  await page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['x'], 'x.md'))
    document.querySelector('.cm-content')!.dispatchEvent(
      new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }),
    )
  })
  await expect(page.getByText('Drop a Markdown file to open it')).toBeVisible()
  await expect(page.getByText('Files from outside notes are listed apart from it.')).toBeVisible()
})
