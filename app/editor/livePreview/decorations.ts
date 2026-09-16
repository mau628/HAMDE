import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import { Decoration, type DecorationSet } from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'

import { replacedBlockRanges } from './blockPreview'
import { isWorkspacePath } from '~/services/imageService'
import { imageResolver, ImageWidget } from './images'
import { isRevealed, revealedSpans, type Span } from './reveal'
import { isTaskChecked } from './task'
import { BulletWidget, CheckboxWidget } from './widgets'

/**
 * Turns the Markdown syntax tree into decorations.
 *
 * Three things matter here:
 *
 * - **The document is never modified.** Syntax is hidden with replace decorations
 *   and styled with mark decorations; `## Hello` stays `## Hello` on disk and in the
 *   editor state, however it looks on screen.
 * - **Nothing is parsed line by line.** Everything comes from the whole-document
 *   syntax tree, so multi-line structures (lists, blockquotes, tables, fenced code)
 *   are understood as structures. The *reveal* rule is per line; the parsing is not.
 * - **Nothing costs more than the viewport.** Work is clamped to the range being
 *   decorated, so a document with one 20,000-line blockquote costs the same as a
 *   short one. Before that clamping, a single long quoted block made every cursor
 *   move a whole-document walk.
 *
 * No replacement may cover a line break, because this set is provided through a view
 * plugin: CodeMirror throws `Decorations that replace line breaks may not be
 * specified via plugins`. `hide()` enforces that centrally rather than trusting each
 * construct to remember it.
 */

/** Hides a range. Reused across ranges: decoration values are immutable. */
const HIDDEN = Decoration.replace({})

const BULLET = Decoration.replace({ widget: new BulletWidget() })

/** Two instances are enough: a checkbox differs only by its state. */
const CHECKBOX = {
  checked: Decoration.replace({ widget: new CheckboxWidget(true) }),
  unchecked: Decoration.replace({ widget: new CheckboxWidget(false) }),
} as const

const MARK = {
  strong: Decoration.mark({ class: 'cm-md-strong' }),
  emphasis: Decoration.mark({ class: 'cm-md-emphasis' }),
  strikethrough: Decoration.mark({ class: 'cm-md-strikethrough' }),
  inlineCode: Decoration.mark({ class: 'cm-md-code' }),
  link: Decoration.mark({ class: 'cm-md-link' }),
  url: Decoration.mark({ class: 'cm-md-url' }),
  listMark: Decoration.mark({ class: 'cm-md-list-mark' }),
  punctuation: Decoration.mark({ class: 'cm-md-punctuation' }),
  taskDone: Decoration.mark({ class: 'cm-md-task-done' }),
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
  const builder = new DecorationBuilder(state, replacedBlockRanges(state))
  const spans = revealedSpans(state)

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter: (node) => builder.visit(node, spans, range),
    })
  }

  return builder.finish()
}

class DecorationBuilder {
  private readonly all: Range<Decoration>[] = []
  private readonly hiddenOnly: Range<Decoration>[] = []
  /** A node can be reached from two viewport ranges; decorate it once. */
  private readonly seen = new Set<string>()

  constructor(
    private readonly state: EditorState,
    /** Ranges a block widget has replaced; nothing inside them is decorated. */
    private readonly replaced: readonly Span[] = [],
  ) {}

  visit(node: SyntaxNodeRef, spans: readonly Span[], range: Span): void {
    // A rendered diagram stands in for its lines; decorating inside it would
    // leave orphan styling and overlapping atomic ranges.
    if (this.isReplaced(node.from, node.to)) return

    const name = node.name

    if (name.startsWith('ATXHeading')) return this.atxHeading(node, spans)
    if (name.startsWith('SetextHeading')) return this.setextHeading(node, range)

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
        // The `>` markers are QuoteMark nodes, handled on their own below: the tree
        // walk already visits them, and reaching into the subtree from here would
        // mean walking nodes outside the viewport.
        return this.eachLine(node, LINE.quote, range)
      case 'QuoteMark':
        return this.quoteMark(node, spans)
      case 'ListItem':
        return this.listItem(node, spans)
      case 'Task':
        return this.task(node, spans)
      case 'Link':
        return this.link(node, spans)
      case 'Image':
        return this.image(node, spans)
      case 'Autolink':
        return this.autolink(node, spans)
      case 'URL':
        return this.url(node)
      case 'FencedCode':
      case 'CodeBlock':
        return this.eachLine(node, LINE.code, range)
      case 'Table':
        return this.eachLine(node, LINE.table, range)
      case 'TableDelimiter':
        return this.mark(MARK.punctuation, node.from, node.to)
      case 'HorizontalRule':
        return this.eachLine(node, LINE.rule, range)
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

  /**
   * Hides a range, clamped to the end of the line it starts on.
   *
   * The clamp is the safety net for the plugin contract. A construct that can span
   * lines — an inline link whose destination wraps, say — must decide for itself
   * whether hiding half of it makes sense; what it may not do is hand a newline to
   * CodeMirror, which throws.
   */
  private hide(from: number, to: number): void {
    const lineEnd = this.state.doc.lineAt(from).to
    const end = Math.min(to, lineEnd)
    if (end <= from || !this.claim('hide', from, end)) return

    const range = HIDDEN.range(from, end)
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

  private isReplaced(from: number, to: number): boolean {
    return this.replaced.some((block) => from >= block.from && to <= block.to)
  }

  private claim(kind: string, from: number, to: number): boolean {
    const key = kind + ':' + from + ':' + to
    if (this.seen.has(key)) return false
    this.seen.add(key)
    return true
  }

  /**
   * Applies a line decoration to every line a node spans, within `range`.
   *
   * Clamped on both ends: a structure far longer than the viewport must not be
   * walked in full, and a node whose `to` sits exactly at a line start — an
   * unterminated fenced block, for instance — must not style the line after it.
   */
  private eachLine(node: SyntaxNodeRef, decoration: Decoration, range: Span): void {
    const { doc } = this.state
    const from = Math.max(node.from, range.from)
    const to = Math.min(node.to, range.to)
    if (to < from) return

    const first = doc.lineAt(from).number
    // `to - 1` keeps a node ending at a line start from claiming that line.
    const last = doc.lineAt(Math.max(from, to - 1)).number

    for (let number = first; number <= last; number += 1) {
      this.line(decoration, doc.line(number).from)
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

    const markers = node.node.getChildren('HeaderMark')
    const opening = markers.at(0)
    if (opening === undefined) return

    // A heading may be indented by up to three spaces; hide those too, or the text
    // sits indented while its neighbours are flush.
    const openingEnd = this.skipSpacesForwards(opening.to, line.to)
    this.hide(line.from, openingEnd)

    // `## Hi ##` — the closing marker takes the space before it. The backwards skip
    // stops at the opening hide so the two cannot overlap, which they did for
    // headings with no content at all (`## ##`).
    for (const marker of markers.slice(1)) {
      this.hide(this.skipSpacesBackwards(marker.from, openingEnd), marker.to)
    }
  }

  /**
   * A setext heading underlines its text with `===`, so hiding the marker would mean
   * removing a whole line — a vertical layout change, which a view plugin may not
   * make. The text is styled; the underline stays visible.
   */
  private setextHeading(node: SyntaxNodeRef, range: Span): void {
    const level = Number(node.name.slice('SetextHeading'.length))
    const style = LINE.heading[level - 1]
    if (style === undefined) return

    const marker = node.node.getChild('HeaderMark')
    const textEnd = marker === null ? node.to : marker.from
    const { doc } = this.state
    const from = Math.max(node.from, range.from)
    const to = Math.min(textEnd, range.to)
    if (to < from) return

    const first = doc.lineAt(from).number
    const last = doc.lineAt(Math.max(from, to - 1)).number

    for (let number = first; number <= last; number += 1) {
      this.line(style, doc.line(number).from)
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

  /**
   * The `>` of a quoted line, hidden with **one** following space.
   *
   * Only one: the rest is indentation, and inside a blockquote indentation is what
   * distinguishes a nested list from a sibling one.
   */
  private quoteMark(node: SyntaxNodeRef, spans: readonly Span[]): void {
    if (isRevealed(spans, node.from, node.to)) return

    const line = this.state.doc.lineAt(node.from)
    const next = node.to < line.to && this.state.doc.sliceString(node.to, node.to + 1) === ' '
    this.hide(node.from, next ? node.to + 1 : node.to)
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
   * `- [ ] something` — the marker becomes a checkbox, and a completed task is
   * dimmed so a long list reads at a glance.
   *
   * On the cursor line the raw `[ ]` shows like any other syntax. That costs
   * nothing: clicking the checkbox does not move the cursor, so the box a user
   * reaches for is always the rendered one.
   */
  private task(node: SyntaxNodeRef, spans: readonly Span[]): void {
    const marker = node.node.getChild('TaskMarker')
    if (marker === null) return

    const checked = isTaskChecked(this.state.doc.sliceString(marker.from, marker.to))
    if (checked) this.mark(MARK.taskDone, marker.to, node.to)

    if (isRevealed(spans, marker.from, marker.to)) return

    this.replaceWithWidget(checked ? CHECKBOX.checked : CHECKBOX.unchecked, marker.from, marker.to)
  }

  /**
   * `[text](url)` — shows the text, hides the brackets and the target.
   *
   * Three cases are left as source instead:
   *
   * - A reference link (`[text][label]`) has no URL child, and its label matters.
   * - A link whose destination or title wraps onto the next line, because hiding it
   *   would mean covering a line break. Rare, and showing the source is honest.
   * - A link with no text (`[](url)`), which would otherwise render as nothing at
   *   all and leave the user with an empty line they cannot see or click into.
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

    const hasText = closing.from > opening.to
    if (hasText) this.mark(MARK.link, opening.to, closing.from)

    if (isRevealed(spans, node.from, node.to)) return

    const singleLine = this.state.doc.lineAt(node.from).to >= node.to
    if (!hasText || !singleLine) return

    this.hide(opening.from, opening.to)
    // From `]` to the end of the link covers `](url "title")` in one range.
    this.hide(closing.from, node.to)
  }

  /** `<https://example.com>` — shows the URL, hides the angle brackets. */
  private autolink(node: SyntaxNodeRef, spans: readonly Span[]): void {
    this.mark(MARK.url, node.from, node.to)

    if (isRevealed(spans, node.from, node.to)) return

    for (const marker of node.node.getChildren('LinkMark')) {
      this.hide(marker.from, marker.to)
    }
  }

  /**
   * `![alt](picture.png)` — rendered when the file is in the workspace.
   *
   * A remote source is left as Markdown source. Loading it would tell that
   * server which note is open, and the CSP would refuse it anyway.
   */
  private image(node: SyntaxNodeRef, spans: readonly Span[]): void {
    const resolve = this.state.facet(imageResolver)
    const url = node.node.getChild('URL')
    if (resolve === null || url === null) return

    if (isRevealed(spans, node.from, node.to)) return
    // A replacement may not cover a line break, so an image whose source wraps
    // stays as text.
    if (this.state.doc.lineAt(node.from).to < node.to) return

    const source = this.state.doc.sliceString(url.from, url.to)
    // A source we will not load stays as Markdown, so the reader can see the URL
    // and decide for themselves. Replacing it with "not found" would be a lie:
    // nothing was looked for.
    if (!isWorkspacePath(source)) return

    const marks = node.node.getChildren('LinkMark')
    const opening = marks.at(0)
    const closing = marks.at(1)
    const alt =
      opening === undefined || closing === undefined
        ? ''
        : this.state.doc.sliceString(opening.to, closing.from)

    this.replaceWithWidget(
      Decoration.replace({ widget: new ImageWidget(source, alt, resolve) }),
      node.from,
      node.to,
    )
  }

  /** A bare URL: an autolink when it stands alone, styled either way. */
  private url(node: SyntaxNodeRef): void {
    const parent = node.node.parent?.name
    // Inside a link, image, autolink or reference the URL belongs to its container.
    if (
      parent === 'Link' ||
      parent === 'Image' ||
      parent === 'Autolink' ||
      parent === 'LinkReference'
    ) {
      return
    }

    this.mark(MARK.url, node.from, node.to)
  }

  // --- helpers --------------------------------------------------------------

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
