import { EditorState, type ChangeSpec } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import type { TextChange } from '../../../vscode/src/protocol'
import { offsetAt, positionAt, shapeOf, toTextChanges } from '../../../vscode/src/webview/changes'

/**
 * The translation between CodeMirror's offsets and the line/character positions the
 * extension and VS Code use. A mistake here does not crash: it puts a keystroke in
 * the wrong place in the user's file.
 */

function edit(text: string, changes: ChangeSpec): { sent: TextChange[]; after: string } {
  const state = EditorState.create({ doc: text })
  const transaction = state.update({ changes })

  return {
    sent: toTextChanges(transaction.changes, state.doc),
    after: transaction.state.doc.toString(),
  }
}

/** What VS Code does with an edit: every range refers to the text before it. */
function applyAsVsCode(text: string, changes: TextChange[]): string {
  const lines = text.split('\n')
  const offset = (line: number, character: number) =>
    lines.slice(0, line).reduce((sum, each) => sum + each.length + 1, 0) + character

  return [...changes]
    .sort((a, b) => offset(b.start.line, b.start.character) - offset(a.start.line, a.start.character))
    .reduce(
      (result, change) =>
        result.slice(0, offset(change.start.line, change.start.character)) +
        change.text +
        result.slice(offset(change.end.line, change.end.character)),
      text,
    )
}

describe('positions', () => {
  const { doc } = EditorState.create({ doc: 'first\nsecond\n\nfourth' })

  it.each([
    [0, { line: 0, character: 0 }],
    [5, { line: 0, character: 5 }],
    [6, { line: 1, character: 0 }],
    [12, { line: 1, character: 6 }],
    [13, { line: 2, character: 0 }],
    [20, { line: 3, character: 6 }],
  ])('offset %i is %j, and back', (offset, position) => {
    expect(positionAt(doc, offset)).toEqual(position)
    expect(offsetAt(doc, position)).toBe(offset)
  })

  it('counts a character outside the basic plane as two, as VS Code does', () => {
    const emoji = EditorState.create({ doc: 'a😀b' }).doc
    expect(positionAt(emoji, 3)).toEqual({ line: 0, character: 3 })
  })

  it('clamps a position that does not exist instead of throwing', () => {
    expect(offsetAt(doc, { line: 0, character: 99 })).toBe(5)
    expect(offsetAt(doc, { line: 99, character: 0 })).toBe(doc.length)
  })
})

describe('a document with Windows line endings', () => {
  // CodeMirror stores every line break as one character; VS Code keeps both.
  const { doc } = EditorState.create({ doc: 'first\r\nsecond\r\nthird' })

  it('gives the positions VS Code would, which offsets could not', () => {
    expect(positionAt(doc, doc.line(3).from)).toEqual({ line: 2, character: 0 })
    expect(shapeOf(doc)).toEqual({ length: 'first\nsecond\nthird'.length, lines: 3 })
  })
})

describe('what the user typed, as the extension receives it', () => {
  it.each<[string, string, ChangeSpec]>([
    ['typing a character', 'hello\nworld', { from: 5, insert: '!' }],
    ['typing at the very start', 'hello', { from: 0, insert: '# ' }],
    ['typing at the very end', 'hello\n', { from: 6, insert: 'x' }],
    ['deleting a character', 'hello\nworld', { from: 4, to: 5 }],
    ['replacing a selection', 'hello\nworld', { from: 1, to: 9, insert: 'EY' }],
    ['pressing Enter', 'hello world', { from: 5, insert: '\n' }],
    ['joining two lines', 'hello\nworld', { from: 5, to: 6 }],
    ['pasting several lines', 'a\nb', { from: 1, insert: '\none\ntwo\n' }],
    ['deleting everything', 'a\nb\nc', { from: 0, to: 5 }],
    ['ticking a task', '- [ ] one\n- [ ] two', { from: 13, to: 14, insert: 'x' }],
    [
      'editing with several cursors',
      'one\ntwo\nthree',
      [
        { from: 0, insert: '- ' },
        { from: 4, insert: '- ' },
        { from: 8, insert: '- ' },
      ],
    ],
    [
      'changes that grow and shrink the text at once',
      'alpha beta gamma',
      [
        { from: 0, to: 5, insert: 'a' },
        { from: 6, to: 10, insert: 'bbbbbbbb' },
        { from: 11, to: 16 },
      ],
    ],
  ])('%s', (_name, text, changes) => {
    const { sent, after } = edit(text, changes)
    expect(applyAsVsCode(text, sent)).toBe(after)
  })

  it('sends line breaks as \\n, leaving the file’s own to VS Code', () => {
    const { sent } = edit('a\r\nb', { from: 1, insert: '\r\nnew' })
    expect(sent).toEqual([
      { start: { line: 0, character: 1 }, end: { line: 0, character: 1 }, text: '\nnew' },
    ])
  })
})
