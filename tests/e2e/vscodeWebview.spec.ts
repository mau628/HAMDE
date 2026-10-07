import { expect, test, type Page } from '@playwright/test'

import { openWebview, ORIGIN } from './support/webviewHarness'

/**
 * The VS Code extension's webview, exercised as a page.
 *
 * What is under test is the built bundle and the real page with its Content
 * Security Policy; VS Code is replaced by the harness. That covers everything on
 * the webview's side of the protocol. The extension's side needs VS Code itself
 * and is covered by vscode/test/smoke.
 */

/** Anything that would prove script ran, a request went out, or the policy was hit. */
function watch(page: Page) {
  const dialogs: string[] = []
  const external: string[] = []
  const errors: string[] = []

  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  page.on('request', (request) => {
    if (!request.url().startsWith(ORIGIN)) external.push(request.url())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  // A Content Security Policy violation is reported as a console error.
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
  })

  return { dialogs, external, errors }
}

async function openDocument(page: Page, text: string, savedState?: unknown) {
  const webview = await openWebview(page, savedState)
  await expect.poll(() => webview.sentOf('ready')).toHaveLength(1)

  await webview.send({ type: 'sync', seq: 1, text, wide: false })
  await expect(page.locator('.cm-content')).toBeVisible()

  return webview
}

test('announces itself, then shows the document it is sent', async ({ page }) => {
  const seen = watch(page)
  const webview = await openDocument(page, 'First line.\n\n# Title\n\nSome **bold** text.\n')

  // Rendered, with the syntax hidden: the cursor is on the first line.
  await expect(page.locator('.cm-md-h1')).toHaveText('Title')
  await expect(page.locator('.cm-md-strong')).toHaveText('bold')

  // Being shown a document is not an edit: nothing goes back.
  expect(await webview.sentOf('edit')).toEqual([])
  expect(seen.errors).toEqual([])
  expect(seen.external).toEqual([])
})

test('reports what the user types as a line and a character', async ({ page }) => {
  const webview = await openDocument(page, '# Title\r\n\r\nbody')

  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('!')

  // Line 2, character 4 in a CRLF file too: an offset would be two further on.
  expect(await webview.sentOf('edit')).toEqual([
    {
      type: 'edit',
      seenSeq: 1,
      changes: [
        { start: { line: 2, character: 4 }, end: { line: 2, character: 4 }, text: '!' },
      ],
      shape: { length: 14, lines: 3 },
    },
  ])
})

test('applies changes made elsewhere without sending them back', async ({ page }) => {
  const webview = await openDocument(page, 'one\ntwo\nthree')

  await webview.send({
    type: 'changes',
    seq: 2,
    // In order, each against the result of the one before, as VS Code reports them.
    changes: [
      { start: { line: 2, character: 0 }, end: { line: 2, character: 5 }, text: 'THREE' },
      { start: { line: 0, character: 3 }, end: { line: 1, character: 0 }, text: ' and ' },
    ],
    shape: { length: 17, lines: 2 },
    reveal: false,
  })

  await expect.poll(() => webview.text()).toBe('one and two\nTHREE')
  expect(await webview.sentOf('edit')).toEqual([])
  expect(await webview.sentOf('resync')).toEqual([])

  // The next thing typed says it has seen that change.
  await page.locator('.cm-content').click()
  await page.keyboard.type('x')
  expect((await webview.sentOf('edit')).at(-1)?.seenSeq).toBe(2)
})

test('asks for the document again when its copy does not match', async ({ page }) => {
  const webview = await openDocument(page, 'one\ntwo')

  await webview.send({
    type: 'changes',
    seq: 2,
    changes: [{ start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, text: 'x' }],
    // Not what that change produces here, so the copies must have drifted.
    shape: { length: 99, lines: 9 },
    reveal: false,
  })

  await expect.poll(() => webview.sentOf('resync')).toHaveLength(1)

  await webview.send({ type: 'sync', seq: 3, text: 'the truth', wide: false })
  await expect.poll(() => webview.text()).toBe('the truth')
  expect(await webview.sentOf('edit')).toEqual([])
})

test('leaves undo to VS Code, which owns the document', async ({ page }) => {
  const webview = await openDocument(page, 'text')

  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('!')
  await page.keyboard.press('ControlOrMeta+z')

  // No history of its own: a second one would undo the same edit twice.
  expect(await webview.text()).toBe('text!')
  expect(await webview.sentOf('edit')).toHaveLength(1)

  // The undo arrives from VS Code as a change, and the cursor goes to it.
  await webview.send({
    type: 'changes',
    seq: 2,
    changes: [{ start: { line: 0, character: 4 }, end: { line: 0, character: 5 }, text: '' }],
    shape: { length: 4, lines: 1 },
    reveal: true,
  })
  await expect.poll(() => webview.text()).toBe('text')
})

test('comes back where the user left off after its page was discarded', async ({ page }) => {
  const webview = await openDocument(page, 'first\nsecond\nthird', {
    anchor: 9,
    head: 9,
    scrollTop: 0,
  })

  await page.keyboard.type('!')

  expect((await webview.sentOf('edit'))[0]?.changes).toEqual([
    { start: { line: 1, character: 3 }, end: { line: 1, character: 3 }, text: '!' },
  ])
})

test('shows an image only once the extension says where it is', async ({ page }) => {
  const seen = watch(page)
  const webview = await openDocument(
    page,
    [
      '![inside](images/a.png)',
      '',
      '![climbing](../assets/b.png)',
      '',
      '![remote](https://tracker.example/pixel.png)',
      '',
      'tail',
    ].join('\n'),
  )
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')

  // The remote one is never even asked about; where the others may be read from
  // is the extension's decision, so both are asked.
  const asked = async () => (await webview.sentOf('resolveImage')).map((m) => m.source).sort()
  await expect.poll(asked).toEqual(['../assets/b.png', 'images/a.png'])

  const requests = await webview.sentOf('resolveImage')
  const inside = requests.find((request) => request.source === 'images/a.png')!
  const climbing = requests.find((request) => request.source === '../assets/b.png')!
  await webview.send({ type: 'image', id: inside.id, uri: ORIGIN + '/workspace/a.png' })
  await webview.send({ type: 'image', id: climbing.id, uri: null })

  await expect(page.locator('.cm-md-image__img')).toHaveAttribute(
    'src',
    ORIGIN + '/workspace/a.png',
  )
  await expect(page.locator('.cm-md-image__missing')).toContainText('../assets/b.png')
  await expect(page.locator('.cm-line', { hasText: 'tracker.example' })).toBeVisible()

  expect(seen.external).toEqual([])
  expect(seen.errors).toEqual([])
})

test('hands a link to the extension only after checking its protocol', async ({ page }) => {
  const seen = watch(page)
  const webview = await openDocument(
    page,
    '[safe](https://example.com) and [unsafe](javascript:alert(1))\n\ntail',
  )
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')

  await page.locator('.cm-md-link').nth(1).click({ modifiers: ['ControlOrMeta'] })
  await page.locator('.cm-md-link').first().click({ modifiers: ['ControlOrMeta'] })

  await expect.poll(() => webview.sentOf('openLink')).toEqual([
    { type: 'openLink', href: 'https://example.com' },
  ])
  expect(seen.dialogs).toEqual([])
})

test('a link in a rendered table follows the same two rules', async ({ page, context }) => {
  const webview = await openDocument(
    page,
    '| site |\n| --- |\n| [safe](https://example.com) |\n\ntail',
  )
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')

  const link = page.locator('.cm-md-table a')
  await expect(link).toBeVisible()

  // A plain click edits; it must not open anything, here or in VS Code.
  await link.click()
  expect(await webview.sentOf('openLink')).toEqual([])

  await page.keyboard.press('ControlOrMeta+End')
  await page.locator('.cm-md-table a').click({ modifiers: ['ControlOrMeta'] })

  await expect.poll(() => webview.sentOf('openLink')).toEqual([
    { type: 'openLink', href: 'https://example.com' },
  ])
  // Through the extension, never by the page navigating or opening a tab itself.
  expect(context.pages()).toHaveLength(1)
  expect(page.url()).toBe(ORIGIN + '/')
})

test('follows the VS Code theme and the width setting', async ({ page }) => {
  const webview = await openDocument(page, 'text')
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme)

  expect(await theme()).toBe('light')

  await page.evaluate(() => document.body.classList.add('vscode-dark'))
  await expect.poll(theme).toBe('dark')

  await page.evaluate(() => {
    document.body.classList.replace('vscode-dark', 'vscode-high-contrast-light')
    document.body.classList.add('vscode-high-contrast')
  })
  await expect.poll(theme).toBe('light')

  const maxWidth = () =>
    page.locator('.cm-content').evaluate((element) => getComputedStyle(element).maxWidth)

  expect(await maxWidth()).not.toBe('none')
  await webview.send({ type: 'config', wide: true })
  await expect.poll(maxWidth).toBe('none')
})

test('draws a Mermaid diagram within the policy', async ({ page }) => {
  const seen = watch(page)
  await openDocument(page, '```mermaid\ngraph TD\n    A --> B\n```\n\ntail')
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')

  // Mermaid arrives as separate chunks, loaded only now; the policy has to allow
  // exactly that and nothing more.
  await expect(page.locator('.cm-md-diagram svg')).toBeVisible()

  expect(seen.errors).toEqual([])
  expect(seen.external).toEqual([])
})

test('nothing in a hostile document executes or leaves the page', async ({ page }) => {
  const seen = watch(page)
  const webview = await openDocument(
    page,
    [
      '# Hostile document',
      '',
      '<script>window.__pwned = true; alert("script tag")</script>',
      '',
      '<img src=x onerror="window.__pwned = true; alert(\'img onerror\')">',
      '',
      '<iframe src="https://evil.example/frame"></iframe>',
      '',
      '<svg onload="alert(3)"><circle r="10"/></svg>',
      '',
      '[a javascript link](javascript:alert(4))',
      '',
      '![a remote image](https://tracker.example/pixel.png)',
      '',
      '![a data image](data:image/svg+xml,<svg onload="alert(6)"/>)',
      '',
      '<style>body { display: none }</style>',
      '',
      'The end.',
      '',
    ].join('\n'),
  )
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')

  // Walk the whole document: every line gets rendered and decorated.
  for (let index = 0; index < 30; index += 1) await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(500)

  const injected = await page.evaluate(() => {
    const content = document.querySelector('.cm-content')!
    return {
      pwned: (window as unknown as { __pwned?: boolean }).__pwned ?? false,
      scripts: content.querySelectorAll('script').length,
      iframes: content.querySelectorAll('iframe').length,
      styles: content.querySelectorAll('style:not(svg style)').length,
      handlers: [...content.querySelectorAll('*')].filter((node) =>
        [...node.attributes].some((attribute) => attribute.name.toLowerCase().startsWith('on')),
      ).length,
    }
  })

  expect(injected).toEqual({ pwned: false, scripts: 0, iframes: 0, styles: 0, handlers: 0 })
  expect(seen.dialogs).toEqual([])
  expect(seen.external).toEqual([])
  expect(seen.errors).toEqual([])

  // Reading it asked for nothing and changed nothing.
  expect(await webview.sentOf('edit')).toEqual([])
  expect(await webview.sentOf('openLink')).toEqual([])
  expect(await webview.sentOf('resolveImage')).toEqual([])
})

test('a diagram label cannot reach a remote host or run script', async ({ page }) => {
  const seen = watch(page)
  const contacted: string[] = []

  // Would answer, if anything got as far as the network.
  await page.route('https://tracker.example/**', (route) => {
    contacted.push(route.request().url())
    return route.fulfill({ contentType: 'image/png', body: '' })
  })

  await openDocument(
    page,
    [
      '```mermaid',
      'graph TD',
      '    A["<img src=https://tracker.example/pixel.png>"] --> B["<img src=x onerror=alert(1)>"]',
      '```',
      '',
      'tail',
    ].join('\n'),
  )
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  // Drawn or refused, either way Mermaid has finished with it.
  await expect(page.locator('.cm-md-diagram')).toBeVisible()
  await expect(page.locator('.cm-md-diagram__pending')).toHaveCount(0)
  await page.waitForTimeout(500)

  // While rendering, Mermaid does make the browser try to load an <img> written in
  // a label. So this is the policy holding (`img-src` names no remote host), not
  // the renderer declining.
  expect(contacted).toEqual([])
  expect(seen.dialogs).toEqual([])
  expect(await page.locator('[onerror]').count()).toBe(0)
})
