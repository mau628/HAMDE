import { expect, test, type Page } from '@playwright/test'

import { installFakePicker, TINY_PNG } from './support/installFakePicker'

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

const TRACKER = 'https://tracker.example/pixel.png'

/**
 * Anything that would prove script ran, or that a request went out.
 *
 * `external` is every request to another origin, written as the kind of thing
 * asked for and its address, with the headers it carried kept beside it. An image
 * on the web is the one thing a document may make the page ask for, so the web is
 * stood in for here: every `https:` address answers with a one-pixel image, and no
 * test touches the network.
 */
async function watch(page: Page) {
  const dialogs: string[] = []
  const external: string[] = []
  const headers: Record<string, string>[] = []
  const errors: string[] = []

  await page.route((url) => url.protocol === 'https:', (route) =>
    route.fulfill({ contentType: TINY_PNG.type, body: Buffer.from(TINY_PNG.base64, 'base64') }),
  )

  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  page.on('request', (request) => {
    if (new URL(request.url()).hostname === 'localhost') return
    external.push(request.resourceType() + ' ' + request.url())
    void request.allHeaders().then((all) => headers.push(all))
  })
  page.on('pageerror', (error) => errors.push(error.message))

  return { dialogs, external, headers, errors }
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
  const seen = await watch(page)

  await openDocument(page, HOSTILE)
  await expect(page.locator('.cm-content')).toContainText('The end.')

  // Walk the whole document: every line gets rendered and decorated.
  for (let index = 0; index < 30; index += 1) await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(500)

  expect(seen.dialogs).toEqual([])
  // The remote image, asked for as an image. Not the frame, and nothing that the
  // script, the handlers or the links would have asked for had they run.
  expect(seen.external).toEqual(['image ' + TRACKER])
  expect(seen.errors).toEqual([])
  expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined()
})

test('embedded HTML becomes only the elements the editor allows', async ({ page }) => {
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

  // What can be drawn safely is: the text of the <div>, with nothing of its handlers.
  const block = page.locator('.cm-md-html', { hasText: 'hover me' })
  await expect(block).toBeVisible()
  expect(await block.locator('div').evaluate((div) => div.getAttributeNames())).toEqual([])

  // The image is one the folder does not have, so it is said to be missing. Its
  // `onerror` went nowhere: there is no element for it to be on.
  await expect(page.locator('.cm-md-html .cm-md-image__missing')).toHaveText('Image not found: x')

  // What cannot be drawn stays as the text it is, for the user to read and edit.
  const shown = (await page.locator('.cm-line').allInnerTexts()).join('\n')
  expect(shown).toContain('<script>')
  expect(shown).toContain('<iframe')
  expect(shown).toContain('<style>')
  expect(shown).toContain('<a href="javascript:alert(7)">')
})

test('the document is unchanged by having been opened and read', async ({ page }) => {
  await openDocument(page, HOSTILE)
  await page.waitForTimeout(900)

  const written = await page.evaluate(() => [
    ...(window as unknown as { __writtenFiles: Map<string, string> }).__writtenFiles.keys(),
  ])
  expect(written).toEqual([])
})

test('a remote image is loaded, and its server learns nothing but that it was asked', async ({
  page,
}) => {
  const seen = await watch(page)

  await openDocument(page, '# A private title\n\n![tracker](' + TRACKER + ')\n\nprivate text\n')

  const image = page.getByAltText('tracker')
  await expect(image).toHaveAttribute('src', TRACKER)
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1)

  // One request, for the image. No referrer to say which page asked, no cookie to
  // say who, and nothing of the document in the address or anywhere else.
  expect(seen.external).toEqual(['image ' + TRACKER])
  await expect.poll(() => seen.headers.length).toBe(1)
  expect(seen.headers[0]).not.toHaveProperty('referer')
  expect(seen.headers[0]).not.toHaveProperty('cookie')
  expect(JSON.stringify(seen.headers[0])).not.toContain('private')
})

test('only https images are loaded from the web', async ({ page }) => {
  const seen = await watch(page)
  const insecure: string[] = []
  await page.route('http://tracker.example/**', (route) => {
    insecure.push(route.request().url())
    return route.abort()
  })

  await openDocument(
    page,
    [
      '![plain http](http://tracker.example/pixel.png)',
      '',
      '![no scheme](//tracker.example/pixel.png)',
      '',
      '![data](data:image/png;base64,' + TINY_PNG.base64 + ')',
      '',
      'tail',
      '',
    ].join('\n'),
  )
  await page.waitForTimeout(500)

  // All three stay as the Markdown they are, and none was asked for.
  const shown = (await page.locator('.cm-line').allInnerTexts()).join('\n')
  expect(shown).toContain('![plain http](http://tracker.example/pixel.png)')
  expect(shown).toContain('![no scheme](//tracker.example/pixel.png)')
  expect(await page.locator('.cm-md-image').count()).toBe(0)
  expect(insecure).toEqual([])
  expect(seen.external).toEqual([])
})

test('an image that cannot be loaded leaves its description, not a broken picture', async ({ page }) => {
  // Offline, or the server no longer has it.
  await page.route('https://gone.example/**', (route) => route.abort())

  await openDocument(page, '![The project logo](https://gone.example/logo.png)\n\ntail\n')

  await expect(page.locator('.cm-md-image__missing')).toHaveText('The project logo')
  await expect(page.locator('.cm-md-image__img')).toHaveCount(0)
})

test('an image the workspace does not have says so', async ({ page }) => {
  await openDocument(page, '![missing](nope.png)\n\ntail\n')

  await expect(page.locator('.cm-md-image__missing')).toContainText('nope.png')
})

test('a link is only followed after its protocol is checked', async ({ page, context }) => {
  const seen = await watch(page)
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

test('an image is the only thing a document can make the page ask another origin for', async ({
  page,
}) => {
  const seen = await watch(page)

  await openDocument(
    page,
    [
      HOSTILE,
      // Everything else that names an address, each a way a page can be made to
      // call out: a style sheet, a frame, media, a form, a prefetch, a ping.
      '<div>',
      '<link rel="stylesheet" href="https://evil.example/style.css">',
      '<link rel="prefetch" href="https://evil.example/prefetch">',
      '<video src="https://evil.example/video.mp4" autoplay></video>',
      '<audio src="https://evil.example/audio.mp3" autoplay></audio>',
      '<object data="https://evil.example/object"></object>',
      '<embed src="https://evil.example/embed">',
      '<form action="https://evil.example/form"><input name="q" value="note"></form>',
      '<a href="https://example.com" ping="https://evil.example/ping">a link</a>',
      '<img src="https://tracker.example/badge.svg" srcset="https://evil.example/srcset.png 2x">',
      '</div>',
      '',
      '```mermaid',
      'graph TD',
      '    A["<img src=x onerror=alert(1)>"] --> B',
      '```',
      '',
    ].join('\n'),
  )
  await page.waitForTimeout(2000)

  // Images, and only the ones written as images.
  expect([...seen.external].sort()).toEqual([
    'image https://tracker.example/badge.svg',
    'image ' + TRACKER,
  ])
  expect(seen.dialogs).toEqual([])
})
