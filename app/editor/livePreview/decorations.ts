import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import { Decoration, type DecorationSet } from '@codemirror/view'
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common'

import { isRevealed, revealedSpans, type Span } from './reveal'
import { BulletWidget } from './widgets'

/**
 * Turns the Markdown syntax tree into decorations.
 *
 * Two things matter here:
 *
 * - **The document is never modified.** Syntax is hidden with replace decorations
 *   and styled with mark decorations; `## Hello` stays `## Hello` on disk and in the
 *   editor state, however it looks on screen.
 * - **Nothing is parsed line by line.** Everything comes from the whole-document
 *   syntax tree, so multi-line structures (lists, blockquotes, tables, fenced code)
 *   are understood as structures. The *reveal* rule is per line; the parsing is not.
 *
 * Only inline-level decorations are produced, and no replacement ever covers a line
 * break, because this set is provided through a view plugin — CodeMirror forbids
 * plugins from changing the vertical layout (see the note in `index.ts`).
 */

/** Hides a range. Reused across ranges: decoration values are immutable. */
const HIDDEN = Decoration.replace({})

const BULLET = Decoration.replace({ widget: new BulletWidget() })

const MARK = {
  strong: Decoration.mark({ class: 'cm-md-strong' }),
  emphasis: Decoration.mark({ class: 'cm-md-emphasis' }),
  strikethrough: Decoration.mark({ class: 'cm-md-strikethrough' }),
  inlineCode: Decoration.mark({ class: 'cm-md-code' }),
  link: Decoration.mark({ class: 'cm-md-link' }),
  url: Decoration.mark({ class: 'cm-md-url' }),
  listMark: Decoration.mark({ class: 'cm-md-list-mark' }),
  punctuation: Decoration.mark({ class: 'cm-md-punctuation' }),
} as const

const LINE = {
  heading: [1, 2, 3, 4, 5, 6].map((level) =>
    Decoration.line({ class: 'cm-md-heading cm-md-h' + level }),
  ),
  quote: Decoration.line({ class: 'cm-md-quote' }),
  code: Decoration.line({ class: 'cm-md-code-line' }),
  table: Decoration.line({ class: 'cm-md-table-line' }),
  rule: Decoration.line({ class: 'cm-md-rule' }),
} as const

export interface PreviewDecorations {
  /** Everything: hidden syntax, inline styling and line styling. */
  decorations: DecorationSet
  /**
   * Just the hidden ranges.
   *
   * Provided separately for `EditorView.atomicRanges`, so arrow keys step over
   * invisible syntax instead of stalling inside it. Styling decorations must not be
   * atomic — that would make whole words unnavigable.
   */
  hidden: DecorationSet
}

export function buildPreviewDecorations(
  state: EditorState,
  ranges: readonly Span[],
): PreviewDecorations {
  const builder = new DecorationBuilder(state)
  const spans = revealedSpans(state)

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter: (node) => builder.visit(node, spans),
    })
  }

  return builder.finish()
}

class DecorationBuilder {
  private readonly all: Range<Decoration>[] = []
  private readonly hiddenOnly: Range<Decoration>[] = []
  /** A node can be reached from two viewport ranges; decorate it once. */
  private readonly seen = new Set<string>()

  constructor(private readonly state: EditorState) {}

  visit(node: SyntaxNodeRef, spans: readonly Span[]): void {
    const name = node.name

    if (name.startsWith('ATXHeading')) return this.atxHeading(node, spans)
    if (name.startsWith('SetextHeading')) return this.setextHeading(node)

    switch (name) {
      case 'StrongEmphasis':
        return this.inline(node, spans, MARK.strong, 'EmphasisMark')
      case 'Emphasis':
        return this.inline(node, spans, MARK.emphasis, 'EmphasisMark')
      case 'Strikethrough':
        return this.inline(node, spans, MARK.strikethrough, 'StrikethroughMark')
      case 'InlineCode':
        return this.inline(node, spans, MARK.inlineCode, 'CodeMark')
      case 'Blockquote':
        return this.blockquote(node, spans)
      case 'ListItem':
        return this.listItem(node, spans)
      case 'Link':
        return this.link(node, spans)
      case 'URL':
        return this.url(node)
      case 'FencedCode':
      case 'CodeBlock':
        return this.eachLine(node, LINE.code)
      case 'Table':
        return this.table(node)
      case 'HorizontalRule':
        return this.eachLine(node, LINE.rule)
      default:
        return
    }
  }

  finish(): PreviewDecorations {
    return {
      // Sorted on the way in: decorations are emitted per node, not in document order.
      decorations: Decoration.set(this.all, true),
      hidden: Decoration.set(this.hiddenOnly, true),
    }
  }

  // --- emitters -------------------------------------------------------------

  private hide(from: number, to: number): void {
    if (to <= from || !this.claim('hide', from, to)) return
    const range = HIDDEN.range(from, to)
    this.all.push(range)
    this.hiddenOnly.push(range)
  }

  private replaceWithWidget(decoration: Decoration, from: number, to: number): void {
    if (to <= from || !this.claim('widget', from, to)) return
    const range = decoration.range(from, to)
    this.all.push(range)
    this.hiddenOnly.push(range)
  }

  private mark(decoration: Decoration, from: number, to: number): void {
    if (to <= from || !this.claim('mark' + decoration.spec.class, from, to)) return
    this.all.push(decoration.range(from, to))
  }

  private line(decoration: Decoration, position: number): void {
    if (!this.claim('line' + decoration.spec.class, position, position)) return
    this.all.push(decoration.range(position))
  }

  private claim(kind: string, from: number, to: number): boolean {
    const key = kind + ':' + from + ':' + to
    if (this.seen.has(key)) return false
    this.seen.add(key)
    return true
  }

  /** Applies a line decoration to every line a node spans. */
  private eachLine(node: SyntaxNodeRef, decoration: Decoration): void {
    const first = this.state.doc.lineAt(node.from).number
    const last = this.state.doc.lineAt(node.to).number

    for (let number = first; number <= last; number += 1) {
      this.line(decoration, this.state.doc.line(number).from)
    }
  }

  // --- constructs -----------------------------------------------------------

  /**
   * `## Hello` — the line keeps its heading styling even while revealed, so the text
   * does not resize as the cursor moves through the document. Only the `##` appears.
   */
  private atxHeading(node: SyntaxNodeRef, spans: readonly Span[]): void {
    const level = Number(node.name.slice('ATXHeading'.length))
    const style = LINE.heading[level - 1]
    if (style === undefined) return

    const line = this.state.doc.lineAt(node.from)
    this.line(style, line.from)

    if (isRevealed(spans, node.from, node.to)) return

    for (const marker of node.node.getChildren('HeaderMark')) {
      // Opening mark: swallow the space after it, or the text starts indented.
      // Closing mark of `## Hi ##`: swallow the space before it instead.
      const opening = marker.from === node.from
      this.hide(
        opening ? marker.from : this.skipSpacesBackwards(marker.from, line.from),
        opening ? this.skipSpacesForwards(marker.to, line.to) : marker.to,
      )
    }
  }

  /**
   * A setext heading underlines its text with `===`, so hiding the marker would mean
   * removing a whole line — a vertical layout change, which a view plugin may not
   * make. The text is styled; the underline stays visible.
   */
  private setextHeading(node: SyntaxNodeRef): void {
    const level = Number(node.name.slice('SetextHeading'.length))
    const style = LINE.heading[level - 1]
    if (style === undefined) return

    const marker = node.node.getChild('HeaderMark')
    const textEnd = marker === null ? node.to : marker.from
    const first = this.state.doc.lineAt(node.from).number
    const last = this.state.doc.lineAt(textEnd).number

    for (let number = first; number <= last; number += 1) {
      this.line(style, this.state.doc.line(number).from)
    }
  }

  /** `**bold**`, `*italic*`, `~~struck~~`, `` `code` `` — style always, hide the marks. */
  private inline(
    node: SyntaxNodeRef,
    spans: readonly Span[],
    style: Decoration,
    markName: string,
  ): void {
    this.mark(style, node.from, node.to)

    if (isRevealed(spans, node.from, node.to)) return

    for (const marker of node.node.getChildren(markName)) {
      this.hide(marker.from, marker.to)
    }
  }

  /** `> quoted` — one `>` per line, each hidden with the space that follows it. */
  private blockquote(node: SyntaxNodeRef, spans: readonly Span[]): void {
    this.eachLine(node, LINE.quote)

    for (const marker of this.descendants(node.node, 'QuoteMark')) {
      if (isRevealed(spans, marker.from, marker.to)) continue
      const line = this.state.doc.lineAt(marker.from)
      this.hide(marker.from, this.skipSpacesForwards(marker.to, line.to))
    }
  }

  /**
   * A bullet becomes a real bullet; an ordered marker keeps its number, because the
   * number is content the user chose.
   */
  private listItem(node: SyntaxNodeRef, spans: readonly Span[]): void {
    const marker = node.node.getChild('ListMark')
    if (marker === null) return

    const text = this.state.doc.sliceString(marker.from, marker.to)
    const ordered = /\d/.test(text)

    if (ordered || isRevealed(spans, marker.from, marker.to)) {
      this.mark(MARK.listMark, marker.from, marker.to)
      return
    }

    this.replaceWithWidget(BULLET, marker.from, marker.to)
  }

  /**
   * `[text](url)` — shows the text, hides the brackets and the target.
   *
   * A reference link (`[text][label]`) has no URL child, and its label matters to the
   * reader, so it is styled but left intact.
   */
  private link(node: SyntaxNodeRef, spans: readonly Span[]): void {
    const marks = node.node.getChildren('LinkMark')
    const url = node.node.getChild('URL')
    const opening = marks.at(0)
    const closing = marks.at(1)

    if (url === null || opening === undefined || closing === undefined) {
      this.mark(MARK.link, node.from, node.to)
      return
    }

    this.mark(MARK.link, opening.to, closing.from)

    if (isRevealed(spans, node.from, node.to)) return

    this.hide(opening.from, opening.to)
    // From `]` to the end of the link covers `](url "title")` in one range.
    this.hide(closing.from, node.to)
  }

  /** A bare URL: an autolink when it stands alone, styled either way. */
  private url(node: SyntaxNodeRef): void {
    const parent = node.node.parent?.name
    // Inside a link or image the URL is handled by its container.
    if (parent === 'Link' || parent === 'Image' || parent === 'LinkReference') return

    this.mark(MARK.url, node.from, node.to)
  }

  /** Tables are styled, never replaced: see docs/decisions on keeping them editable. */
  private table(node: SyntaxNodeRef): void {
    this.eachLine(node, LINE.table)

    for (const delimiter of this.descendants(node.node, 'TableDelimiter')) {
      this.mark(MARK.punctuation, delimiter.from, delimiter.to)
    }
  }

  // --- helpers --------------------------------------------------------------

  /**
   * Collects nodes of one type anywhere under `root`.
   *
   * `getChildren` only looks one level down, and marks such as `QuoteMark` appear
   * both directly under the structure and inside the paragraphs within it.
   */
  private descendants(root: SyntaxNode, name: string): SyntaxNode[] {
    const found: SyntaxNode[] = []
    const cursor = root.cursor()

    do {
      if (cursor.name === name) found.push(cursor.node)
    } while (cursor.next() && cursor.from < root.to)

    return found
  }

  private skipSpacesForwards(position: number, limit: number): number {
    let end = position
    while (end < limit && this.state.doc.sliceString(end, end + 1) === ' ') end += 1
    return end
  }

  private skipSpacesBackwards(position: number, limit: number): number {
    let start = position
    while (start > limit && this.state.doc.sliceString(start - 1, start) === ' ') start -= 1
    return start
  }
}
