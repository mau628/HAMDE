import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import { linkTargetAt } from '../../app/editor/livePreview'
import { createMarkdownSupport } from '../../app/editor/markdown'
import { isSafeHref } from '../../app/services/links'

/**
 * `linkTargetAt` decides what a Ctrl+click may open, so it is tested directly.
 *
 * It previously returned the URL of an image, because it answered with the first
 * `URL` node it met on the way up instead of first checking whether that node was
 * inside an image. An image URL is the one target the editor must never follow on
 * its own: fetching it tells that server which note is open.
 */

function targetIn(doc: string, position: number): string | null {
  const state = EditorState.create({ doc, extensions: [createMarkdownSupport()] })
  return linkTargetAt(state, position)
}

/** The offset of `needle` in `doc`, plus one, so the position is inside it. */
function inside(doc: string, needle: string): number {
  const index = doc.indexOf(needle)
  if (index === -1) throw new Error('fixture does not contain ' + needle)
  return index + 1
}

describe('links', () => {
  it('returns the destination when the position is in the link text', () => {
    const doc = 'see [text](https://example.com) now\n'
    expect(targetIn(doc, inside(doc, 'text'))).toBe('https://example.com')
  })

  it('returns the destination when the position is in the URL itself', () => {
    const doc = '[text](https://example.com)\n'
    expect(targetIn(doc, inside(doc, 'https'))).toBe('https://example.com')
  })

  it('ignores a link title', () => {
    const doc = '[text](https://example.com "the title")\n'
    expect(targetIn(doc, inside(doc, 'text'))).toBe('https://example.com')
  })

  it('returns an autolink target', () => {
    const doc = 'see https://example.com now\n'
    expect(targetIn(doc, inside(doc, 'https'))).toBe('https://example.com')
  })

  it('unwraps a bracketed autolink, which is otherwise unopenable', () => {
    const doc = '<https://example.com>\n'
    const target = targetIn(doc, inside(doc, 'https'))

    expect(target).toBe('https://example.com')
    expect(isSafeHref(target!)).toBe(true)
  })

  it('unwraps a bracketed destination', () => {
    const doc = '[text](<https://example.com>)\n'
    const target = targetIn(doc, inside(doc, 'text'))

    expect(target).toBe('https://example.com')
    expect(isSafeHref(target!)).toBe(true)
  })

  it('returns nothing for a reference link, which has no destination of its own', () => {
    const doc = '[text][ref]\n\n[ref]: https://example.com\n'
    expect(targetIn(doc, inside(doc, 'text'))).toBeNull()
  })

  it('returns nothing for plain text', () => {
    const doc = 'just a paragraph\n'
    expect(targetIn(doc, inside(doc, 'paragraph'))).toBeNull()
  })

  it('returns nothing at the very end of the document', () => {
    const doc = '[text](https://example.com)\n'
    expect(targetIn(doc, doc.length)).toBeNull()
  })
})

describe('images are never a link target', () => {
  it.each([
    ['in the URL', '![alt](https://tracker.example/x.png)\n', 'https'],
    ['in the alt text', '![alt](https://tracker.example/x.png)\n', 'alt'],
    ['with a dangerous scheme', '![alt](javascript:alert(1))\n', 'javascript'],
    ['with a relative path', '![alt](cat.png)\n', 'cat'],
  ])('refuses an image %s', (_label, doc, needle) => {
    expect(targetIn(doc, inside(doc, needle))).toBeNull()
  })

  it('refuses the inner image of an image wrapped in a link', () => {
    const doc = '[![alt](inner.png)](https://example.com)\n'

    // Over the image, nothing opens — not the image, and not the link around it.
    expect(targetIn(doc, inside(doc, 'inner.png'))).toBeNull()
    expect(targetIn(doc, inside(doc, 'alt'))).toBeNull()
  })
})

describe('what the result is used for', () => {
  it('a dangerous target is returned but refused before opening', () => {
    const doc = '[click](javascript:alert(1))\n'
    const target = targetIn(doc, inside(doc, 'click'))

    // linkTargetAt reports what the document says; isSafeHref decides.
    expect(target).toBe('javascript:alert(1)')
    expect(isSafeHref(target!)).toBe(false)
  })

  it('a relative target is returned but not yet openable', () => {
    const doc = '[note](./other.md)\n'
    const target = targetIn(doc, inside(doc, 'note'))

    expect(target).toBe('./other.md')
    expect(isSafeHref(target!)).toBe(false)
  })
})
