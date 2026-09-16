import { EditorSelection, EditorState } from '@codemirror/state'
import { WidgetType } from '@codemirror/view'
import { describe, expect, it } from 'vitest'

import {
  blockPreview,
  blockPreviewField,
  replacedBlockRanges,
  type BlockRenderer,
} from '../../app/editor/livePreview/blockPreview'
import { buildPreviewDecorations } from '../../app/editor/livePreview/decorations'
import { mermaidRenderer } from '../../app/editor/livePreview/mermaid'
import { createMarkdownSupport } from '../../app/editor/markdown'

/**
 * The block layer replaces whole structures, which is the one thing the inline
 * layer is forbidden to do. These tests check which ranges it claims and when it
 * lets go of them; what the widget draws is a browser concern, covered end to end.
 */

/** A widget that renders nothing: these tests are about ranges, not drawing. */
class StubWidget extends WidgetType {
  constructor(readonly source: string) {
    super()
  }

  override eq(other: StubWidget): boolean {
    return other.source === this.source
  }

  override toDOM(): HTMLElement {
    throw new Error('not rendered in unit tests')
  }
}

/** The Mermaid renderer, with a widget that cannot touch the DOM. */
const stubbed: BlockRenderer = {
  matches: mermaidRenderer.matches,
  source: mermaidRenderer.source,
  widget: (source) => new StubWidget(source),
}

function stateFor(doc: string, cursor = 0, renderers = [stubbed]): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(Math.min(cursor, doc.length)),
    extensions: [createMarkdownSupport(), blockPreview(renderers)],
  })
}

/** The text the block layer has replaced, as strings. */
function replaced(doc: string, cursor = 0): string[] {
  const state = stateFor(doc, cursor)
  return replacedBlockRanges(state).map((range) => state.doc.sliceString(range.from, range.to))
}

const DIAGRAM = ['```mermaid', 'graph TD', '    A --> B', '```'].join('\n')

describe('finding blocks', () => {
  it('replaces a mermaid block', () => {
    expect(replaced('# Title\n\n' + DIAGRAM + '\n\ntext\n', 1000)).toEqual([DIAGRAM])
  })

  it('leaves other fenced blocks alone', () => {
    const doc = '```javascript\nconst a = 1\n```\n'
    expect(replaced(doc, 1000)).toEqual([])
  })

  it('leaves a fence with no language alone', () => {
    expect(replaced('```\ngraph TD\n```\n', 1000)).toEqual([])
  })

  it('matches the info string case-insensitively and ignores spacing', () => {
    expect(replaced('```Mermaid \ngraph TD\n```\n', 1000)).toHaveLength(1)
  })

  it('finds every diagram in a document', () => {
    const doc = DIAGRAM + '\n\ntext\n\n' + DIAGRAM + '\n'
    expect(replaced(doc, 1000)).toHaveLength(2)
  })

  it('finds a diagram inside a blockquote or a list', () => {
    const quoted = ['> ```mermaid', '> graph TD', '> ```'].join('\n') + '\n'
    const listed = ['- item', '  ```mermaid', '  graph TD', '  ```'].join('\n') + '\n'

    expect(replaced(quoted, 1000)).toHaveLength(1)
    expect(replaced(listed, 1000)).toHaveLength(1)
  })

  it('claims whole lines, so the replacement is a block', () => {
    const doc = 'text\n\n' + DIAGRAM + '\n'
    const state = stateFor(doc, 1000)
    const [range] = replacedBlockRanges(state)

    expect(state.doc.lineAt(range!.from).from).toBe(range!.from)
    expect(state.doc.lineAt(range!.to).to).toBe(range!.to)
  })

  it('does nothing without a renderer', () => {
    const state = stateFor(DIAGRAM + '\n', 1000, [])
    expect(replacedBlockRanges(state)).toEqual([])
  })
})

describe('revealing the source', () => {
  const doc = 'text\n\n' + DIAGRAM + '\n\nmore\n'
  const insideDiagram = doc.indexOf('graph TD') + 2

  it('replaces the block when the cursor is elsewhere', () => {
    expect(replaced(doc, 0)).toHaveLength(1)
  })

  it('shows the source when the cursor is inside the block', () => {
    expect(replaced(doc, insideDiagram)).toEqual([])
  })

  it('shows the source from the opening fence too', () => {
    expect(replaced(doc, doc.indexOf('```mermaid') + 2)).toEqual([])
  })

  it('replaces it again once the cursor leaves', () => {
    const state = stateFor(doc, insideDiagram)
    expect(replacedBlockRanges(state)).toEqual([])

    const moved = state.update({ selection: EditorSelection.cursor(0) }).state
    expect(replacedBlockRanges(moved)).toHaveLength(1)
  })

  it('keeps the block replaced while the cursor is on a neighbouring line', () => {
    const state = stateFor(doc, doc.indexOf('more'))
    expect(replacedBlockRanges(state)).toHaveLength(1)
  })
})

describe('reacting to edits', () => {
  it('finds a diagram that was just typed', () => {
    const state = stateFor('text\n', 0)
    expect(replacedBlockRanges(state)).toEqual([])

    const typed = state.update({
      changes: { from: state.doc.length, insert: '\n' + DIAGRAM + '\n' },
      selection: EditorSelection.cursor(0),
    }).state

    expect(replacedBlockRanges(typed)).toHaveLength(1)
  })

  it('lets go when the diagram is deleted', () => {
    const doc = DIAGRAM + '\n'
    const state = stateFor(doc, doc.length)
    const cleared = state.update({
      changes: { from: 0, to: doc.length, insert: 'plain text\n' },
      selection: EditorSelection.cursor(0),
    }).state

    expect(replacedBlockRanges(cleared)).toEqual([])
  })

  it('keeps the same widget when the source has not changed', () => {
    const doc = DIAGRAM + '\n\ntail\n'
    const state = stateFor(doc, doc.length)
    const before = state.field(blockPreviewField).blocks[0]!.widget

    // Editing elsewhere rescans, but the widget must compare equal so CodeMirror
    // keeps the rendered diagram instead of drawing it again.
    const edited = state.update({ changes: { from: doc.length - 1, insert: '!' } }).state
    const after = edited.field(blockPreviewField).blocks[0]!.widget

    expect(after.eq(before)).toBe(true)
  })

  it('makes a different widget when the diagram itself changes', () => {
    const doc = DIAGRAM + '\n'
    const state = stateFor(doc, doc.length)
    const before = state.field(blockPreviewField).blocks[0]!.widget

    const edited = state.update({
      changes: { from: doc.indexOf('A --> B'), to: doc.indexOf('A --> B') + 7, insert: 'A --> C' },
    }).state
    const after = edited.field(blockPreviewField).blocks[0]!.widget

    expect(after.eq(before)).toBe(false)
  })
})

describe('the two layers do not overlap', () => {
  it('the inline layer decorates nothing inside a replaced block', () => {
    // The diagram source contains text the inline layer would otherwise style.
    const doc = ['```mermaid', 'graph TD', '    A[**bold**] --> B', '```', '', 'text\n'].join('\n')
    const state = stateFor(doc, doc.length)

    const { decorations, hidden } = buildPreviewDecorations(state, [{ from: 0, to: doc.length }])
    const [block] = replacedBlockRanges(state)

    let insideBlock = 0
    decorations.between(block!.from, block!.to, () => {
      insideBlock += 1
    })
    hidden.between(block!.from, block!.to, () => {
      insideBlock += 1
    })

    expect(insideBlock).toBe(0)
  })

  it('the inline layer works normally once the block is revealed', () => {
    const doc = ['```mermaid', 'graph TD', '```', '', 'a **bold** word\n'].join('\n')
    const state = stateFor(doc, doc.indexOf('graph') + 1)

    const { decorations } = buildPreviewDecorations(state, [{ from: 0, to: doc.length }])

    const classes = new Set<string>()
    decorations.between(0, doc.length, (_from, _to, value) => {
      if (typeof value.spec.class === 'string') classes.add(value.spec.class)
    })

    // The fence is styled as code again, and the paragraph below is still Markdown.
    expect(classes).toContain('cm-md-code-line')
    expect(classes).toContain('cm-md-strong')
  })
})
