import { expect, test, type Page } from '@playwright/test'

/**
 * Reads the document back out of the editor.
 *
 * CodeMirror renders one element per line, so joining them reproduces the source.
 * Only the rendered viewport exists in the DOM, which is fine for these short
 * documents.
 */
async function editorText(page: Page): Promise<string> {
  return (await page.locator('.cm-line').allInnerTexts()).join('\n')
}

async function openEditor(page: Page) {
  await page.goto('/')
  await expect(page.locator('.cm-content')).toBeVisible()
  await page.locator('.cm-content').click()
}

test('loads the document and applies syntax highlighting', async ({ page }) => {
  const violations: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') violations.push(message.text())
  })

  await openEditor(page)

  await expect(page.locator('.cm-content')).toContainText('A local Markdown editor')
  // CodeMirror injects its stylesheet at runtime; this asserts the CSP tolerates it.
  expect(violations).toEqual([])
  // Highlighting comes from the syntax tree, so any styled span proves the parser ran.
  await expect(page.locator('.cm-content .ͼ1, .cm-content span[class]').first()).toBeVisible()
})

test('types text into the document', async ({ page }) => {
  await openEditor(page)
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type('Typed. ')

  await expect.poll(() => editorText(page)).toContain('Typed. # HAMDE')
})

test('undoes and redoes an edit', async ({ page }) => {
  await openEditor(page)
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type('zzprobe')
  await expect.poll(() => editorText(page)).toContain('zzprobe')

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => editorText(page)).not.toContain('zzprobe')

  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => editorText(page)).toContain('zzprobe')
})

test('continues a list when Enter is pressed', async ({ page }) => {
  await openEditor(page)

  // The list marker renders as a bullet, so the line reads "• Apple" on screen.
  await page.locator('.cm-line', { hasText: 'Apple' }).first().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Banana')

  // The new item carries a marker of its own: on the cursor's line it shows as
  // source, which is how we know the keymap inserted "- " and not just a newline.
  await expect.poll(() => editorText(page)).toContain('- Banana')
})

test('keeps the Markdown source in the document, revealed on the cursor line', async ({ page }) => {
  await openEditor(page)
  await page.keyboard.press('ControlOrMeta+End')

  // Rendered: the syntax is hidden, not removed.
  await expect.poll(() => editorText(page)).not.toContain('**bold**')

  // The document still holds it, and putting the cursor on the line shows it again.
  await page.locator('.cm-line', { hasText: 'Text can be' }).first().click()
  await expect.poll(() => editorText(page)).toContain('**bold**')
})
