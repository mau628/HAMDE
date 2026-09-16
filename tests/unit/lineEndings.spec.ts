import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import { detectLineEnding, fromLf, toLf } from '../../app/services/lineEndings'

/**
 * Line endings are a data-integrity concern, not a formatting preference: getting
 * them wrong rewrites every line of a file the user only meant to add a word to.
 */

describe('the problem these exist for', () => {
  it('CodeMirror normalises a document to LF when it loads it', () => {
    const state = EditorState.create({ doc: 'a\r\nb\r\n' })

    // This is why the ending has to be remembered separately: by the time the text
    // comes back out of the editor, the file's own endings are gone.
    expect(state.doc.toString()).toBe('a\nb\n')
  })
})

describe('detectLineEnding', () => {
  it.each([
    ['LF', 'a\nb\nc\n', '\n'],
    ['CRLF', 'a\r\nb\r\nc\r\n', '\r\n'],
    ['CR', 'a\rb\rc\r', '\r'],
    ['no line breaks at all', 'single line', '\n'],
    ['an empty document', '', '\n'],
  ])('detects %s', (_label, text, expected) => {
    expect(detectLineEnding(text)).toBe(expected)
  })

  it('picks the majority in a mixed file', () => {
    // Rewriting a file makes it consistent, so the common ending wins.
    expect(detectLineEnding('a\r\nb\r\nc\n')).toBe('\r\n')
    expect(detectLineEnding('a\nb\nc\r\n')).toBe('\n')
  })

  it('does not mistake a CR inside CRLF for a lone CR', () => {
    expect(detectLineEnding('a\r\nb\r\n')).toBe('\r\n')
  })
})

describe('toLf', () => {
  it.each([
    ['CRLF', 'a\r\nb\r\n', 'a\nb\n'],
    ['CR', 'a\rb\r', 'a\nb\n'],
    ['mixed', 'a\r\nb\nc\r', 'a\nb\nc\n'],
    ['LF, unchanged', 'a\nb\n', 'a\nb\n'],
    ['nothing at all', '', ''],
  ])('converts %s', (_label, text, expected) => {
    expect(toLf(text)).toBe(expected)
  })
})

describe('fromLf', () => {
  it.each([
    ['\n' as const, 'a\nb\n'],
    ['\r\n' as const, 'a\r\nb\r\n'],
    ['\r' as const, 'a\rb\r'],
  ])('writes %j endings', (ending, expected) => {
    expect(fromLf('a\nb\n', ending)).toBe(expected)
  })

  it('leaves text with no line breaks alone', () => {
    expect(fromLf('single line', '\r\n')).toBe('single line')
  })
})

describe('round trip', () => {
  it.each([
    'a\r\nb\r\nc\r\n',
    'a\nb\nc\n',
    'a\rb\rc\r',
    '# Heading\r\n\r\n- [ ] task\r\n',
    'no trailing newline\r\nsecond',
    '',
  ])('reads and writes %j unchanged', (original) => {
    const ending = detectLineEnding(original)

    // What the app does: normalise on the way in, restore on the way out. An
    // untouched document must come back out byte for byte.
    expect(fromLf(toLf(original), ending)).toBe(original)
  })

  it('keeps the file consistent after an edit', () => {
    const original = '# Note\r\n\r\nFirst line.\r\n'
    const ending = detectLineEnding(original)
    const edited = toLf(original) + 'Added line.\n'

    expect(fromLf(edited, ending)).toBe('# Note\r\n\r\nFirst line.\r\nAdded line.\r\n')
  })
})
