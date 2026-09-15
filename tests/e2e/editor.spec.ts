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

  expect(await editorText(page)).toContain('Typed. # YAMDE')
})

test('undoes and redoes an edit', async ({ page }) => {
  await openEditor(page)
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type('zzprobe')
  expect(await editorText(page)).toContain('zzprobe')

  await page.keyboard.press('ControlOrMeta+z')
  expect(await editorText(page)).not.toContain('zzprobe')

  await page.keyboard.press('ControlOrMeta+Shift+z')
  expect(await editorText(page)).toContain('zzprobe')
})

test('continues a list when Enter is pressed', async ({ page }) => {
  await openEditor(page)

  // Put the cursor at the end of the "- Apple" line and add a sibling item.
  await page.getByText('- Apple', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Banana')

  expect(await editorText(page)).toContain('- Banana')
})

test('keeps the Markdown source intact rather than rendering it away', async ({ page }) => {
  await openEditor(page)

  // The document must still contain its own syntax: the editor decorates, it does
  // not transform. Live preview (M5) hides marks visually, never in the document.
  const text = await editorText(page)
  expect(text).toContain('**bold**')
  expect(text).toContain('# YAMDE')
})
