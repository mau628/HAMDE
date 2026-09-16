import { expect, test, type Page } from '@playwright/test'

import { installFakePicker, TINY_PNG } from './support/installFakePicker'

/**
 * Images are rendered only when they come from the folder the user opened.
 * Everything else stays as Markdown source — see tests/e2e/security.spec.ts for
 * why a remote one is never fetched.
 */

const FOLDER = {
  'note.md': '# Note\n\n![a picture](picture.png)\n\ntail\n',
  'picture.png': TINY_PNG,
  notes: {
    'nested.md': '# Nested\n\n![up here](../picture.png)\n\n![beside me](local.png)\n\ntail\n',
    'local.png': TINY_PNG,
  },
  'text.md': '# Text\n\n![not an image](note.md)\n\ntail\n',
}

async function open(page: Page, file: string, folder = 'notes') {
  await installFakePicker(page, FOLDER)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()
  if (file.includes('/')) await page.getByRole('button', { name: folder, exact: true }).click()
  await page.getByRole('button', { name: file.split('/').pop()!, exact: true }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
}

test('renders an image from the workspace', async ({ page }) => {
  await open(page, 'note.md')

  const image = page.locator('.cm-md-image__img')
  await expect(image).toBeVisible()

  // A blob: URL, which is the only image source the CSP allows.
  const source = await image.getAttribute('src')
  expect(source).toMatch(/^blob:/)
  expect(await image.getAttribute('alt')).toBe('a picture')
})

test('resolves a path relative to the document, not to the folder root', async ({ page }) => {
  await open(page, 'notes/nested.md')

  // "local.png", beside the document, renders.
  await expect(page.locator('.cm-md-image__img')).toHaveCount(1)

  // "../picture.png" climbs out of the folder the user granted, so it is not
  // resolved at all and stays as Markdown — not even reported as missing, since
  // nothing was looked for.
  const shown = (await page.locator('.cm-line').allInnerTexts()).join(' ')
  expect(shown).toContain('![up here](../picture.png)')
})

test('refuses a file that is not an image', async ({ page }) => {
  await open(page, 'text.md')

  await expect(page.locator('.cm-md-image__missing')).toContainText('note.md')
  await expect(page.locator('.cm-md-image__img')).toHaveCount(0)
})

test('shows the Markdown source when the cursor is on the line', async ({ page }) => {
  await open(page, 'note.md')
  await expect(page.locator('.cm-md-image__img')).toBeVisible()

  // The rendered image is all the line contains, so the image is what to click.
  await page.locator('.cm-md-image').click()

  await expect(page.locator('.cm-md-image')).toHaveCount(0)
  await expect(page.locator('.cm-content')).toContainText('![a picture](picture.png)')
})

test('the document keeps the image syntax', async ({ page }) => {
  await open(page, 'note.md')
  await page.keyboard.type('Appended.')
  await expect(page.locator('.status__state')).toHaveText('Saved')

  const saved = await page.evaluate(
    () => (window as unknown as { __writtenFiles: Map<string, string> }).__writtenFiles.get('note.md'),
  )
  expect(saved).toContain('![a picture](picture.png)')
})
