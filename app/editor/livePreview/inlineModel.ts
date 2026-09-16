import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

/**
 * Inline Markdown as plain data.
 *
 * Everywhere else the preview *decorates* the source: what is on screen is the text
 * of the document with syntax hidden and content styled. Inside a block widget
 * there is no source to decorate, so the content has to be rebuilt — and this is
 * the half of that job which needs the syntax tree.
 *
 * It stops at data rather than going straight to DOM for two reasons. The result
 * depends only on the block's own text, so a widget can hold it and still compare
 * equal to another widget built from the same source, however the document moved
 * around it. And it is testable without a browser, which is where the awkward cases
 * are.
 *
 * What is deliberately left as literal text:
 *
 * - **Images.** Rendering one is an async read through the directory handle, and in
 *   a table cell it would change the row's height after the fact. The Markdown
 *   shows instead, which is what an unrenderable image source does everywhere here.
 * - **Reference links.** There is no URL to resolve, and the label is what the
 *   reader needs — the same reason the inline layer leaves them alone.
 */

export type InlineNode =
  | { kind: 'text'; text: string }
  | { kind: 'strong' | 'emphasis' | 'strikethrough' | 'code'; children: InlineNode[] }
  | { kind: 'link'; href: string; children: InlineNode[] }

/** Syntax that contributes nothing once the content is rendered. */
const MARKERS = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark', 'LinkTitle'])

const CONTAINERS: Record<string, 'strong' | 'emphasis' | 'strikethrough' | 'code'> = {
  StrongEmphasis: 'strong',
  Emphasis: 'emphasis',
  Strikethrough: 'strikethrough',
  InlineCode: 'code',
}

/**
 * The inline content of `node`, restricted to `[from, to)`.
 *
 * The node is passed in rather than looked up from a position, because the caller
 * already has it: this runs while walking the tree.
 */
export function inlineModel(
  state: EditorState,
  node: SyntaxNode,
  from = node.from,
  to = node.to,
): InlineNode[] {
  const nodes: InlineNode[] = []
  collectChildren(nodes, state, node, from, to)
  return merge(nodes)
}

function collectChildren(
  into: InlineNode[],
  state: EditorState,
  node: SyntaxNode,
  from: number,
  to: number,
): void {
  let position = from

  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.to <= from) continue
    if (child.from >= to) break

    if (child.from > position) pushText(into, state, position, child.from)
    collect(into, state, child)
    position = Math.max(position, Math.min(child.to, to))
  }

  if (position < to) pushText(into, state, position, to)
}

function collect(into: InlineNode[], state: EditorState, node: SyntaxNode): void {
  const name = node.name

  if (MARKERS.has(name)) return

  // `\|` — the character the backslash protects, without the backslash.
  if (name === 'Escape') {
    pushText(into, state, node.from + 1, node.to)
    return
  }

  const kind = CONTAINERS[name]
  if (kind !== undefined) {
    into.push({ kind, children: childrenOf(state, node, node.from, node.to) })
    return
  }

  if (name === 'Link') {
    collectLink(into, state, node)
    return
  }

  if (name === 'Autolink' || name === 'URL') {
    into.push({
      kind: 'link',
      href: state.doc.sliceString(node.from, node.to),
      children: childrenOf(state, node, node.from, node.to),
    })
    return
  }

  // An image shows as its own Markdown; see the note at the top of this file.
  if (name === 'Image') {
    pushText(into, state, node.from, node.to)
    return
  }

  collectChildren(into, state, node, node.from, node.to)
}

/** `[text](url)`, or the literal source when there is no destination to use. */
function collectLink(into: InlineNode[], state: EditorState, node: SyntaxNode): void {
  const url = node.getChild('URL')
  const marks = node.getChildren('LinkMark')
  const opening = marks.at(0)
  const closing = marks.at(1)

  if (url === null || opening === undefined || closing === undefined) {
    pushText(into, state, node.from, node.to)
    return
  }

  into.push({
    kind: 'link',
    href: state.doc.sliceString(url.from, url.to),
    children: childrenOf(state, node, opening.to, closing.from),
  })
}

function childrenOf(
  state: EditorState,
  node: SyntaxNode,
  from: number,
  to: number,
): InlineNode[] {
  const children: InlineNode[] = []
  collectChildren(children, state, node, from, to)
  return merge(children)
}

function pushText(into: InlineNode[], state: EditorState, from: number, to: number): void {
  if (to <= from) return
  into.push({ kind: 'text', text: state.doc.sliceString(from, to) })
}

/**
 * Joins adjacent text, which the walk produces whenever an escape or a hidden
 * marker splits a run. One text node per run keeps the data — and the assertions
 * about it — readable.
 */
function merge(nodes: InlineNode[]): InlineNode[] {
  const merged: InlineNode[] = []

  for (const node of nodes) {
    const previous = merged.at(-1)
    if (node.kind === 'text' && previous?.kind === 'text') {
      merged[merged.length - 1] = { kind: 'text', text: previous.text + node.text }
      continue
    }
    merged.push(node)
  }

  return merged
}
