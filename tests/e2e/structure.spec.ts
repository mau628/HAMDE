import { expect, test, type Page } from '@playwright/test'

import { installFakePicker } from './support/installFakePicker'

/**
 * Headings, lists and rules, as they are drawn.
 *
 * The unit tests check which lines get which class. Whether a class amounts to
 * anything is a question for the stylesheet and a browser, which is what this is.
 */

const DOCUMENT = [
  '# Title',
  '',
  '## Subtitle',
  '',
  '### Third level',
  '',
  'Setext title',
  '============',
  '',
  'A paragraph.',
  '',
  '- first',
  '- second, which is long enough to wrap onto another line so that there is a second visual line whose left edge can be compared with the first one of the same item',
  '  - nested',
  '    - deeper',
  '',
  '1. numbered',
  '',
  'Above.',
  '',
  '---',
  '',
  'tail',
  '',
].join('\n')

async function open(page: Page) {
  await installFakePicker(page, { 'note.md': DOCUMENT })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name: 'note.md' }).click()
  await expect(page.locator('.status__path')).toHaveText('note.md')
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
}

const line = (page: Page, text: string) => page.locator('.cm-line', { hasText: text }).first()

/** Where the first character of `word` is drawn, from the left of the page. */
async function leftOf(page: Page, word: string): Promise<number> {
  return page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.querySelector('.cm-content')!, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const index = node.textContent?.indexOf(needle) ?? -1
      if (index === -1) continue

      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + 1)
      return Math.round(range.getBoundingClientRect().left)
    }
    throw new Error('not on the page: ' + needle)
  }, word)
}

test('a title and a subtitle have a rule under them, and nothing below that does', async ({ page }) => {
  await open(page)
  const rule = (text: string) =>
    line(page, text).evaluate((element) => getComputedStyle(element).borderBottomWidth)

  expect(await rule('Title')).toBe('1px')
  expect(await rule('Subtitle')).toBe('1px')
  expect(await rule('Third level')).toBe('0px')
  // A setext heading is underlined by its own `=====`, so it is not given a second.
  expect(await rule('Setext title')).toBe('0px')
})

test('the rule under a heading is there whether or not the line is revealed', async ({ page }) => {
  await open(page)

  await line(page, 'Subtitle').click()

  await expect(line(page, 'Subtitle')).toContainText('## Subtitle')
  await expect(line(page, 'Subtitle')).toHaveCSS('border-bottom-width', '1px')
})

test('a list is indented, and each level of nesting is indented further', async ({ page }) => {
  await open(page)

  const paragraph = await leftOf(page, 'A paragraph')
  const first = await leftOf(page, 'first')
  const nested = await leftOf(page, 'nested')
  const deeper = await leftOf(page, 'deeper')
  const numbered = await leftOf(page, 'numbered')

  expect(first).toBeGreaterThan(paragraph + 10)
  expect(nested).toBeGreaterThan(first + 10)
  expect(deeper).toBeGreaterThan(nested + 10)
  expect(numbered).toBeGreaterThan(paragraph + 10)
})

test('the lines an item wraps onto start where its text does', async ({ page }) => {
  await open(page)

  const text = await leftOf(page, 'second, which')
  const wrapped = await line(page, 'second, which').evaluate((element) => {
    // The last visual line of the item: the right edge of the range is on it.
    const range = document.createRange()
    range.selectNodeContents(element)
    const rects = [...range.getClientRects()]
    const bottom = Math.max(...rects.map((rect) => rect.bottom))
    return Math.round(Math.min(...rects.filter((rect) => rect.bottom === bottom).map((rect) => rect.left)))
  })

  expect(Math.abs(wrapped - text)).toBeLessThanOrEqual(2)
})

test('the text of a list item does not move when the cursor comes onto its line', async ({ page }) => {
  await open(page)

  for (const word of ['first', 'nested', 'deeper']) {
    const drawn = await leftOf(page, word)
    await line(page, word).click()
    await expect(line(page, word)).toContainText('- ' + word)

    expect(Math.abs((await leftOf(page, word)) - drawn), word).toBeLessThanOrEqual(1)
  }
})

test('a horizontal rule is a rule, and its dashes show only on the line the cursor is on', async ({ page }) => {
  await open(page)
  const visible = async () => (await page.locator('.cm-line').allInnerTexts()).join('\n')

  await expect(page.locator('.cm-md-rule-line')).toBeVisible()
  expect(await visible()).not.toContain('---')
  const drawn = await page.locator('.cm-md-rule').evaluate((element) => element.getBoundingClientRect().height)

  await page.locator('.cm-md-rule').click()
  await expect(page.locator('.cm-md-rule-line')).toHaveCount(0)
  await expect(page.locator('.cm-md-rule')).toHaveText('---')
  // The line is as tall as it was, so nothing below it moved.
  expect(await page.locator('.cm-md-rule').evaluate((element) => element.getBoundingClientRect().height)).toBe(drawn)

  await line(page, 'tail').click()
  await expect(page.locator('.cm-md-rule-line')).toBeVisible()
})

test('the arrow keys reach a rule, which is how it is edited without a mouse', async ({ page }) => {
  await open(page)

  // From "tail": the empty line, then the rule.
  await line(page, 'tail').click()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')

  await expect(page.locator('.cm-md-rule')).toHaveText('---')
})
