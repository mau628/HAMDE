import { describe, expect, it } from 'vitest'

import {
  hasScheme,
  isLocalPath,
  isRemoteImage,
  isWorkspacePath,
  resolvePath,
} from '../../app/services/imagePath'

/**
 * Which image sources the editor will load, and from where.
 *
 * There are two places an image may come from: the user's own folder, and an
 * `https:` address. Everything here is about keeping those two apart, and about
 * nothing else being either.
 */

describe('images on the web', () => {
  it.each([
    'https://img.shields.io/badge/a-b-blue',
    'https://raw.githubusercontent.com/owner/repo/main/logo.png',
    '  https://example.com/a.png  ',
    'HTTPS://EXAMPLE.COM/a.png',
    'https://example.com/a.png?style=for-the-badge&logo=x#frag',
  ])('loads %j', (source) => {
    expect(isRemoteImage(source)).toBe(true)
  })

  it.each([
    ['plain http', 'http://example.com/a.png'],
    ['a protocol-relative address', '//example.com/a.png'],
    ['a data URI', 'data:image/png;base64,iVBORw0KGgo='],
    ['a blob', 'blob:https://example.com/uuid'],
    ['a file', 'file:///etc/passwd'],
    ['script', 'javascript:alert(1)'],
    ['a scheme that only looks like it', 'https:example.com/a.png'],
    ['an address with nothing in it', 'https://'],
    ['a relative path', 'images/a.png'],
    ['a path that mentions one', 'images/https://example.com/a.png'],
    ['nothing', ''],
  ])('does not load %s', (_name, source) => {
    expect(isRemoteImage(source)).toBe(false)
  })

  it('is never also a path in the workspace', () => {
    // One source, one place to load it from: the two rules cannot both say yes.
    for (const source of ['https://example.com/a.png', 'images/a.png', '../a.png', 'data:x']) {
      expect(isRemoteImage(source) && isLocalPath(source)).toBe(false)
    }
  })
})

describe('sources that are not a path in the folder', () => {
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

describe('paths a host with its own boundary may still resolve', () => {
  it.each(['../outside.png', 'images/../../outside.png', 'picture.png'])(
    'treats %j as a local path, leaving the boundary to the host',
    (source) => {
      expect(isLocalPath(source)).toBe(true)
    },
  )

  it.each([
    'https://tracker.example/pixel.png',
    'data:image/png;base64,iVBORw0KGgo=',
    'file:///etc/passwd',
    'C:\\Users\\someone\\picture.png',
    '/absolute.png',
    '\\\\server\\share\\picture.png',
    '',
  ])('still refuses %j', (source) => {
    expect(isLocalPath(source)).toBe(false)
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
