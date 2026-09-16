import { expect, test, type Page } from '@playwright/test'

import { installFakePicker, type FakeFolder } from './support/installFakePicker'

/**
 * Performance budgets.
 *
 * These are deliberately loose: they are not a benchmark, they are a tripwire for
 * the kind of change that turns a linear cost into a quadratic one. The numbers
 * measured while writing them are in docs/dependencies.md; the thresholds here sit
 * several times above those, so an ordinary slow machine passes and a regression
 * of the "walks the whole document on every keystroke" kind does not.
 */

test.describe.configure({ mode: 'serial' })

async function openFolder(page: Page, folder: FakeFolder, file: string) {
  await installFakePicker(page, folder)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name: file, exact: true }).click()
  await expect(page.locator('.status__path')).toHaveText(file)
}

/** Median and worst frame time over a series of cursor moves. */
async function cursorCost(page: Page, presses = 15) {
  return page.evaluate(async (count) => {
    const content = document.querySelector('.cm-content')!
    const times: number[] = []

    for (let index = 0; index < count; index += 1) {
      const start = performance.now()
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      await new Promise((resolve) => requestAnimationFrame(resolve))
      times.push(performance.now() - start)
    }

    times.sort((a, b) => a - b)
    return { median: times[Math.floor(times.length / 2)]!, worst: times.at(-1)! }
  }, presses)
}

test('a one megabyte document opens and stays responsive', async ({ page }) => {
  const lines = Array.from({ length: 16_000 }, (_, index) =>
    index % 5 === 0
      ? '## Section ' + index
      : 'Line ' + index + ' with **bold**, *italic*, `code` and [a link](https://example.com).',
  )
  const document = lines.join('\n') + '\n'
  expect(document.length).toBeGreaterThan(1_000_000)

  const started = Date.now()
  await openFolder(page, { 'big.md': document }, 'big.md')
  await expect(page.locator('.cm-md-h2').first()).toBeVisible()
  expect(Date.now() - started).toBeLessThan(10_000)

  await page.locator('.cm-content').click()
  const cost = await cursorCost(page)
  expect(cost.median).toBeLessThan(120)

  // Only the viewport is in the DOM, whatever the document's size.
  expect(await page.locator('.cm-line').count()).toBeLessThan(200)
})

test('one very long quoted block costs the viewport, not the document', async ({ page }) => {
  // The shape that used to make every keystroke a whole-document walk.
  await openFolder(page, { 'quote.md': '> quoted line\n'.repeat(20_000) }, 'quote.md')
  await expect(page.locator('.cm-md-quote').first()).toBeVisible()

  await page.locator('.cm-content').click()
  const cost = await cursorCost(page)

  expect(cost.median).toBeLessThan(120)
})

test('a folder with five thousand files opens without walking it', async ({ page }) => {
  const folder: FakeFolder = {}
  for (let index = 0; index < 5000; index += 1) folder['note-' + index + '.md'] = '# Note ' + index

  const started = Date.now()
  await installFakePicker(page, folder)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()
  await expect(page.getByRole('button', { name: 'note-0.md', exact: true })).toBeVisible()

  expect(Date.now() - started).toBeLessThan(15_000)
})

test('a deeply nested folder only reads the level that is open', async ({ page }) => {
  let folder: FakeFolder = { 'deep.md': '# Bottom' }
  for (let depth = 0; depth < 10; depth += 1) folder = { ['level-' + depth]: folder }

  await installFakePicker(page, folder)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()

  // Nothing below the root is in the DOM until it is expanded.
  await expect(page.getByRole('button', { name: 'level-8', exact: true })).toBeHidden()

  await page.getByRole('button', { name: 'level-9', exact: true }).click()
  await expect(page.getByRole('button', { name: 'level-8', exact: true })).toBeVisible()
})

test('many code blocks stay responsive', async ({ page }) => {
  const blocks = Array.from(
    { length: 50 },
    (_, index) => '```javascript\nconst value' + index + ' = ' + index + '\n```\n',
  ).join('\n')

  await openFolder(page, { 'code.md': blocks }, 'code.md')
  await expect(page.locator('.cm-md-code-line').first()).toBeVisible()

  await page.locator('.cm-content').click()
  const cost = await cursorCost(page)

  expect(cost.median).toBeLessThan(120)
})

test('twenty diagrams render and the editor stays usable', async ({ page }) => {
  const diagrams = Array.from(
    { length: 20 },
    (_, index) => '```mermaid\ngraph LR\n    A' + index + ' --> B' + index + '\n```\n',
  ).join('\n')

  await openFolder(page, { 'diagrams.md': diagrams + '\ntail\n' }, 'diagrams.md')
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')

  await expect(page.locator('.cm-md-diagram svg')).toHaveCount(20, { timeout: 30_000 })

  const cost = await cursorCost(page)
  expect(cost.median).toBeLessThan(200)
})

test('moving the cursor past a diagram does not re-render it', async ({ page }) => {
  await openFolder(
    page,
    { 'one.md': '```mermaid\ngraph TD\n    A --> B\n```\n\n' + 'filler\n\n'.repeat(20) },
    'one.md',
  )
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await expect(page.locator('.cm-md-diagram svg')).toHaveCount(1)

  // Tag the rendered node; a re-render would replace it with a different one.
  await page.evaluate(() => {
    document.querySelector('.cm-md-diagram svg')?.setAttribute('data-original', 'yes')
  })

  for (let index = 0; index < 10; index += 1) await page.keyboard.press('ArrowUp')
  for (let index = 0; index < 10; index += 1) await page.keyboard.press('ArrowDown')

  await expect(page.locator('.cm-md-diagram svg[data-original="yes"]')).toHaveCount(1)
})

/**
 * Tables are the common case for the block layer, which walks the whole document
 * rather than the viewport: there are documents with hundreds of tables, and almost
 * none with hundreds of diagrams. This is the tripwire for that walk, and for
 * rebuilding a cell's content on every keystroke.
 */
test('a document of tables stays responsive', async ({ page }) => {
  const tables = Array.from(
    { length: 100 },
    (_, index) =>
      [
        '| name | value | note |',
        '| :--- | ----: | :--: |',
        '| row ' + index + ' | ' + index + ' | **bold** |',
        '| row ' + index + ' | ' + index + ' | `code` |',
      ].join('\n') + '\n',
  ).join('\n')

  await openFolder(page, { 'tables.md': tables }, 'tables.md')
  await expect(page.locator('.cm-md-table__grid').first()).toBeVisible()

  await page.locator('.cm-content').click()
  const cost = await cursorCost(page)

  expect(cost.median).toBeLessThan(120)
})

test('moving the cursor past a table does not rebuild it', async ({ page }) => {
  const table = ['| a | b |', '| - | - |', '| 1 | 2 |'].join('\n')
  await openFolder(
    page,
    { 'one.md': table + '\n\n' + 'filler\n\n'.repeat(20) },
    'one.md',
  )
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await expect(page.locator('.cm-md-table__grid')).toHaveCount(1)

  // Tag the rendered node; rebuilding the widget would replace it.
  await page.evaluate(() => {
    document.querySelector('.cm-md-table__grid')?.setAttribute('data-original', 'yes')
  })

  for (let index = 0; index < 8; index += 1) await page.keyboard.press('ArrowUp')
  for (let index = 0; index < 8; index += 1) await page.keyboard.press('ArrowDown')

  await expect(page.locator('.cm-md-table__grid[data-original="yes"]')).toHaveCount(1)
})
