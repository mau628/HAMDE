import { expect, test, type Page } from '@playwright/test'

import { installFakePicker } from './support/installFakePicker'

const DOCUMENT = [
  '# Title',
  '',
  'Text with **bold** and *italic* words.',
  '',
  '> A quotation.',
  '',
  '- first item',
  '- second item',
  '',
  'A [link](https://example.com) in a line.',
  '',
].join('\n')

const FOLDER = { 'note.md': DOCUMENT }

/** What the editor shows, which is not what the document contains. */
async function visibleText(page: Page): Promise<string> {
  return (await page.locator('.cm-line').allInnerTexts()).join('\n')
}

async function open(page: Page) {
  await installFakePicker(page, FOLDER)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name: 'note.md' }).click()
  await expect(page.locator('.status__path')).toHaveText('note.md')
  // Put the cursor on the last, empty line so nothing is revealed.
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
}

/** Clicks in the middle of the first line whose text contains `text`. */
async function clickLine(page: Page, text: string) {
  await page.locator('.cm-line', { hasText: text }).first().click()
}

test('renders Markdown instead of showing its syntax', async ({ page }) => {
  await open(page)
  const shown = await visibleText(page)

  expect(shown).toContain('Title')
  expect(shown).not.toContain('# Title')
  expect(shown).toContain('Text with bold and italic words.')
  expect(shown).toContain('A quotation.')
  expect(shown).not.toContain('> A quotation.')
  expect(shown).toContain('• first item')
  expect(shown).toContain('A link in a line.')
  expect(shown).not.toContain('https://example.com')
})

test('reveals the syntax of the line the cursor is on, and only that line', async ({ page }) => {
  await open(page)

  await clickLine(page, 'bold')

  const shown = await visibleText(page)
  expect(shown).toContain('**bold**')
  expect(shown).toContain('*italic*')
  // Other lines stay rendered.
  expect(shown).not.toContain('# Title')
  expect(shown).toContain('A quotation.')
})

test('re-renders the previous line when the cursor moves away', async ({ page }) => {
  await open(page)

  await clickLine(page, 'bold')
  expect(await visibleText(page)).toContain('**bold**')

  await clickLine(page, 'quotation')
  const shown = await visibleText(page)
  expect(shown).not.toContain('**bold**')
  expect(shown).toContain('> A quotation.')
})

test('reveals a heading marker without resizing the text', async ({ page }) => {
  await open(page)
  const heading = page.locator('.cm-md-h1').first()
  const renderedSize = await heading.evaluate((node) => getComputedStyle(node).fontSize)

  await clickLine(page, 'Title')

  await expect(page.locator('.cm-line', { hasText: '# Title' })).toBeVisible()
  const revealedSize = await page.locator('.cm-md-h1').first().evaluate(
    (node) => getComputedStyle(node).fontSize,
  )
  expect(revealedSize).toBe(renderedSize)
})

test('headings are visually larger than body text', async ({ page }) => {
  await open(page)

  const headingSize = await page
    .locator('.cm-md-h1')
    .first()
    .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))
  const bodySize = await page
    .locator('.cm-line', { hasText: 'A quotation.' })
    .first()
    .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))

  expect(headingSize).toBeGreaterThan(bodySize)
})

test('the document still contains the Markdown that is hidden on screen', async ({ page }) => {
  await open(page)

  await page.keyboard.type('Appended.')
  await expect(page.locator('.status__state')).toHaveText('Saved')

  const written = await page.evaluate(
    () => (window as unknown as { __writtenFiles: Map<string, string> }).__writtenFiles.get('note.md'),
  )

  // Everything the preview hid is still in the file, unchanged.
  expect(written).toContain('# Title')
  expect(written).toContain('**bold**')
  expect(written).toContain('> A quotation.')
  expect(written).toContain('[link](https://example.com)')
  expect(written).toContain('Appended.')
})

test('arrow keys step over hidden syntax instead of stalling in it', async ({ page }) => {
  await open(page)

  // Land on the line, then leave it again so its syntax is hidden once more.
  await clickLine(page, 'first item')
  await page.keyboard.press('Home')
  await clickLine(page, 'quotation')
  await clickLine(page, 'first item')
  await page.keyboard.press('Home')

  // From the start of the line, one ArrowRight must move past the hidden bullet
  // marker rather than into it.
  const before = await cursorOffset(page)
  await page.keyboard.press('ArrowRight')
  const after = await cursorOffset(page)

  expect(after).toBeGreaterThan(before)
})

test('typing into rendered text edits the right place in the document', async ({ page }) => {
  await open(page)

  await clickLine(page, 'A quotation.')
  await page.keyboard.press('End')
  await page.keyboard.type(' Added.')
  await expect(page.locator('.status__state')).toHaveText('Saved')

  const written = await page.evaluate(
    () => (window as unknown as { __writtenFiles: Map<string, string> }).__writtenFiles.get('note.md'),
  )

  // The quote marker is untouched and the text landed inside the quote.
  expect(written).toContain('> A quotation. Added.')
})

test('Ctrl+click opens a link, and a plain click does not', async ({ page, context }) => {
  await open(page)

  await clickLine(page, 'A link in a line.')
  expect(context.pages()).toHaveLength(1)

  const opened = context.waitForEvent('page')
  await page.locator('.cm-md-link').first().click({ modifiers: ['ControlOrMeta'] })
  const tab = await opened

  expect(tab.url()).toBe('https://example.com/')
  await tab.close()
})

test('does not open a javascript: link', async ({ page, context }) => {
  await installFakePicker(page, { 'evil.md': '[click me](javascript:alert(1))\n' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name: 'evil.md' }).click()
  await expect(page.locator('.status__path')).toHaveText('evil.md')

  const dialogs: string[] = []
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })

  await page.locator('.cm-content').click({ modifiers: ['ControlOrMeta'], position: { x: 30, y: 10 } })
  await page.waitForTimeout(200)

  expect(dialogs).toEqual([])
  expect(context.pages()).toHaveLength(1)
})

test('undo restores the document, not the rendering', async ({ page }) => {
  await open(page)

  await clickLine(page, 'A quotation.')
  await page.keyboard.press('End')
  await page.keyboard.type(' Added.')
  expect(await visibleText(page)).toContain('Added.')

  await page.keyboard.press('ControlOrMeta+z')
  expect(await visibleText(page)).not.toContain('Added.')
})

test('heading styling is applied once, not compounded', async ({ page }) => {
  await open(page)

  const sizes = await page.locator('.cm-md-h1').first().evaluate((line) => ({
    line: Number.parseFloat(getComputedStyle(line).fontSize),
    spans: [...line.querySelectorAll('span')].map((span) =>
      Number.parseFloat(getComputedStyle(span).fontSize),
    ),
  }))

  // A font-size rule on a heading token nests inside the line's own rule and the
  // two multiply. Every span inside the heading must simply inherit the line size.
  for (const span of sizes.spans) expect(span).toBeCloseTo(sizes.line, 1)
})

test('decorates only the viewport, however long the document is', async ({ page }) => {
  const lines = Array.from({ length: 5000 }, (_, index) =>
    index % 5 === 0
      ? '## Heading ' + index
      : 'Line ' + index + ' with **bold**, *italic*, `code` and [a link](https://example.com).',
  )
  await installFakePicker(page, { 'big.md': lines.join('\n') + '\n' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name: 'big.md' }).click()
  await expect(page.locator('.cm-md-h2').first()).toBeVisible()

  // Inline decorations come from a view plugin, which only sees the viewport. If
  // that ever changes, this count explodes and so does the cost per keystroke.
  expect(await page.locator('.cm-line').count()).toBeLessThan(200)

  await page.locator('.cm-content').click()
  await page.keyboard.type('typed')
  expect(await page.locator('.cm-line').count()).toBeLessThan(200)
})

test('live preview issues no network request', async ({ page }) => {
  const external: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== 'localhost') external.push(request.url())
  })

  await open(page)
  await clickLine(page, 'bold')

  expect(external).toEqual([])
})

/** The cursor's position in the document, read from the editor's own state. */
async function cursorOffset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const selection = window.getSelection()
    if (selection === null || selection.rangeCount === 0) return -1
    const range = selection.getRangeAt(0)
    const line = (range.startContainer as Node & { parentElement: HTMLElement | null }).parentElement
      ?.closest('.cm-line')
    if (line === null || line === undefined) return -1

    // Offset within the visible line is enough to tell movement from stalling.
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    let offset = 0
    let node = walker.nextNode()
    while (node !== null) {
      if (node === range.startContainer) return offset + range.startOffset
      offset += node.textContent?.length ?? 0
      node = walker.nextNode()
    }
    return offset
  })
}
