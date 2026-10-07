import { expect, test, type Page } from '@playwright/test'

import { openWebview, ORIGIN, PIXEL } from './support/webviewHarness'

/**
 * The VS Code extension's webview, exercised as a page.
 *
 * What is under test is the built bundle and the real page with its Content
 * Security Policy; VS Code is replaced by the harness. That covers everything on
 * the webview's side of the protocol. The extension's side needs VS Code itself
 * and is covered by vscode/test/smoke.
 */

const TRACKER = 'https://tracker.example/pixel.png'

/**
 * Anything that would prove script ran, a request went out, or the policy was hit.
 *
 * `external` is every request that left the webview's own origin, written as the
 * kind of thing asked for and its address. An image on the web is the one thing a
 * document may make the page ask for, so the web is stood in for here: every
 * `https:` address answers with a one-pixel image, and no test touches the network.
 */
async function watch(page: Page) {
  const dialogs: string[] = []
  const external: string[] = []
  const errors: string[] = []

  await page.route((url) => url.protocol === 'https:', (route) => route.fulfill({ contentType: 'image/png', body: PIXEL }))

  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  page.on('request', (request) => {
    if (!request.url().startsWith(ORIGIN)) {
      external.push(request.resourceType() + ' ' + request.url())
    }
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
  const seen = await watch(page)
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

test('asks the extension where a local image is, and loads one from the web itself', async ({ page }) => {
  const seen = await watch(page)
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

  // Where a file may be read from is the extension's decision, so both local ones
  // are asked about. The remote one is not the extension's business.
  const asked = async () => (await webview.sentOf('resolveImage')).map((m) => m.source).sort()
  await expect.poll(asked).toEqual(['../assets/b.png', 'images/a.png'])

  const requests = await webview.sentOf('resolveImage')
  const inside = requests.find((request) => request.source === 'images/a.png')!
  const climbing = requests.find((request) => request.source === '../assets/b.png')!
  await webview.send({ type: 'image', id: inside.id, uri: ORIGIN + '/workspace/a.png' })
  await webview.send({ type: 'image', id: climbing.id, uri: null })

  await expect(page.getByAltText('inside')).toHaveAttribute('src', ORIGIN + '/workspace/a.png')
  await expect(page.locator('.cm-md-image__missing')).toContainText('../assets/b.png')

  // Loaded from where it says it is, within the policy, and telling that server
  // nothing about where it was asked from.
  const remote = page.getByAltText('remote')
  await expect(remote).toHaveAttribute('src', TRACKER)
  await expect(remote).toHaveAttribute('referrerpolicy', 'no-referrer')
  await expect.poll(() => remote.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1)

  expect(seen.external).toEqual(['image ' + TRACKER])
  expect(seen.errors).toEqual([])
})

test('draws HTML within the policy, and asks the extension for its images too', async ({ page }) => {
  const seen = await watch(page)
  const webview = await openDocument(
    page,
    [
      '<p align="center">',
      '  <img src="../assets/logo.png" width="40">',
      '  <img src="https://tracker.example/pixel.png">',
      '  <a href="https://example.com">the site</a>',
      '</p>',
      '',
      'Press <kbd>Ctrl</kbd>.',
      '',
      'tail',
    ].join('\n'),
  )
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')

  const block = page.locator('.cm-md-html')
  await expect(block).toBeVisible()
  await expect(page.locator('.cm-content kbd')).toHaveText('Ctrl')

  // The same question a Markdown image asks, and only about the local one.
  await expect.poll(async () => (await webview.sentOf('resolveImage')).map((m) => m.source)).toEqual([
    '../assets/logo.png',
  ])
  const [request] = await webview.sentOf('resolveImage')
  await webview.send({ type: 'image', id: request!.id, uri: ORIGIN + '/workspace/logo.png' })

  await expect(block.locator('img').first()).toHaveAttribute('src', ORIGIN + '/workspace/logo.png')
  await expect(block.locator('img').last()).toHaveAttribute('src', TRACKER)

  // A link in the block goes to the extension like any other, on Ctrl+click only.
  await block.locator('a').click({ modifiers: ['ControlOrMeta'] })
  await expect.poll(() => webview.sentOf('openLink')).toEqual([
    { type: 'openLink', href: 'https://example.com' },
  ])

  expect(seen.external).toEqual(['image ' + TRACKER])
  expect(seen.errors).toEqual([])
})

test('follows a link to a heading itself, without troubling the extension', async ({ page }) => {
  const webview = await openDocument(
    page,
    [
      '<p align="center"><a href="#far-below">Far below</a> and <a href="#nowhere">Nowhere</a></p>',
      '',
      '[Also there](#far-below)',
      '',
      ...Array.from({ length: 60 }, (_, index) => ['Paragraph ' + index + '.', '']).flat(),
      '## Far below',
      '',
      'The end.',
    ].join('\n'),
  )
  const scroller = page.locator('.cm-scroller')
  const heading = page.locator('.cm-md-h2')
  // Only what is on screen is in the page, so the heading is not there yet.
  await expect(heading).toHaveCount(0)

  // The cursor starts on the first line, which is the block: move it off.
  await page.locator('.cm-line', { hasText: 'Paragraph 0.' }).click()

  // A plain click is an edit, as on any link.
  await page.locator('.cm-md-html a', { hasText: 'Far below' }).click()
  await expect(page.locator('.cm-md-html')).toHaveCount(0)

  await page.locator('.cm-line', { hasText: 'Paragraph 0.' }).click()
  await page.locator('.cm-md-html a', { hasText: 'Far below' }).click({ modifiers: ['ControlOrMeta'] })
  await expect(heading).toBeInViewport()
  await expect(heading).toContainText('Far below')

  // The same from a Markdown link, after going back to the top.
  await scroller.evaluate((element) => element.scrollTo(0, 0))
  await page.locator('.cm-md-link', { hasText: 'Also there' }).click({ modifiers: ['ControlOrMeta'] })
  await expect(heading).toBeInViewport()

  // None of it is the extension's business, and a name with no heading goes nowhere.
  await scroller.evaluate((element) => element.scrollTo(0, 0))
  await page.locator('.cm-md-html a', { hasText: 'Nowhere' }).click({ modifiers: ['ControlOrMeta'] })
  await page.waitForTimeout(300)
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0)
  expect(await webview.sentOf('openLink')).toEqual([])
})

test('hands a link to the extension only after checking its protocol', async ({ page }) => {
  const seen = await watch(page)
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
  const seen = await watch(page)
  await openDocument(page, '```mermaid\ngraph TD\n    A --> B\n```\n\ntail')
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')

  // Mermaid arrives as separate chunks, loaded only now; the policy has to allow
  // exactly that and nothing more.
  await expect(page.locator('.cm-md-diagram svg')).toBeVisible()

  expect(seen.errors).toEqual([])
  expect(seen.external).toEqual([])
})

test('nothing in a hostile document executes, and all it can fetch is an image', async ({ page }) => {
  const seen = await watch(page)
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
  // The remote image, as an image. Not the frame, and nothing from the script.
  expect(seen.external).toEqual(['image ' + TRACKER])
  expect(seen.errors).toEqual([])

  // Reading it changed nothing and opened nothing. The one thing asked of the
  // extension is where the relative `<img src=x>` is, which is a question, and
  // one the extension answers by its own rules.
  expect(await webview.sentOf('edit')).toEqual([])
  expect(await webview.sentOf('openLink')).toEqual([])
  expect((await webview.sentOf('resolveImage')).map((request) => request.source)).toEqual(['x'])
})

test('a diagram label cannot run script, and can fetch nothing but an image', async ({ page }) => {
  const seen = await watch(page)

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

  // While rendering, Mermaid makes the browser load an <img> written in a label.
  // It is an image like any other in the document, and that is all it is: the
  // handler beside it never became an attribute, and nothing else was asked for.
  for (const request of seen.external) expect(request).toMatch(/^image /)
  expect(seen.dialogs).toEqual([])
  expect(await page.locator('[onerror]').count()).toBe(0)
})
