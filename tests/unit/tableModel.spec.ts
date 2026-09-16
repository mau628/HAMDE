import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { describe, expect, it } from 'vitest'

import {
  isRenderableTable,
  tableModel,
  type TableModel,
} from '../../app/editor/livePreview/tableModel'
import { createMarkdownSupport } from '../../app/editor/markdown'

/**
 * The structure of a table, without a browser.
 *
 * Everything awkward about rendering a table is here rather than in the widget:
 * empty cells the parser never emits, rows with the wrong number of cells, and
 * alignment. The widget only turns this into DOM, which is covered end to end.
 */

function stateFor(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [createMarkdownSupport()] })
}

function tableNode(state: EditorState): SyntaxNode | null {
  let found: SyntaxNode | null = null
  syntaxTree(state).iterate({
    enter: (node) => {
      if (found !== null) return false
      if (node.name === 'Table') found = node.node
      return true
    },
  })
  return found
}

function modelFor(doc: string): TableModel | null {
  const state = stateFor(doc)
  const node = tableNode(state)
  return node === null ? null : tableModel(state, node)
}

/** The model's cells as text, so assertions read like the table does. */
function cells(doc: string): { header: string[]; rows: string[][] } {
  const state = stateFor(doc)
  const model = modelFor(doc)
  if (model === null) throw new Error('not a table')

  const text = (cell: { from: number; to: number }): string =>
    state.doc.sliceString(cell.from, cell.to)

  return {
    header: model.header.map(text),
    rows: model.rows.map((row) => row.map(text)),
  }
}

function table(...lines: string[]): string {
  return lines.join('\n') + '\n'
}

describe('what counts as a renderable table', () => {
  it('is a top-level table with a header', () => {
    const state = stateFor(table('| a | b |', '| - | - |', '| 1 | 2 |'))
    const node = tableNode(state)
    expect(node).not.toBeNull()
    expect(isRenderableTable(node!)).toBe(true)
  })

  it('is not a table inside a blockquote', () => {
    // A block replacement covers whole lines, so a rendered grid would swallow the
    // `>` that puts it in the quote. The source stays instead.
    const state = stateFor(table('> | a |', '> | - |', '> | 1 |'))
    const node = tableNode(state)
    expect(node).not.toBeNull()
    expect(isRenderableTable(node!)).toBe(false)
  })

  it('is not a table inside a list item', () => {
    const state = stateFor(table('- item', '', '  | a |', '  | - |', '  | 1 |'))
    const node = tableNode(state)
    if (node !== null) expect(isRenderableTable(node)).toBe(false)
  })
})

describe('cells', () => {
  it('reads a header and its rows', () => {
    expect(cells(table('| a | b |', '| - | - |', '| 1 | 2 |'))).toEqual({
      header: ['a', 'b'],
      rows: [['1', '2']],
    })
  })

  it('renders a header-only table, which GFM allows', () => {
    expect(cells(table('| a | b |', '| - | - |'))).toEqual({ header: ['a', 'b'], rows: [] })
  })

  it('keeps an empty cell in its own column', () => {
    // The parser emits no TableCell for an empty cell, so columns are counted from
    // the separators. Without that, `y` moved left into the empty column.
    expect(cells(table('| a | b | c |', '| - | - | - |', '| x |  | y |'))).toEqual({
      header: ['a', 'b', 'c'],
      rows: [['x', '', 'y']],
    })
  })

  it('handles an empty first and last cell', () => {
    expect(cells(table('| a | b | c |', '| - | - | - |', '|  | x |  |'))).toEqual({
      header: ['a', 'b', 'c'],
      rows: [['', 'x', '']],
    })
  })

  it('pads a short row', () => {
    expect(cells(table('| a | b | c |', '| - | - | - |', '| 1 |'))).toEqual({
      header: ['a', 'b', 'c'],
      rows: [['1', '', '']],
    })
  })

  it('drops the extra cells of a long row, as GFM says', () => {
    expect(cells(table('| a | b |', '| - | - |', '| 1 | 2 | 3 |'))).toEqual({
      header: ['a', 'b'],
      rows: [['1', '2']],
    })
  })

  it('reads a table written without outer pipes', () => {
    expect(cells(table('a | b', '--- | ---', '1 | 2'))).toEqual({
      header: ['a', 'b'],
      rows: [['1', '2']],
    })
  })

  it('does not split a cell on an escaped pipe', () => {
    expect(cells(table('| a \\| b | c |', '| - | - |', '| 1 | 2 |'))).toEqual({
      header: ['a \\| b', 'c'],
      rows: [['1', '2']],
    })
  })

  it('gives an empty cell a position inside its own column', () => {
    const doc = table('| a | b |', '| - | - |', '| x |  |')
    const model = modelFor(doc)
    const empty = model?.rows[0]?.[1]

    const from = empty?.from ?? 0
    expect(empty?.to).toBe(from)
    // Just after the pipe that opens the column, which is where a click should
    // land: inside the empty cell rather than at the top of the block.
    expect(doc.slice(from - 1, from)).toBe('|')
    expect(doc.slice(from).startsWith('  |')).toBe(true)
  })
})

describe('alignment', () => {
  it('reads left, centre, right and default', () => {
    const model = modelFor(table('| a | b | c | d |', '| :- | :-: | -: | - |', '| 1 | 2 | 3 | 4 |'))
    expect(model?.columns).toEqual(['left', 'center', 'right', 'default'])
  })

  it('accepts a separator with no spaces', () => {
    const model = modelFor(table('|a|b|', '|:--|--:|', '|1|2|'))
    expect(model?.columns).toEqual(['left', 'right'])
  })

  it('has one entry per column', () => {
    const model = modelFor(table('| a | b | c |', '| - | - | - |', '| 1 | 2 | 3 |'))
    expect(model?.columns).toHaveLength(3)
  })
})
