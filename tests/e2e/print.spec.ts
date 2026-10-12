import { expect, test, type Page } from '@playwright/test'

import { installFakePicker, TINY_PNG } from './support/installFakePicker'

/**
 * Printing. The print dialog is the browser's and cannot be driven, so `window.print`
 * is replaced by something that writes down what the page looked like at the moment
 * it would have been printed. The styles for paper are checked separately, by asking
 * the browser to lay the page out as it would for a printer.
 */

const BODY_LINES = 800

const LONG = [
  '# Title',
  '',
  ...Array.from({ length: BODY_LINES }, (_, index) => 'Line ' + (index + 1)),
  '',
  '![a picture](picture.png)',
  '',
  '## The end',
  '',
].join('\n')

const DIAGRAM = ['# Diagram', '', '```mermaid', 'graph TD', '    A[Start] --> B[Stop]', '```', '', 'tail', ''].join(
  '\n',
)

const FOLDER = { 'long.md': LONG, 'diagram.md': DIAGRAM, 'picture.png': TINY_PNG }

interface Printed {
  lines: number
  first: string
  text: string
  title: string
  images: boolean[]
  pending: number
  diagrams: string[]
}

const printed = (page: Page) =>
  page.evaluate(() => (window as unknown as { __printed: Printed[] }).__printed)

async function open(page: Page, name: string, theme?: 'dark') {
  await installFakePicker(page, FOLDER)
  await page.addInitScript((chosen) => {
    if (chosen !== undefined) localStorage.setItem('hamde-theme', chosen)

    const seen: Printed[] = []
    Object.assign(window, { __printed: seen })

    window.print = () => {
      const content = document.querySelector('.cm-content')!
      seen.push({
        lines: content.querySelectorAll('.cm-line').length,
        first: content.querySelector('.cm-line')?.textContent ?? '',
        text: content.textContent ?? '',
        title: document.title,
        images: [...content.querySelectorAll<HTMLImageElement>('img.cm-md-image__img')].map(
          (image) => image.complete && image.naturalWidth > 0,
        ),
        pending: content.querySelectorAll('.cm-md-diagram--pending').length,
        diagrams: [...content.querySelectorAll('.cm-md-diagram svg')].map((svg) => svg.outerHTML),
      })
    }
  }, theme)

  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.locator('.status__path')).toHaveText(name)

  // Cursor on the first line, which is therefore shown as source.
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+Home')
  await expect(page.locator('.cm-line').first()).toHaveText(/^# /)
}

test('the print button prints the whole document, rendered', async ({ page }) => {
  await open(page, 'long.md')

  // On screen only what is visible is drawn, and the image at the end is not.
  expect(await page.locator('.cm-line').count()).toBeLessThan(BODY_LINES)
  await expect(page.locator('.cm-md-image__img')).toHaveCount(0)

  await page.getByRole('button', { name: 'Print' }).click()
  await expect.poll(async () => (await printed(page)).length).toBe(1)

  const [paper] = await printed(page)

  expect(paper!.lines).toBeGreaterThan(BODY_LINES)
  expect(paper!.text).toContain('Line ' + BODY_LINES)
  // No line shows its syntax, the cursor's included.
  expect(paper!.first).toBe('Title')
  expect(paper!.text).toContain('The end')
  expect(paper!.text).not.toContain('## The end')
  // The image was waited for.
  expect(paper!.images).toEqual([true])
  // A saved PDF is named after the file.
  expect(paper!.title).toBe('long')
})

test('the editor is as it was once the print is over', async ({ page }) => {
  await open(page, 'long.md')
  const title = await page.title()

  await page.getByRole('button', { name: 'Print' }).click()
  await expect.poll(async () => (await printed(page)).length).toBe(1)

  await expect(page.locator('.cm-line').first()).toHaveText('# Title')
  await expect.poll(() => page.locator('.cm-line').count()).toBeLessThan(BODY_LINES)
  expect(await page.title()).toBe(title)

  // The document was never touched.
  await expect(page.locator('.status__state')).not.toHaveText(/Saving|Unsaved/)
})

test('Ctrl+P prints, wherever the focus is', async ({ page }) => {
  await open(page, 'long.md')

  await page.keyboard.press('ControlOrMeta+p')
  await expect.poll(async () => (await printed(page)).length).toBe(1)

  await page.getByRole('button', { name: 'Collapse sidebar' }).focus()
  await page.keyboard.press('ControlOrMeta+p')
  await expect.poll(async () => (await printed(page)).length).toBe(2)

  expect((await printed(page))[1]!.lines).toBeGreaterThan(BODY_LINES)
})

test('a print from the browser menu shows no syntax either', async ({ page }) => {
  await open(page, 'long.md')

  // Drawing the whole document for such a print is CodeMirror's own doing; hiding
  // the syntax of the cursor's line is what this app adds to it.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
  await expect(page.locator('.cm-line').first()).toHaveText('Title')

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(page.locator('.cm-line').first()).toHaveText('# Title')
})

test('only the document goes on paper', async ({ page }) => {
  await open(page, 'long.md')
  await page.emulateMedia({ media: 'print' })

  await expect(page.locator('.shell__explorer')).toBeHidden()
  await expect(page.locator('.editor__tools')).toBeHidden()
  await expect(page.locator('.status')).toBeHidden()
  await expect(page.locator('.cm-content')).toBeVisible()

  // Nothing is cut off by a box that scrolls: the editor is as tall as its text.
  const clipped = await page
    .locator('.cm-scroller')
    .evaluate((scroller) => scroller.scrollHeight > scroller.clientHeight + 1)
  expect(clipped).toBe(false)
})

test('paper is light when the screen is dark', async ({ page }) => {
  await open(page, 'long.md', 'dark')

  const colours = () =>
    page.locator('.cm-editor').evaluate((editor) => {
      const style = getComputedStyle(editor)
      return { background: style.backgroundColor, text: style.color }
    })

  expect(await colours()).toEqual({ background: 'rgb(28, 28, 27)', text: 'rgb(232, 232, 228)' })

  await page.emulateMedia({ media: 'print' })
  expect(await colours()).toEqual({ background: 'rgb(255, 255, 255)', text: 'rgb(31, 31, 29)' })
})

test('the page margins follow the width of the editor', async ({ page }) => {
  await open(page, 'long.md')
  await page.emulateMedia({ media: 'print' })

  const margins = await page.evaluate(() => {
    const found: Record<string, string> = {}
    for (const sheet of document.styleSheets) {
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSPageRule) found[rule.selectorText] = rule.style.margin
      }
    }
    return found
  })
  expect(margins).toEqual({ 'hamde-narrow': '3.18cm', 'hamde-wide': '2.54cm' })

  const pageOf = () => page.locator('.editor').evaluate((editor) => getComputedStyle(editor).page)

  expect(await pageOf()).toBe('hamde-narrow')

  await page.emulateMedia({ media: 'screen' })
  await page.getByRole('button', { name: 'Wide editor' }).click()
  await page.emulateMedia({ media: 'print' })

  expect(await pageOf()).toBe('hamde-wide')
})

test('a diagram drawn for a dark screen is drawn again for paper', async ({ page }) => {
  await open(page, 'diagram.md', 'dark')

  const onScreen = page.locator('.cm-md-diagram svg')
  await expect(onScreen).toBeVisible()
  // Mermaid's light theme fills a node with this colour; its dark theme does not.
  const LIGHT_NODE = /#ececff/i
  expect(await onScreen.evaluate((svg) => svg.outerHTML)).not.toMatch(LIGHT_NODE)

  await page.getByRole('button', { name: 'Print' }).click()
  await expect.poll(async () => (await printed(page)).length).toBe(1)

  const [paper] = await printed(page)
  expect(paper!.pending).toBe(0)
  expect(paper!.diagrams).toHaveLength(1)
  expect(paper!.diagrams[0]).toMatch(LIGHT_NODE)

  // And the screen has its own back.
  await expect(onScreen).toBeVisible()
  expect(await onScreen.evaluate((svg) => svg.outerHTML)).not.toMatch(LIGHT_NODE)
})
