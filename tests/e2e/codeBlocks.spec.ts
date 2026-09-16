import { expect, test, type Page } from '@playwright/test'

import { installFakePicker } from './support/installFakePicker'

/** One fenced block per supported language, each with a distinctive token. */
const SNIPPETS: Array<[info: string, code: string]> = [
  ['javascript', 'const greeting = "hello"'],
  ['typescript', 'const greeting: string = "hello"'],
  ['json', '{ "key": "value" }'],
  ['html', '<p class="x">hi</p>'],
  ['css', '.card { color: red; }'],
  ['bash', 'echo "hello"'],
  ['powershell', 'Write-Output "hello"'],
  ['csharp', 'var greeting = "hello";'],
  ['sql', 'select name from users'],
  ['xml', '<note><to>you</to></note>'],
  ['yaml', 'key: value'],
]

function documentFor(snippets: typeof SNIPPETS): string {
  return snippets.map(([info, code]) => '```' + info + '\n' + code + '\n```\n').join('\n')
}

async function openDocument(page: Page, contents: string, name = 'code.md') {
  await installFakePicker(page, { [name]: contents })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name }).click()
  await expect(page.locator('.status__path')).toHaveText(name)
}

/** The line element whose text contains `code`. */
function lineWith(page: Page, code: string) {
  return page.locator('.cm-line', { hasText: code }).first()
}

test('highlights every supported language', async ({ page }) => {
  await openDocument(page, documentFor(SNIPPETS))

  for (const [info, code] of SNIPPETS) {
    const line = lineWith(page, code)
    await expect(line, info + ' should be visible').toBeVisible()

    // Highlighting means the line is broken into styled spans. An unparsed block
    // would be one plain text node with no styling at all.
    await expect
      .poll(async () => line.locator('span[class]').count(), {
        message: info + ' should be highlighted',
        timeout: 10_000,
      })
      .toBeGreaterThan(0)
  }
})

test('styles the fenced block as code, fences included', async ({ page }) => {
  await openDocument(page, '```js\nconst a = 1\n```\n')

  await expect(page.locator('.cm-md-code-line')).toHaveCount(3)
})

test('a language is only downloaded when a document uses it', async ({ page }) => {
  const requested: string[] = []
  page.on('request', (request) => {
    if (request.resourceType() === 'script') requested.push(request.url())
  })

  // Opening a document with no code at all must not pull a single grammar.
  await openDocument(page, '# Just prose\n\nNothing to highlight here.\n', 'prose.md')
  await expect(page.locator('.cm-content')).toContainText('Just prose')
  const afterProse = requested.length

  await openDocument(page, '```sql\nselect 1\n```\n', 'query.md')
  await expect(page.locator('.cm-md-code-line').first()).toBeVisible()
  await expect
    .poll(() => requested.length, { timeout: 10_000 })
    .toBeGreaterThan(afterProse)

  // Whatever it fetched came from our own origin, never a CDN.
  for (const url of requested) expect(new URL(url).hostname).toBe('localhost')
})

test('an unknown language leaves the block readable', async ({ page }) => {
  await openDocument(page, '```brainfuck\n++++[>++++<-]\n```\n')

  await expect(page.locator('.cm-content')).toContainText('++++[>++++<-]')
  await expect(page.locator('.cm-md-code-line')).toHaveCount(3)
})

test('a fence with no language is still a code block', async ({ page }) => {
  await openDocument(page, '```\nplain code\n```\n')

  await expect(page.locator('.cm-content')).toContainText('plain code')
  await expect(page.locator('.cm-md-code-line')).toHaveCount(3)
})

test('an unterminated fence does not break the editor', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await openDocument(page, '```javascript\nconst a = 1\n')

  await expect(page.locator('.cm-content')).toContainText('const a = 1')
  expect(errors).toEqual([])
})

test('Markdown syntax inside code stays literal', async ({ page }) => {
  await openDocument(page, '```javascript\nconst s = "**bold** and [a](https://x.com)"\n```\n')

  const shown = (await page.locator('.cm-line').allInnerTexts()).join('\n')
  expect(shown).toContain('**bold**')
  expect(shown).toContain('[a](https://x.com)')
})

test('code blocks can still be edited and saved', async ({ page }) => {
  await openDocument(page, '```javascript\nconst a = 1\n```\n')

  await lineWith(page, 'const a = 1').click()
  await page.keyboard.press('End')
  await page.keyboard.type('23')
  await expect(page.locator('.status__state')).toHaveText('Saved')

  const saved = await page.evaluate(
    () => (window as unknown as { __writtenFiles: Map<string, string> }).__writtenFiles.get('code.md'),
  )
  expect(saved).toBe('```javascript\nconst a = 123\n```\n')
})

test('highlighting issues no request to another origin', async ({ page }) => {
  const external: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== 'localhost') external.push(request.url())
  })

  await openDocument(page, documentFor(SNIPPETS.slice(0, 4)))
  await expect(page.locator('.cm-md-code-line').first()).toBeVisible()

  expect(external).toEqual([])
})
