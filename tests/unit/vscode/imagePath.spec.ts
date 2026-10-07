import { describe, expect, it } from 'vitest'

import { isInside, resolveImagePath } from '../../../vscode/src/imagePath'

/**
 * Which images the extension will hand to the webview.
 *
 * The same privacy boundary as the web app, with the workspace folder as the edge
 * instead of the document's own folder.
 */

const ROOT = '/home/someone/notes'
const DOCUMENT = '/home/someone/notes/docs/guide.md'

describe('images inside the workspace', () => {
  it.each([
    ['picture.png', '/home/someone/notes/docs/picture.png'],
    ['./picture.png', '/home/someone/notes/docs/picture.png'],
    ['images/picture.jpg', '/home/someone/notes/docs/images/picture.jpg'],
    ['a picture with spaces.webp', '/home/someone/notes/docs/a picture with spaces.webp'],
    ['PICTURE.PNG', '/home/someone/notes/docs/PICTURE.PNG'],
    ['diagram.svg', '/home/someone/notes/docs/diagram.svg'],
  ])('resolves %j', (source, expected) => {
    expect(resolveImagePath(DOCUMENT, ROOT, source)).toBe(expected)
  })

  it.each([
    ['../assets/diagram.png', '/home/someone/notes/assets/diagram.png'],
    ['../docs/picture.png', '/home/someone/notes/docs/picture.png'],
    ['images/../picture.png', '/home/someone/notes/docs/picture.png'],
    ['..\\assets\\diagram.png', '/home/someone/notes/assets/diagram.png'],
  ])('lets %j climb, because it stays in the workspace', (source, expected) => {
    expect(resolveImagePath(DOCUMENT, ROOT, source)).toBe(expected)
  })
})

describe('images that are never shown', () => {
  it.each([
    '../../outside.png',
    '../../../../../../etc/secret.png',
    '..\\..\\outside.png',
    'images/../../../outside.png',
    '../../notes-private/picture.png',
  ])('refuses %j, which leaves the workspace', (source) => {
    expect(resolveImagePath(DOCUMENT, ROOT, source)).toBeNull()
  })

  it.each([
    'https://tracker.example/pixel.png',
    'http://tracker.example/pixel.png',
    '//tracker.example/pixel.png',
    'data:image/png;base64,iVBORw0KGgo=',
    'file:///etc/passwd.png',
    'vscode-resource://anything/picture.png',
    'C:\\Users\\someone\\picture.png',
    '/etc/picture.png',
    '\\\\server\\share\\picture.png',
    '',
    '   ',
  ])('refuses %j, which is not a relative path', (source) => {
    expect(resolveImagePath(DOCUMENT, ROOT, source)).toBeNull()
  })

  it.each(['notes.md', 'script.js', 'page.html', 'picture.png.exe', 'picture', '../secrets.env'])(
    'refuses %j, which is not an image',
    (source) => {
      expect(resolveImagePath(DOCUMENT, ROOT, source)).toBeNull()
    },
  )

  it('does not mistake a sibling folder for the workspace', () => {
    // `/home/someone/notes-private` starts with the root's characters, not its path.
    expect(isInside(ROOT, '/home/someone/notes-private/picture.png')).toBe(false)
    expect(isInside(ROOT, '/home/someone/notes/picture.png')).toBe(true)
    expect(isInside(ROOT + '/', '/home/someone/notes/picture.png')).toBe(true)
  })
})

describe('a document opened on its own', () => {
  it('reads only from its own folder', () => {
    const folder = '/home/someone/notes/docs'

    expect(resolveImagePath(DOCUMENT, folder, 'picture.png')).toBe(folder + '/picture.png')
    expect(resolveImagePath(DOCUMENT, folder, '../assets/diagram.png')).toBeNull()
  })
})

describe('Windows paths', () => {
  const root = '/c:/Users/someone/notes'
  const document = '/c:/Users/someone/notes/guide.md'

  it('resolves inside the workspace', () => {
    expect(resolveImagePath(document, root, 'images/a.png', true)).toBe(
      '/c:/Users/someone/notes/images/a.png',
    )
  })

  it('compares the drive letter without regard to case', () => {
    expect(resolveImagePath(document, '/C:/Users/someone/notes', 'a.png', true)).toBe(
      '/c:/Users/someone/notes/a.png',
    )
    expect(resolveImagePath(document, '/C:/Users/someone/notes', 'a.png', false)).toBeNull()
  })

  it('cannot climb past the drive', () => {
    expect(resolveImagePath('/c:/guide.md', '/c:', '../../../a.png', true)).toBeNull()
  })
})
