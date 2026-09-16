import { expect, test, type Page } from '@playwright/test'

import { installFakePicker } from './support/installFakePicker'

/**
 * A table has to *look* like a table and stay editable. What the model does is
 * covered in unit tests; these are the parts only a browser can answer — that a
 * real grid is on screen, that clicking a cell lands in that cell, and that the
 * file on disk is untouched.
 */

const TABLE = [
  '| Language   | Kind     | Year |',
  '| ---------- | :------: | ---: |',
  '| TypeScript | compiled | 2012 |',
  '| Markdown   | markup   | 2004 |',
].join('\n')

const DOCUMENT = ['# Tables', '', TABLE, '', 'Text after the table.', ''].join('\n')

async function open(page: Page, contents = DOCUMENT, name = 'table.md') {
  await installFakePicker(page, { [name]: contents })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name }).click()
  await expect(page.locator('.status__path')).toHaveText(name)
  // Cursor on the last line: the table is not revealed.
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
}

const grid = (page: Page) => page.locator('.cm-md-table__grid')

test('renders a real table in place of its source', async ({ page }) => {
  await open(page)

  await expect(grid(page)).toBeVisible()
  await expect(grid(page).locator('thead th')).toHaveCount(3)
  await expect(grid(page).locator('tbody tr')).toHaveCount(2)
  await expect(grid(page).locator('thead th').first()).toHaveText('Language')
  await expect(grid(page).locator('tbody td').first()).toHaveText('TypeScript')

  // The pipes are gone from view; the text around the table is not.
  const shown = (await page.locator('.cm-line').allInnerTexts()).join('\n')
  expect(shown).not.toContain('| TypeScript')
  expect(shown).toContain('Text after the table.')
})

test('the cells are laid out as a grid, not as aligned characters', async ({ page }) => {
  await open(page)
  await expect(grid(page)).toBeVisible()

  // Every cell of a column starts at the same x, which is what a table gives you
  // and what a monospace rendering of the source only approximates.
  const lefts = await grid(page)
    .locator('tr > *:first-child')
    .evaluateAll((cells) => cells.map((cell) => Math.round(cell.getBoundingClientRect().left)))

  expect(new Set(lefts).size).toBe(1)

  // And the cells are drawn: a border, not just spacing.
  const border = await grid(page)
    .locator('td')
    .first()
    .evaluate((cell) => getComputedStyle(cell).borderBottomWidth)
  expect(border).not.toBe('0px')
})

test('honours column alignment', async ({ page }) => {
  await open(page)
  await expect(grid(page)).toBeVisible()

  const alignments = await grid(page)
    .locator('tbody tr')
    .first()
    .locator('td')
    .evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).textAlign))

  expect(alignments).toEqual(['left', 'center', 'right'])
})

test('renders the inline Markdown inside a cell', async ({ page }) => {
  const doc = [
    '| what | value |',
    '| --- | --- |',
    '| bold | **strong** |',
    '| code | `x = 1` |',
    '| link | [site](https://example.com) |',
    '',
    'tail',
    '',
  ].join('\n')

  await open(page, doc)
  await expect(grid(page)).toBeVisible()

  await expect(grid(page).locator('td strong')).toHaveText('strong')
  await expect(grid(page).locator('td code')).toHaveText('x = 1')

  const link = grid(page).locator('td a')
  await expect(link).toHaveText('site')
  await expect(link).toHaveAttribute('href', 'https://example.com')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
})

test('shows the source when the cursor is inside the table', async ({ page }) => {
  await open(page)
  await expect(grid(page)).toBeVisible()

  await page.locator('.cm-line', { hasText: 'Text after the table.' }).click()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')

  await expect(page.locator('.cm-line', { hasText: '| Markdown' })).toBeVisible()
  await expect(page.locator('.cm-md-table')).toHaveCount(0)
})

test('renders it again when the cursor leaves', async ({ page }) => {
  await open(page)
  await page.locator('.cm-md-table').click()
  await expect(page.locator('.cm-md-table')).toHaveCount(0)

  await page.locator('.cm-line', { hasText: 'Text after the table.' }).click()
  await expect(grid(page)).toBeVisible()
})

test('clicking a cell puts the cursor in that cell', async ({ page }) => {
  await open(page)
  await expect(grid(page)).toBeVisible()

  // The last cell of the last row: the cursor must land there, not at the top of
  // the block, or every correction would start by hunting for the right pipe.
  await grid(page).locator('tbody tr').last().locator('td').last().click()

  await expect(page.locator('.cm-line', { hasText: '| Markdown' })).toBeVisible()

  // Typing goes into that cell, which is only true if the cursor landed in it.
  await page.keyboard.type('!')
  await expect(page.locator('.cm-line', { hasText: '| Markdown' })).toContainText('!2004')
})

test('editing a cell updates the rendered table', async ({ page }) => {
  await open(page)
  await expect(grid(page)).toBeVisible()

  await grid(page).locator('tbody td').first().click()
  await page.keyboard.press('End')
  await page.locator('.cm-line', { hasText: '| TypeScript' }).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('Just ')
  await page.locator('.cm-line', { hasText: 'Text after the table.' }).click()

  await expect(grid(page).locator('tbody td').first()).toHaveText('Just TypeScript')
})

test('a table typed into an empty document renders', async ({ page }) => {
  await open(page, '# Fresh\n\n', 'fresh.md')

  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('| a | b |\n| - | - |\n| 1 | 2 |\n')
  // A blank line first: a paragraph line straight after a row is another row, so
  // without it the cursor would still be inside the table and it would stay source.
  await page.keyboard.press('Enter')
  await page.keyboard.type('after')

  await expect(grid(page)).toBeVisible()
  await expect(grid(page).locator('tbody td')).toHaveCount(2)
})

test('a table wider than the editor scrolls instead of widening the document', async ({
  page,
}) => {
  // Enough columns that the table cannot fit however its cells wrap. With fewer,
  // the cells wrap and the table fits, which is the right outcome for reading — and
  // either way the page itself must not widen.
  const columns = Array.from({ length: 30 }, (_, index) => 'column ' + index)
  const wide = [
    '| ' + columns.join(' | ') + ' |',
    '| ' + columns.map(() => '---').join(' | ') + ' |',
    '| ' + columns.map((_, index) => 'value ' + index).join(' | ') + ' |',
    '',
    'tail',
    '',
  ].join('\n')

  await open(page, wide, 'wide.md')
  await expect(grid(page)).toBeVisible()

  const overflow = await page.locator('.cm-md-table').evaluate((container) => ({
    scrollable: container.scrollWidth > container.clientWidth,
    within: container.clientWidth <= (container.parentElement?.clientWidth ?? 0) + 1,
  }))

  expect(overflow.scrollable).toBe(true)
  expect(overflow.within).toBe(true)

  const document = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(document.scrollWidth).toBeLessThanOrEqual(document.clientWidth)
})

test('a table inside a blockquote stays as source', async ({ page }) => {
  const quoted = ['> | a | b |', '> | - | - |', '> | 1 | 2 |', '', 'tail', ''].join('\n')

  await open(page, quoted, 'quoted.md')
  await expect(page.locator('.cm-content')).toContainText('tail')

  // A block replacement covers whole lines, which would swallow the `>`.
  await expect(page.locator('.cm-md-table')).toHaveCount(0)
  await expect(page.locator('.cm-line', { hasText: '| 1 | 2 |' })).toBeVisible()
})

test('a cell cannot introduce markup', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const dialogs: string[] = []
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })

  const hostile = [
    '| a | b |',
    '| - | - |',
    '| <img src=x onerror=alert(1)> | [x](javascript:alert(2)) |',
    '',
    'tail',
    '',
  ].join('\n')

  await open(page, hostile, 'hostile.md')
  await expect(grid(page)).toBeVisible()

  const unsafe = await page.locator('.cm-md-table').evaluate((container) => {
    const all = [...container.querySelectorAll('*')]
    return {
      images: container.querySelectorAll('img').length,
      handlers: all.filter((node) =>
        [...node.attributes].some((attribute) => attribute.name.toLowerCase().startsWith('on')),
      ).length,
      jsLinks: all.filter((node) =>
        [...node.attributes].some(
          (attribute) => /href$/i.test(attribute.name) && /javascript:/i.test(attribute.value),
        ),
      ).length,
    }
  })

  expect(unsafe).toEqual({ images: 0, handlers: 0, jsLinks: 0 })
  expect(dialogs).toEqual([])
  expect(errors).toEqual([])

  // The markup shows as the text it is, which is what the document says.
  await expect(grid(page).locator('tbody td').first()).toContainText('<img src=x')
})

test('the document keeps the table source', async ({ page }) => {
  await open(page)
  await expect(grid(page)).toBeVisible()

  await page.keyboard.type('Appended.')
  await expect(page.locator('.status__state')).toHaveText('Saved')

  const saved = await page.evaluate(
    () =>
      (window as unknown as { __writtenFiles: Map<string, string> }).__writtenFiles.get('table.md'),
  )
  expect(saved).toContain('| ---------- | :------: | ---: |')
  expect(saved).toContain('| TypeScript | compiled | 2012 |')
  expect(saved).toContain('Appended.')
})
