import type { EditorState } from '@codemirror/state'
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common'

/**
 * A GFM table, as positions in the document.
 *
 * This is the whole of the table's structure, and it is deliberately separate from
 * the widget that draws it: given a document and a `Table` node it is a pure
 * function, so the awkward cases — empty cells, ragged rows, alignment — are tested
 * without a DOM.
 *
 * Cells are ranges rather than strings because the rendered table has to do two
 * things with them: render the inline Markdown inside one (which needs the syntax
 * tree, not text), and put the cursor in the right place when one is clicked.
 */

export type ColumnAlign = 'default' | 'left' | 'center' | 'right'

export interface TableCellRange {
  from: number
  to: number
  /**
   * The cell's node, or null for a cell the parser never emitted.
   *
   * Carried so a caller can read the cell's inline content from the tree. An empty
   * cell has no node, which is exactly the distinction between "nothing there" and
   * "something to render".
   */
  node: SyntaxNode | null
}

export interface TableModel {
  /** One entry per column, from the row of dashes. */
  columns: readonly ColumnAlign[]
  header: readonly TableCellRange[]
  rows: readonly (readonly TableCellRange[])[]
}

/**
 * Whether this node is a table the block layer will replace.
 *
 * Kept cheap — it runs for every candidate node on every rescan — and separate from
 * building the model, which walks every cell.
 *
 * Only tables at the top level qualify. A table inside a blockquote or a list item
 * spans lines that begin with `>` or with indentation, and a block replacement
 * covers whole lines: the rendered grid would swallow the markers that put it there
 * and read as a top-level table. Those stay as source, which is honest and already
 * legible.
 */
export function isRenderableTable(node: SyntaxNodeRef): boolean {
  return (
    node.name === 'Table' &&
    node.node.parent?.name === 'Document' &&
    node.node.getChild('TableHeader') !== null
  )
}

/**
 * The structure of a `Table` node.
 *
 * Returns null for a node that is not a renderable table, so a caller never has to
 * decide what an incomplete model means.
 */
export function tableModel(state: EditorState, node: SyntaxNodeRef): TableModel | null {
  if (!isRenderableTable(node)) return null

  const table = node.node
  const headerNode = table.getChild('TableHeader')
  if (headerNode === null) return null

  const header = cellsOf(headerNode)
  const columnCount = header.length
  if (columnCount === 0) return null

  const columns = alignments(state, separatorOf(table), columnCount)

  const rows: TableCellRange[][] = []
  for (const row of table.getChildren('TableRow')) {
    rows.push(fit(cellsOf(row), columnCount))
  }

  return { columns, header: fit(header, columnCount), rows }
}

/**
 * The cells of one row, by column.
 *
 * The parser emits no `TableCell` for an empty cell — `| a |  | b |` is two cells
 * and three separators — so columns are counted from the separators, not from the
 * cells. An empty cell becomes an empty range just after the separator that opens
 * it, which is where the cursor should land if the user clicks it.
 *
 * The leading and trailing `|` are edges, not separators. Both are optional in GFM
 * (`a | b` is a valid row), which is why they are recognised by position rather
 * than by counting.
 */
function cellsOf(row: SyntaxNode): TableCellRange[] {
  const cells: TableCellRange[] = []
  let column = 0
  let boundary = row.from

  for (let child = row.firstChild; child !== null; child = child.nextSibling) {
    if (child.name === 'TableCell') {
      cells[column] = { from: child.from, to: child.to, node: child }
      continue
    }

    if (child.name !== 'TableDelimiter') continue
    // A quoted table has `QuoteMark` children; anything else is not a separator.

    const edge = child.from === row.from || child.to === row.to
    if (edge) {
      boundary = child.to
      continue
    }

    column += 1
    boundary = child.to
    if (cells[column] === undefined) cells[column] = empty(boundary)
  }

  // The first column is empty if no cell ever claimed it.
  if (cells[0] === undefined) cells[0] = empty(row.from)
  // `| a | ` leaves the last column with no cell and no following separator.
  for (let index = 0; index <= column; index += 1) {
    if (cells[index] === undefined) cells[index] = empty(boundary)
  }

  return cells
}

function empty(position: number): TableCellRange {
  return { from: position, to: position, node: null }
}

/**
 * The row of dashes, which is the only `TableDelimiter` that is a direct child of
 * the table: the ones inside a header or a row are single pipes.
 */
function separatorOf(table: SyntaxNode): SyntaxNode | null {
  for (const child of table.getChildren('TableDelimiter')) return child
  return null
}

/**
 * Column alignment from `:---`, `:---:` and `---:`.
 *
 * The parser only accepts a table whose separator row has as many columns as its
 * header, so a mismatch cannot normally arrive here; the result is padded and
 * truncated anyway rather than trusting that from a distance.
 */
function alignments(
  state: EditorState,
  separator: SyntaxNode | null,
  columnCount: number,
): ColumnAlign[] {
  const specs = separator === null ? [] : splitRow(state.doc.sliceString(separator.from, separator.to))

  const columns: ColumnAlign[] = []
  for (let index = 0; index < columnCount; index += 1) {
    columns.push(alignOf(specs[index] ?? ''))
  }
  return columns
}

function alignOf(spec: string): ColumnAlign {
  const left = spec.startsWith(':')
  const right = spec.endsWith(':')
  if (left && right) return 'center'
  if (left) return 'left'
  if (right) return 'right'
  return 'default'
}

/** `| :- | -: |` → `[':-', '-:']`, with the optional outer pipes removed. */
function splitRow(text: string): string[] {
  let trimmed = text.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
  return trimmed.split('|').map((part) => part.trim())
}

/**
 * Pads a short row and drops the cells of a long one, which is what GFM says: the
 * header decides how many columns the table has.
 */
function fit(cells: TableCellRange[], columnCount: number): TableCellRange[] {
  const end = cells.at(-1)
  const fallback = empty(end?.to ?? 0)

  const fitted: TableCellRange[] = []
  for (let index = 0; index < columnCount; index += 1) {
    fitted.push(cells[index] ?? fallback)
  }
  return fitted
}
