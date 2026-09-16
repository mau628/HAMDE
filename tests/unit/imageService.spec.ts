import { describe, expect, it } from 'vitest'

import { hasScheme, isWorkspacePath, resolvePath } from '../../app/services/imageService'

/**
 * Which image sources the editor will load.
 *
 * This is a privacy boundary rather than a convenience: fetching a remote image
 * tells that server which note is open and when.
 */

describe('sources that are never loaded', () => {
  it.each([
    'https://tracker.example/pixel.png',
    'http://tracker.example/pixel.png',
    '//tracker.example/pixel.png',
    'data:image/png;base64,iVBORw0KGgo=',
    'blob:https://example.com/uuid',
    'file:///etc/passwd',
    'javascript:alert(1)',
  ])('refuses %j', (source) => {
    expect(isWorkspacePath(source)).toBe(false)
  })

  it('recognises a scheme whatever its case or spacing', () => {
    expect(hasScheme('  HTTPS://example.com/a.png')).toBe(true)
    expect(hasScheme('picture.png')).toBe(false)
  })
})

describe('paths that stay inside the folder', () => {
  it.each([
    'picture.png',
    './picture.png',
    'images/picture.png',
    'images/nested/picture.png',
    'a picture with spaces.png',
  ])('accepts %j', (source) => {
    expect(isWorkspacePath(source)).toBe(true)
  })

  it.each([
    '../outside.png',
    '../../outside.png',
    'images/../../outside.png',
    '/absolute.png',
    '\\absolute.png',
    '',
    '   ',
  ])('refuses %j, which leaves the folder the user granted', (source) => {
    expect(isWorkspacePath(source)).toBe(false)
  })
})

describe('resolving a path against the document that references it', () => {
  it.each([
    ['note.md', 'picture.png', 'picture.png'],
    ['note.md', './picture.png', 'picture.png'],
    ['notes/note.md', 'picture.png', 'notes/picture.png'],
    ['notes/note.md', 'images/picture.png', 'notes/images/picture.png'],
    ['a/b/note.md', './img.png', 'a/b/img.png'],
  ])('%j + %j resolves to %j', (documentPath, source, expected) => {
    expect(resolvePath(documentPath, source)).toBe(expected)
  })
})
