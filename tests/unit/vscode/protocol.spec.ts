import { describe, expect, it } from 'vitest'

import { parseWebviewMessage, sameShape } from '../../../vscode/src/protocol'

/**
 * The webview renders untrusted Markdown, so the extension checks every message it
 * sends before acting on it. A message that is not exactly the expected shape is
 * dropped, not repaired.
 */

const position = { line: 0, character: 0 }
const change = { start: position, end: position, text: 'a' }
const shape = { length: 1, lines: 1 }

describe('messages the extension accepts', () => {
  it.each([
    { type: 'ready' },
    { type: 'resync' },
    { type: 'edit', seenSeq: 3, changes: [change], shape },
    { type: 'edit', seenSeq: 0, changes: [], shape },
    { type: 'resolveImage', id: 1, source: 'images/a.png' },
    { type: 'openLink', href: 'https://example.com' },
  ])('accepts %j', (message) => {
    expect(parseWebviewMessage(message)).toEqual(message)
  })

  it('keeps only the fields it knows', () => {
    expect(parseWebviewMessage({ type: 'ready', extra: 'ignored' })).toEqual({ type: 'ready' })
  })
})

describe('messages the extension drops', () => {
  it.each([
    null,
    undefined,
    'ready',
    42,
    [],
    {},
    { type: 'unknown' },
    { type: 'edit' },
    { type: 'edit', seenSeq: '3', changes: [change], shape },
    { type: 'edit', seenSeq: -1, changes: [change], shape },
    { type: 'edit', seenSeq: 1.5, changes: [change], shape },
    { type: 'edit', seenSeq: 3, changes: 'nope', shape },
    { type: 'edit', seenSeq: 3, changes: [{ ...change, text: 1 }], shape },
    { type: 'edit', seenSeq: 3, changes: [{ ...change, start: { line: -1, character: 0 } }], shape },
    { type: 'edit', seenSeq: 3, changes: [{ ...change, end: { line: 0 } }], shape },
    { type: 'edit', seenSeq: 3, changes: [change], shape: { length: 1 } },
    { type: 'edit', seenSeq: 3, changes: [change] },
    { type: 'resolveImage', id: 1 },
    { type: 'resolveImage', id: '1', source: 'a.png' },
    { type: 'openLink' },
    { type: 'openLink', href: { toString: () => 'javascript:alert(1)' } },
  ])('drops %j', (message) => {
    expect(parseWebviewMessage(message)).toBeNull()
  })
})

describe('telling two copies of a document apart', () => {
  it('matches on both length and line count', () => {
    expect(sameShape({ length: 10, lines: 2 }, { length: 10, lines: 2 })).toBe(true)
    expect(sameShape({ length: 10, lines: 2 }, { length: 11, lines: 2 })).toBe(false)
    expect(sameShape({ length: 10, lines: 2 }, { length: 10, lines: 3 })).toBe(false)
  })
})
