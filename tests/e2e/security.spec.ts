import { expect, test, type Page } from '@playwright/test'

import { installFakePicker } from './support/installFakePicker'

/**
 * The security properties the whole project is arranged around, checked against the
 * built app rather than against the code that is supposed to provide them.
 */

async function openDocument(page: Page, contents: string, name = 'note.md') {
  await installFakePicker(page, { [name]: contents })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name }).click()
  await expect(page.locator('.status__path')).toHaveText(name)
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
}

/** Anything that would prove script ran, or that a request went out. */
function watch(page: Page) {
  const dialogs: string[] = []
  const external: string[] = []
  const errors: string[] = []

  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== 'localhost') external.push(request.url())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  return { dialogs, external, errors }
}

const HOSTILE = [
  '# Hostile document',
  '',
  '<script>window.__pwned = true; alert("script tag")</script>',
  '',
  '<img src=x onerror="window.__pwned = true; alert(\'img onerror\')">',
  '',
  '<iframe src="https://evil.example/frame"></iframe>',
  '',
  '<div onclick="alert(1)" onmouseover="alert(2)">hover me</div>',
  '',
  '<svg onload="alert(3)"><circle r="10"/></svg>',
  '',
  '[a javascript link](javascript:alert(4))',
  '',
  '[a data link](data:text/html,<script>alert(5)</script>)',
  '',
  '![a remote image](https://tracker.example/pixel.png)',
  '',
  '![a data image](data:image/svg+xml,<svg onload="alert(6)"/>)',
  '',
  '<style>body { display: none }</style>',
  '',
  '<a href="javascript:alert(7)">a raw anchor</a>',
  '',
  'The end.',
  '',
].join('\n')

test('nothing in a hostile document executes', async ({ page }) => {
  const seen = watch(page)

  await openDocument(page, HOSTILE)
  await expect(page.locator('.cm-content')).toContainText('The end.')

  // Walk the whole document: every line gets rendered and decorated.
  for (let index = 0; index < 30; index += 1) await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(500)

  expect(seen.dialogs).toEqual([])
  expect(seen.external).toEqual([])
  expect(seen.errors).toEqual([])
  expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined()
})

test('embedded HTML stays text and never becomes an element', async ({ page }) => {
  await openDocument(page, HOSTILE)

  const injected = await page.evaluate(() => {
    const content = document.querySelector('.cm-content')!
    return {
      scripts: content.querySelectorAll('script').length,
      iframes: content.querySelectorAll('iframe').length,
      anchors: content.querySelectorAll('a[href^="javascript" i]').length,
      styles: content.querySelectorAll('style').length,
      handlers: [...content.querySelectorAll('*')].filter((node) =>
        [...node.attributes].some((attribute) => attribute.name.toLowerCase().startsWith('on')),
      ).length,
    }
  })

  expect(injected).toEqual({ scripts: 0, iframes: 0, anchors: 0, styles: 0, handlers: 0 })

  // It is all still there, as text the user can edit.
  const shown = (await page.locator('.cm-line').allInnerTexts()).join('\n')
  expect(shown).toContain('<script>')
  expect(shown).toContain('onerror')
})

test('the document is unchanged by having been opened and read', async ({ page }) => {
  await openDocument(page, HOSTILE)
  await page.waitForTimeout(900)

  const written = await page.evaluate(() => [
    ...(window as unknown as { __writtenFiles: Map<string, string> }).__writtenFiles.keys(),
  ])
  expect(written).toEqual([])
})

test('a remote image is shown as source, never fetched', async ({ page }) => {
  const seen = watch(page)

  await openDocument(page, '![tracker](https://tracker.example/pixel.png)\n\ntail\n')
  await page.waitForTimeout(500)

  const shown = (await page.locator('.cm-line').allInnerTexts()).join('\n')
  expect(shown).toContain('https://tracker.example/pixel.png')
  expect(await page.locator('.cm-md-image').count()).toBe(0)
  expect(seen.external).toEqual([])
})

test('an image the workspace does not have says so', async ({ page }) => {
  await openDocument(page, '![missing](nope.png)\n\ntail\n')

  await expect(page.locator('.cm-md-image__missing')).toContainText('nope.png')
})

test('a link is only followed after its protocol is checked', async ({ page, context }) => {
  const seen = watch(page)
  await openDocument(page, '[safe](https://example.com) and [unsafe](javascript:alert(1))\n')

  // The unsafe one: Ctrl+click does nothing at all.
  await page.locator('.cm-line', { hasText: 'unsafe' }).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.locator('.cm-md-link').nth(1).click({ modifiers: ['ControlOrMeta'] })
  await page.waitForTimeout(300)

  expect(seen.dialogs).toEqual([])
  expect(context.pages()).toHaveLength(1)

  // The safe one opens.
  const opened = context.waitForEvent('page')
  await page.locator('.cm-md-link').first().click({ modifiers: ['ControlOrMeta'] })
  const tab = await opened
  expect(tab.url()).toBe('https://example.com/')
  await tab.close()
})

test('the page makes no request to any other origin, whatever the document holds', async ({
  page,
}) => {
  const seen = watch(page)

  await openDocument(
    page,
    [
      HOSTILE,
      '```mermaid',
      'graph TD',
      '    A["<img src=x onerror=alert(1)>"] --> B',
      '```',
      '',
    ].join('\n'),
  )
  await page.waitForTimeout(2000)

  expect(seen.external).toEqual([])
  expect(seen.dialogs).toEqual([])
})
