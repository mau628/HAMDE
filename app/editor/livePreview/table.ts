import type { EditorState } from '@codemirror/state'
import { WidgetType, type EditorView } from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'

import { blockStart, moveCursorTo } from './blockCursor'
import type { BlockRenderer } from './blockPreview'
import { inlineModel, type InlineNode } from './inlineModel'
import { inlineToDom } from './inlineToDom'
import {
  isRenderableTable,
  tableModel,
  type ColumnAlign,
  type TableCellRange,
} from './tableModel'

/**
 * GFM tables, rendered as tables.
 *
 * Until M10 a table was styled source in a monospace font, on the grounds that it
 * stayed editable. It did, but it also meant the one construct whose whole purpose
 * is to line data up was the one construct the reader had to line up in their head.
 * A rendered grid is what a table is for.
 *
 * Editing is kept, and not by accident:
 *
 * - The cursor anywhere in the table shows the source, exactly as before — the
 *   reveal rule does that for free, because a block replacement is suppressed for
 *   any line the selection touches.
 * - A click lands in the **cell that was clicked**, not at the top of the block.
 *   Without that, rendering the table would be a regression for editing it: every
 *   correction would start by hunting for the right pipe.
 */

/** A cell as the widget holds it: content to draw, and where it starts. */
interface RenderedCell {
  content: readonly InlineNode[]
  /**
   * Distance from the start of the block to the start of the cell.
   *
   * An offset rather than a position, because an equal widget can be reused
   * anywhere in the document; see the note on `BlockRenderer.widget`.
   */
  offset: number
}

interface RenderedTable {
  columns: readonly ColumnAlign[]
  header: readonly RenderedCell[]
  rows: readonly (readonly RenderedCell[])[]
}

/** Where a cell keeps its offset, so a click can be mapped back to the document. */
const OFFSET_ATTRIBUTE = 'data-cell-offset'

export const tableRenderer: BlockRenderer = {
  matches: (node) => isRenderableTable(node),

  source: (state, node) => state.doc.sliceString(node.from, node.to),

  widget: (source, state, node) => new TableWidget(source, build(state, node)),
}

/**
 * Reads the table once, at scan time, into data that depends only on its source.
 *
 * Offsets are measured from the start of the block's first line, which is where
 * `blockPreview` puts the replacement — and, at the top level, the same as the
 * table's own start.
 */
function build(state: EditorState, node: SyntaxNodeRef): RenderedTable {
  const model = tableModel(state, node)
  if (model === null) return { columns: [], header: [], rows: [] }

  const origin = state.doc.lineAt(node.from).from
  const cell = (range: TableCellRange): RenderedCell => ({
    content: range.node === null ? [] : inlineModel(state, range.node),
    offset: range.from - origin,
  })

  return {
    columns: model.columns,
    header: model.header.map(cell),
    rows: model.rows.map((row) => row.map(cell)),
  }
}

export class TableWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly table: RenderedTable,
  ) {
    super()
  }

  /**
   * Two widgets are the same when their source is. Everything else this widget
   * holds is derived from that source, so comparing it is both sufficient and
   * cheap — and it means moving the cursor around the document never rebuilds a
   * table's DOM.
   */
  override eq(other: TableWidget): boolean {
    return other.source === this.source
  }

  /** Rough height while the layout is measured: a row per line, plus the border. */
  override get estimatedHeight(): number {
    return (this.table.rows.length + 1) * 30 + 16
  }

  override toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div')
    container.className = 'cm-md-table'

    const table = document.createElement('table')
    table.className = 'cm-md-table__grid'
    table.append(this.head(), this.body())
    container.append(table)

    this.handleClicks(container, view)
    return container
  }

  private head(): HTMLElement {
    const head = document.createElement('thead')
    head.append(this.row(this.table.header, 'th'))
    return head
  }

  private body(): HTMLElement {
    const body = document.createElement('tbody')
    for (const row of this.table.rows) body.append(this.row(row, 'td'))
    return body
  }

  private row(cells: readonly RenderedCell[], tag: 'th' | 'td'): HTMLElement {
    const row = document.createElement('tr')

    for (const [index, cell] of cells.entries()) {
      const element = document.createElement(tag)
      element.className = 'cm-md-table__cell'

      const align = this.table.columns[index] ?? 'default'
      if (align !== 'default') element.style.textAlign = align

      element.setAttribute(OFFSET_ATTRIBUTE, String(cell.offset))
      element.append(inlineToDom(cell.content))
      row.append(element)
    }

    return row
  }

  /**
   * A click puts the cursor in the cell that was clicked, which reveals the source.
   *
   * Two things have to be true at once. A plain click behaves like a click anywhere
   * else in the editor — it moves the cursor, even when it lands on a link, because
   * link text is editable text. And Ctrl/Cmd+click opens the link, which is the
   * gesture the rest of the editor uses; that case is left entirely to the browser,
   * so the anchor's own `noopener,noreferrer` applies.
   */
  private handleClicks(container: HTMLElement, view: EditorView): void {
    container.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      if ((event.ctrlKey || event.metaKey) && anchorAt(event) !== null) return

      event.preventDefault()

      const start = blockStart(view, container)
      if (start === null) return

      moveCursorTo(view, start + offsetAt(event))
    })

    // Only reached if the cursor could not be placed — placing it removes this DOM.
    // Without it, a plain click on a link in that case would open a tab.
    container.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey) return
      if (anchorAt(event) !== null) event.preventDefault()
    })
  }
}

/** The offset of the cell a pointer event happened in; 0 for the table's edges. */
function offsetAt(event: MouseEvent): number {
  const target = event.target
  if (!(target instanceof Element)) return 0

  const cell = target.closest('[' + OFFSET_ATTRIBUTE + ']')
  const offset = Number(cell?.getAttribute(OFFSET_ATTRIBUTE))
  return Number.isFinite(offset) ? offset : 0
}

function anchorAt(event: MouseEvent): HTMLAnchorElement | null {
  const target = event.target
  if (!(target instanceof Element)) return null
  return target.closest('a')
}
