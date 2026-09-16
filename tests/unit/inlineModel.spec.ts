import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { describe, expect, it } from 'vitest'

import { inlineModel, type InlineNode } from '../../app/editor/livePreview/inlineModel'
import { createMarkdownSupport } from '../../app/editor/markdown'
import { tableModel } from '../../app/editor/livePreview/tableModel'

/**
 * The inline content of a rendered block, as data.
 *
 * Inside a block widget there is no source to decorate, so the content is rebuilt.
 * These tests pin what that rebuild keeps and what it drops — the cases where a
 * naive "strip the markers" would either lose text or invent it.
 *
 * A table cell is used as the fixture because it is the construct that needs this.
 */

function stateFor(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [createMarkdownSupport()] })
}

function tableNode(state: EditorState): SyntaxNode {
  let found: SyntaxNode | null = null
  syntaxTree(state).iterate({
    enter: (node) => {
      if (found !== null) return false
      if (node.name === 'Table') found = node.node
      return true
    },
  })
  if (found === null) throw new Error('not a table')
  return found
}

/** The model of the first body cell of a one-column table containing `markdown`. */
function cell(markdown: string): InlineNode[] {
  const doc = ['| h |', '| - |', '| ' + markdown + ' |'].join('\n') + '\n'
  const state = stateFor(doc)
  const model = tableModel(state, tableNode(state))
  const range = model?.rows[0]?.[0]
  if (range?.node == null) throw new Error('no cell')
  return inlineModel(state, range.node)
}

/** The visible text of a model, which must never lose or invent a character. */
function textOf(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => (node.kind === 'text' ? node.text : textOf(node.children)))
    .join('')
}

describe('inline content', () => {
  it('keeps plain text as one run', () => {
    expect(cell('just text')).toEqual([{ kind: 'text', text: 'just text' }])
  })

  it('renders bold, italic and strikethrough without their markers', () => {
    expect(cell('**b**')).toEqual([{ kind: 'strong', children: [{ kind: 'text', text: 'b' }] }])
    expect(cell('*i*')).toEqual([{ kind: 'emphasis', children: [{ kind: 'text', text: 'i' }] }])
    expect(cell('~~s~~')).toEqual([
      { kind: 'strikethrough', children: [{ kind: 'text', text: 's' }] },
    ])
  })

  it('renders inline code as code', () => {
    expect(cell('`x`')).toEqual([{ kind: 'code', children: [{ kind: 'text', text: 'x' }] }])
  })

  it('nests', () => {
    expect(cell('**bold *and* more**')).toEqual([
      {
        kind: 'strong',
        children: [
          { kind: 'text', text: 'bold ' },
          { kind: 'emphasis', children: [{ kind: 'text', text: 'and' }] },
          { kind: 'text', text: ' more' },
        ],
      },
    ])
  })

  it('renders a link as its text, with the destination kept separately', () => {
    expect(cell('[text](https://example.com)')).toEqual([
      {
        kind: 'link',
        href: 'https://example.com',
        children: [{ kind: 'text', text: 'text' }],
      },
    ])
  })

  it('keeps a reference link as source, because the label is what the reader needs', () => {
    expect(textOf(cell('[text][label]'))).toBe('[text][label]')
  })

  it('keeps an image as its Markdown', () => {
    // Rendering one is an async read that would change the row height afterwards.
    expect(textOf(cell('![alt](picture.png)'))).toBe('![alt](picture.png)')
  })

  it('drops the backslash of an escape and keeps the character', () => {
    expect(cell('a \\| b')).toEqual([{ kind: 'text', text: 'a | b' }])
  })

  it('joins the text an escape splits into one run', () => {
    expect(cell('x \\* y \\* z')).toEqual([{ kind: 'text', text: 'x * y * z' }])
  })

  it('keeps an unmatched marker as text', () => {
    expect(textOf(cell('**not closed'))).toBe('**not closed')
  })

  it('keeps every visible character of mixed content', () => {
    expect(textOf(cell('**b** and `c` and [l](https://e.com) and \\|'))).toBe(
      'b and c and l and |',
    )
  })
})
