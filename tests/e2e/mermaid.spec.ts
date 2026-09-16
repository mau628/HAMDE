import { expect, test, type Page } from '@playwright/test'

import { installFakePicker } from './support/installFakePicker'

const DIAGRAM = ['```mermaid', 'graph TD', '    A[Open folder] --> B[Edit note]', '```'].join('\n')

const DOCUMENT = ['# Diagrams', '', DIAGRAM, '', 'Text after the diagram.', ''].join('\n')

async function open(page: Page, contents = DOCUMENT, name = 'diagram.md') {
  await installFakePicker(page, { [name]: contents })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name }).click()
  await expect(page.locator('.status__path')).toHaveText(name)
  // Cursor on the last line: the diagram is not revealed.
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
}

const diagram = (page: Page) => page.locator('.cm-md-diagram svg')

test('renders a diagram in place of its source', async ({ page }) => {
  await open(page)

  await expect(diagram(page)).toBeVisible()
  await expect(page.locator('.cm-md-diagram__pending')).toHaveCount(0)

  // The source lines are gone from view; the text around them is not.
  const shown = (await page.locator('.cm-line').allInnerTexts()).join('\n')
  expect(shown).not.toContain('graph TD')
  expect(shown).toContain('Text after the diagram.')
})

test('the diagram is a drawing, not markup pretending to be one', async ({ page }) => {
  await open(page)
  await expect(diagram(page)).toBeVisible()

  const shapes = await page.locator('.cm-md-diagram svg').evaluate((svg) => ({
    nodes: svg.querySelectorAll('.node, .nodes, g').length,
    text: svg.textContent ?? '',
  }))

  expect(shapes.nodes).toBeGreaterThan(0)
  expect(shapes.text).toContain('Open folder')
})

test('shows the source when the cursor is inside the block', async ({ page }) => {
  await open(page)
  await expect(diagram(page)).toBeVisible()

  await page.locator('.cm-line', { hasText: 'Text after the diagram.' }).click()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')

  await expect(page.locator('.cm-line', { hasText: 'graph TD' })).toBeVisible()
  await expect(page.locator('.cm-md-diagram')).toHaveCount(0)
})

test('renders it again when the cursor leaves', async ({ page }) => {
  await open(page)
  await page.locator('.cm-line', { hasText: 'Text after the diagram.' }).click()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('.cm-md-diagram')).toHaveCount(0)

  await page.locator('.cm-line', { hasText: 'Text after the diagram.' }).click()
  await expect(diagram(page)).toBeVisible()
})

test('clicking a diagram puts the cursor in the block, which reveals it', async ({ page }) => {
  await open(page)
  await expect(diagram(page)).toBeVisible()

  await page.locator('.cm-md-diagram').click()

  await expect(page.locator('.cm-line', { hasText: 'graph TD' })).toBeVisible()
})

test('an invalid diagram shows the error and keeps the source visible', async ({ page }) => {
  await open(page, ['```mermaid', 'graph TD', '    A -->', '```', '', 'tail', ''].join('\n'))

  await expect(page.locator('.cm-md-diagram__error')).toBeVisible()
  await expect(page.locator('.cm-md-diagram__message')).not.toBeEmpty()
  // The source stays readable inside the error box, so the user can see the problem.
  await expect(page.locator('.cm-md-diagram__error pre')).toContainText('A -->')

  // The rest of the document is unaffected.
  await expect(page.locator('.cm-content')).toContainText('tail')
})

test('a diagram that becomes valid renders without a reload', async ({ page }) => {
  await open(page, ['```mermaid', 'graph TD', '    A -->', '```', '', 'tail', ''].join('\n'))
  await expect(page.locator('.cm-md-diagram__error')).toBeVisible()

  await page.locator('.cm-md-diagram').click()
  await page.locator('.cm-line', { hasText: 'A -->' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' B')
  await page.locator('.cm-line', { hasText: 'tail' }).click()

  await expect(diagram(page)).toBeVisible()
  await expect(page.locator('.cm-md-diagram__error')).toHaveCount(0)
})

test('editing the diagram updates it', async ({ page }) => {
  await open(page)
  await expect(diagram(page)).toBeVisible()
  await expect(diagram(page)).toContainText('Edit note')

  await page.locator('.cm-md-diagram').click()
  await page.locator('.cm-line', { hasText: 'Edit note' }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('X]')
  await page.locator('.cm-line', { hasText: 'Text after the diagram.' }).click()

  await expect(diagram(page)).toBeVisible()
  await expect(diagram(page)).not.toContainText('Edit note')
})

test('the document keeps the diagram source', async ({ page }) => {
  await open(page)
  await expect(diagram(page)).toBeVisible()

  await page.keyboard.type('Appended.')
  await expect(page.locator('.status__state')).toHaveText('Saved')

  const saved = await page.evaluate(
    () =>
      (window as unknown as { __writtenFiles: Map<string, string> }).__writtenFiles.get(
        'diagram.md',
      ),
  )
  expect(saved).toContain('```mermaid')
  expect(saved).toContain('graph TD')
  expect(saved).toContain('Appended.')
})

test('Mermaid is only downloaded for a document that has a diagram', async ({ page }) => {
  const scripts: string[] = []
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url())
  })

  await open(page, '# Prose only\n\nNothing to draw.\n', 'prose.md')
  await expect(page.locator('.cm-content')).toContainText('Prose only')
  const withoutDiagram = scripts.length

  await open(page, DOCUMENT)
  await expect(diagram(page)).toBeVisible()

  expect(scripts.length).toBeGreaterThan(withoutDiagram)
  for (const url of scripts) expect(new URL(url).hostname).toBe('localhost')
})

test('rendering a diagram issues no request to another origin', async ({ page }) => {
  const external: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== 'localhost') external.push(request.url())
  })

  await open(page)
  await expect(diagram(page)).toBeVisible()

  expect(external).toEqual([])
})

test('a diagram cannot introduce script or event handlers', async ({ page }) => {
  const dialogs: string[] = []
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  // Labels carrying markup and a click directive, which securityLevel: 'strict'
  // must neutralise and the scrub must not let through.
  const hostile = [
    '```mermaid',
    'graph TD',
    '    A["<img src=x onerror=alert(1)>"] --> B["<script>alert(2)</script>"]',
    '    click A "javascript:alert(3)"',
    '```',
    '',
    'tail',
    '',
  ].join('\n')

  await open(page, hostile)
  await page.waitForTimeout(1500)

  const unsafe = await page.evaluate(() => {
    const container = document.querySelector('.cm-md-diagram')
    if (container === null) return { scripts: 0, handlers: 0, jsLinks: 0 }

    const all = [...container.querySelectorAll('*')]
    return {
      scripts: container.querySelectorAll('script').length,
      handlers: all.filter((node) =>
        [...node.attributes].some((attribute) => attribute.name.toLowerCase().startsWith('on')),
      ).length,
      jsLinks: all.filter((node) =>
        [...node.attributes].some(
          (attribute) =>
            /href$/i.test(attribute.name) && /javascript:/i.test(attribute.value),
        ),
      ).length,
    }
  })

  expect(unsafe).toEqual({ scripts: 0, handlers: 0, jsLinks: 0 })
  expect(dialogs).toEqual([])
  expect(errors).toEqual([])
})

test('several diagrams all render', async ({ page }) => {
  const many = Array.from(
    { length: 5 },
    (_, index) => '```mermaid\ngraph LR\n    A' + index + ' --> B' + index + '\n```\n',
  ).join('\n')

  await open(page, many + '\ntail\n')

  await expect(page.locator('.cm-md-diagram svg')).toHaveCount(5)
})
