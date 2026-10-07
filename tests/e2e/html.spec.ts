import { expect, test, type Page } from '@playwright/test'

import { installFakePicker, TINY_PNG } from './support/installFakePicker'

/**
 * HTML in a document, drawn.
 *
 * The rule for what may be drawn is unit-tested as data (tests/unit/htmlModel.spec.ts).
 * These tests are about the page: that what is drawn is what the model allowed and
 * nothing else, and that a rendered block can still be read, opened and edited.
 */

const LOGO = ['<p align="center">', '  <img src="logo.png" alt="The logo" width="48">', '</p>'].join('\n')

async function openDocument(page: Page, contents: string) {
  await installFakePicker(page, { 'note.md': contents, 'logo.png': TINY_PNG })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name: 'note.md' }).click()
  await expect(page.locator('.status__path')).toHaveText('note.md')
  // The cursor goes to the last line, so nothing above it is revealed.
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
}

async function visibleText(page: Page): Promise<string> {
  return (await page.locator('.cm-line').allInnerTexts()).join('\n')
}

test('draws a block of HTML in place of its source', async ({ page }) => {
  await openDocument(page, '# Title\n\n' + LOGO + '\n\ntail\n')

  const block = page.locator('.cm-md-html')
  await expect(block).toBeVisible()
  expect(await visibleText(page)).not.toContain('<p align')

  // The image comes from the folder, through the same path as a Markdown image.
  const image = block.locator('img')
  await expect(image).toHaveAttribute('src', /^blob:/)
  await expect(image).toHaveAttribute('alt', 'The logo')
  expect(await image.evaluate((element: HTMLImageElement) => element.width)).toBe(48)
  expect(await block.locator('p').evaluate((p) => getComputedStyle(p).textAlign)).toBe('center')
})

test('a click on the block shows its source, and leaving it draws it again', async ({ page }) => {
  await openDocument(page, '# Title\n\n' + LOGO + '\n\ntail\n')

  await page.locator('.cm-md-html').click()
  await expect(page.locator('.cm-md-html')).toHaveCount(0)
  expect(await visibleText(page)).toContain('<p align="center">')

  await page.locator('.cm-line', { hasText: 'tail' }).click()
  await expect(page.locator('.cm-md-html')).toBeVisible()
})

test('the arrow keys go into the block instead of over it', async ({ page }) => {
  await openDocument(page, '# Title\n\n' + LOGO + '\n\ntail\n')

  // From "tail": the empty line above it, then what would be a step over the block.
  await page.locator('.cm-line', { hasText: 'tail' }).click()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')

  await expect(page.locator('.cm-md-html')).toHaveCount(0)
  expect(await visibleText(page)).toContain('</p>')
})

test('editing the source changes what is drawn, and the file', async ({ page }) => {
  await openDocument(page, '<div>first</div>\n\ntail\n')

  await page.locator('.cm-md-html').click()
  await page.keyboard.press('Home')
  // Past `<div`, to where an attribute goes.
  for (let step = 0; step < 4; step += 1) await page.keyboard.press('ArrowRight')
  await page.keyboard.type(' align="right"')
  await page.locator('.cm-line', { hasText: 'tail' }).click()

  await expect(page.locator('.cm-md-html div')).toHaveCSS('text-align', 'right')
  await expect(page.locator('.status__state')).toHaveText('Saved')
})

test('a details element opens and closes without showing its source', async ({ page }) => {
  await openDocument(page, '<details><summary>More</summary>The hidden part</details>\n\ntail\n')

  const details = page.locator('.cm-md-html details')
  await expect(details).not.toHaveAttribute('open', '')

  await page.locator('.cm-md-html summary').click()
  await expect(details).toHaveAttribute('open', '')
  await expect(page.getByText('The hidden part')).toBeVisible()
  // Still drawn: the click was for the element, not for the editor.
  await expect(page.locator('.cm-md-html')).toBeVisible()
})

test('a link in a block opens on Ctrl+click, and only then', async ({ page, context }) => {
  // The link is followed by the browser itself, in a new tab. What it asks for is
  // answered here, so the test sees the request and does not need the network.
  const followed: string[] = []
  await context.route('https://example.com/**', (route) => {
    followed.push(route.request().url())
    return route.fulfill({ contentType: 'text/html', body: '<title>the site</title>' })
  })
  await openDocument(page, '<p>Visit <a href="https://example.com">the site</a>.</p>\n\ntail\n')

  // A plain click is a click on editable text: it puts the cursor in the block.
  await page.locator('.cm-md-html a').click()
  await page.waitForTimeout(300)
  expect(context.pages()).toHaveLength(1)
  expect(followed).toEqual([])
  await expect(page.locator('.cm-md-html')).toHaveCount(0)

  await page.locator('.cm-line', { hasText: 'tail' }).click()
  await page.locator('.cm-md-html a').click({ modifiers: ['ControlOrMeta'] })

  await expect.poll(() => followed).toEqual(['https://example.com/'])
  // Ctrl+click is not an edit: the block is still drawn.
  await expect(page.locator('.cm-md-html')).toBeVisible()
})

test('inline HTML is drawn in the text, as real elements of the kind named', async ({ page }) => {
  await openDocument(
    page,
    'Press <kbd>Ctrl</kbd>+<kbd>S</kbd> for H<sub>2</sub>O and a<br>break.\n\ntail\n',
  )

  await expect(page.locator('.cm-content kbd')).toHaveText(['Ctrl', 'S'])
  await expect(page.locator('.cm-content sub')).toHaveText('2')
  await expect(page.locator('.cm-content .cm-md-html-br br')).toHaveCount(1)
  expect(await visibleText(page)).not.toContain('<kbd>')

  // On the line the cursor is on it is source again, like any other syntax.
  await page.locator('.cm-line', { hasText: 'Press' }).click()
  await expect.poll(() => visibleText(page)).toContain('<kbd>Ctrl</kbd>')
})

test('an inline link opens on Ctrl+click, after its target is checked', async ({ page, context }) => {
  await openDocument(
    page,
    'A <a href="https://example.com">good</a> and a <a href="javascript:alert(1)">bad</a> one.\n\ntail\n',
  )

  // The bad one was never made a link at all: it is still the text it was.
  expect(await visibleText(page)).toContain('<a href="javascript:alert(1)">bad</a>')

  const opened = context.waitForEvent('page')
  await page.locator('.cm-md-link', { hasText: 'good' }).click({ modifiers: ['ControlOrMeta'] })
  const tab = await opened
  expect(tab.url()).toBe('https://example.com/')
  await tab.close()
})

test('nothing of the document reaches the page but what was allowed', async ({ page }) => {
  const dialogs: string[] = []
  const external: string[] = []
  // The web, stood in for: any `https:` address answers with a one-pixel image.
  await page.route((url) => url.protocol === 'https:', (route) =>
    route.fulfill({ contentType: TINY_PNG.type, body: Buffer.from(TINY_PNG.base64, 'base64') }),
  )
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== 'localhost') {
      external.push(request.resourceType() + ' ' + request.url())
    }
  })

  await openDocument(
    page,
    [
      '<div class="shell__explorer" id="app" style="position:fixed;inset:0" onclick="alert(1)" data-x="1">',
      '  <b onmouseover="alert(2)">kept text</b>',
      '  <script>alert(3)</script>',
      '  <style>body { display: none }</style>',
      '  <iframe src="https://evil.example/frame"></iframe>',
      '  <img src="https://tracker.example/pixel.png" onerror="alert(4)">',
      '  <a href="javascript:alert(5)" onclick="alert(6)">a link</a>',
      '  <form action="https://evil.example"><input name="q" autofocus onfocus="alert(7)"></form>',
      '  <svg onload="alert(8)"><circle r="10"/></svg>',
      '</div>',
      '',
      'tail',
      '',
    ].join('\n'),
  )

  const block = page.locator('.cm-md-html')
  await expect(block).toContainText('kept text')
  await page.waitForTimeout(500)

  const found = await block.evaluate((container) => {
    const elements = [...container.querySelectorAll('*')]
    return {
      tags: [...new Set(elements.map((element) => element.tagName.toLowerCase()))].sort(),
      attributes: [...new Set(elements.flatMap((element) => element.getAttributeNames()))].sort(),
    }
  })

  // The elements are the allowed ones. Of the document's attributes, the image's
  // address is the only one that survived; the rest are ones this editor sets on
  // every image it draws.
  expect(found.tags).toEqual(['a', 'b', 'div', 'img', 'span'])
  expect(found.attributes).toEqual(['alt', 'class', 'referrerpolicy', 'src'])

  // The image is loaded, as an image, and that is the one request there was.
  await expect(block.locator('img')).toHaveAttribute('src', 'https://tracker.example/pixel.png')
  // The page is still the page: the block could not restyle or cover it.
  await expect(page.getByRole('button', { name: 'Open another folder' })).toBeVisible()
  expect(await block.locator('div').evaluate((div) => getComputedStyle(div).position)).toBe('static')

  expect(dialogs).toEqual([])
  expect(external).toEqual(['image https://tracker.example/pixel.png'])
})

test('the header of a README is drawn as one: logo, badges and a table of contents', async ({ page }) => {
  await page.route((url) => url.protocol === 'https:', (route) =>
    route.fulfill({ contentType: TINY_PNG.type, body: Buffer.from(TINY_PNG.base64, 'base64') }),
  )

  await openDocument(
    page,
    [
      '<h1 align="center">',
      '    <br>',
      '    <a href="https://example.com">',
      '        <img src="https://img.example/logo.png" alt="The Project" width="150">',
      '    </a>',
      '    <br>',
      '    The Project',
      '    <br>',
      '</h1>',
      '',
      '<p align="center">',
      '  <img alt="License" src="https://img.example/license.svg?style=for-the-badge">',
      '  <a href="https://example.com/chat">',
      '    <img alt="Chat" src="https://img.example/chat.svg?style=for-the-badge&logo=x">',
      '  </a>',
      '</p>',
      '',
      '<p align="center">',
      // The name GitHub gives that heading: the `!` goes, and nothing takes its place.
      '  <a href="#why-theproject">Why The!Project</a> •',
      '  <a href="#license">License</a>',
      '</p>',
      '',
      '---',
      '',
      ...Array.from({ length: 50 }, (_, index) => ['Paragraph ' + index + '.', '']).flat(),
      '## Why The!Project',
      '',
      'Because.',
      '',
      '## License',
      '',
      'tail',
      '',
    ].join('\n'),
  )
  // Ctrl+End left the view at the bottom; the header is at the top.
  await page.locator('.cm-scroller').evaluate((element) => element.scrollTo(0, 0))

  const title = page.locator('.cm-md-html h1')
  await expect(title).toContainText('The Project')
  await expect(title).toHaveCSS('text-align', 'center')
  // The rule every title has under it, here too.
  await expect(title).toHaveCSS('border-bottom-width', '1px')

  // Every image is there, at the size and with the description it was given.
  const logo = page.getByAltText('The Project')
  await expect(logo).toHaveAttribute('src', 'https://img.example/logo.png')
  expect(await logo.evaluate((image: HTMLImageElement) => image.width)).toBe(150)
  for (const name of ['License', 'Chat']) {
    await expect.poll(() => page.getByAltText(name).evaluate((image: HTMLImageElement) => image.complete)).toBe(true)
  }

  // An image that is a link is a link, and the table of contents goes to its headings.
  await expect(page.locator('.cm-md-html a:has(img)')).toHaveCount(2)
  await page.locator('.cm-md-html a', { hasText: 'Why The!Project' }).click({ modifiers: ['ControlOrMeta'] })
  await expect(page.locator('.cm-md-h2', { hasText: 'Why The!Project' })).toBeInViewport()
})
