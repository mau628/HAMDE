import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import { Decoration, type DecorationSet } from '@codemirror/view'
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common'

import { replacedBlockRanges } from './blockPreview'
import { OPEN_LINK_HINT } from '~/services/links'
import { parseInlineTag, type InlineTag } from './htmlModel'
import { imageLoader, ImageWidget } from './images'
import { isRevealed, revealedSpans, type Span } from './reveal'
import { isTaskChecked } from './task'
import { BreakWidget, BulletWidget, CheckboxWidget, RuleWidget } from './widgets'

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

const RULE = Decoration.replace({ widget: new RuleWidget() })

const BREAK = Decoration.replace({ widget: new BreakWidget() })

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
  link: Decoration.mark({ class: 'cm-md-link', attributes: { title: OPEN_LINK_HINT } }),
  url: Decoration.mark({ class: 'cm-md-url', attributes: { title: OPEN_LINK_HINT } }),
  listMark: Decoration.mark({ class: 'cm-md-list-mark' }),
  /** The `-` of a bullet on a revealed line, as wide as the bullet it stands for. */
  bulletMark: Decoration.mark({ class: 'cm-md-list-mark cm-md-bullet-mark' }),
  punctuation: Decoration.mark({ class: 'cm-md-punctuation' }),
  taskDone: Decoration.mark({ class: 'cm-md-task-done' }),
} as const

/**
 * How many levels of list nesting get their own indentation. Deeper items are
 * indented like the deepest of these, which is further than a page can show anyway.
 */
const LIST_DEPTHS = [1, 2, 3, 4, 5, 6, 7, 8]

const LINE = {
  heading: [1, 2, 3, 4, 5, 6].map((level) =>
    Decoration.line({ class: 'cm-md-heading cm-md-h' + level }),
  ),
  // A setext heading already has its underline in the text, so it is told apart
  // from one that gets a rule drawn under it.
  setext: [1, 2].map((level) =>
    Decoration.line({ class: 'cm-md-heading cm-md-h' + level + ' cm-md-setext' }),
  ),
  quote: Decoration.line({ class: 'cm-md-quote' }),
  code: Decoration.line({ class: 'cm-md-code-line' }),
  codeFirst: Decoration.line({ class: 'cm-md-code-first' }),
  codeLast: Decoration.line({ class: 'cm-md-code-last' }),
  table: Decoration.line({ class: 'cm-md-table-line' }),
  rule: Decoration.line({ class: 'cm-md-rule' }),
  /** The line a list item starts on: indented by depth, with its marker hanging. */
  listItem: LIST_DEPTHS.map((depth) =>
    Decoration.line({ class: 'cm-md-list cm-md-list-' + depth + ' cm-md-list-item' }),
  ),
  /** Any other line of the item, indented to match. */
  listRest: LIST_DEPTHS.map((depth) =>
    Decoration.line({ class: 'cm-md-list cm-md-list-' + depth }),
  ),
} as const

/** Inline HTML that is another way of writing something Markdown already has. */
const HTML_AS_MARKDOWN: Readonly<Record<string, Decoration>> = {
  b: MARK.strong,
  strong: MARK.strong,
  i: MARK.emphasis,
  em: MARK.emphasis,
  s: MARK.strikethrough,
  del: MARK.strikethrough,
  strike: MARK.strikethrough,
  code: MARK.inlineCode,
}

/** Inline HTML with no Markdown equivalent, drawn as the element it names. */
const HTML_ELEMENTS = new Set([
  'kbd', 'sub', 'sup', 'u', 'mark', 'small', 'ins', 'abbr', 'cite', 'q', 'var', 'samp', 'span',
])

/** How far along a paragraph a closing tag is looked for. */
const MAX_TAG_DISTANCE = 400

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
    if (name === 'HTMLTag') return this.htmlTag(node, spans)

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
        return this.listItem(node, spans, range)
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
        return this.fencedCode(node, spans, range)
      case 'CodeBlock':
        return this.eachLine(node, LINE.code, range)
      case 'Table':
        return this.eachLine(node, LINE.table, range)
      case 'TableDelimiter':
        return this.mark(MARK.punctuation, node.from, node.to)
      case 'HorizontalRule':
        return this.rule(node, spans, range)
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
  private eachLine(node: Span, decoration: Decoration, range: Span): void {
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
    const style = LINE.setext[level - 1]
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
  private listItem(node: SyntaxNodeRef, spans: readonly Span[], range: Span): void {
    this.indentListItem(node, range)

    const marker = node.node.getChild('ListMark')
    if (marker === null) return

    const text = this.state.doc.sliceString(marker.from, marker.to)
    const ordered = /\d/.test(text)

    if (ordered) return this.mark(MARK.listMark, marker.from, marker.to)
    if (isRevealed(spans, marker.from, marker.to)) {
      return this.mark(MARK.bulletMark, marker.from, marker.to)
    }

    this.replaceWithWidget(BULLET, marker.from, marker.to)
  }

  /**
   * Indents every line of a list item by how deeply the item is nested.
   *
   * The indentation in the source cannot do this on its own. It is a few spaces,
   * and in a proportional font a few spaces are almost nothing: a nested list sat
   * all but flush with its parent, and a top-level list was not indented at all.
   *
   * An item's lines include those of the lists nested inside it, so a nested line
   * is given a class by each of its ancestors. The stylesheet orders the depths so
   * that the deepest wins, which is the one the line belongs to.
   */
  private indentListItem(node: SyntaxNodeRef, range: Span): void {
    let depth = 0
    for (let parent = node.node.parent; parent !== null; parent = parent.parent) {
      if (parent.name === 'BulletList' || parent.name === 'OrderedList') depth += 1
    }

    const level = Math.min(Math.max(depth, 1), LIST_DEPTHS.length) - 1
    const first = this.state.doc.lineAt(node.from)

    if (first.from <= range.to && first.to >= range.from) {
      this.line(LINE.listItem[level]!, first.from)
    }
    if (node.to > first.to) {
      this.eachLine({ from: first.to + 1, to: node.to }, LINE.listRest[level]!, range)
    }
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

  /**
   * A fenced block: every line styled as code, and the fences hidden until the
   * cursor is somewhere in the block.
   *
   * Only the text of a fence line is hidden. The line itself stays, as the top or
   * bottom margin of the block: removing a line is a vertical layout change, which
   * this layer may not make, and it would make the block jump when it is entered.
   * The whole block is the unit, as for any multi-line structure — showing the
   * fences only while the cursor sat on a fence would leave no way to see which
   * language a block is in while editing the code.
   */
  private fencedCode(node: SyntaxNodeRef, spans: readonly Span[], range: Span): void {
    this.eachLine(node, LINE.code, range)

    const { doc } = this.state
    const first = doc.lineAt(node.from)
    const marks = node.node.getChildren('CodeMark')
    const opening = marks.at(0)
    const closing = marks.at(1)

    if (first.from <= range.to && first.to >= range.from) this.line(LINE.codeFirst, first.from)
    if (closing !== undefined) {
      const last = doc.lineAt(closing.from)
      if (last.from <= range.to && last.to >= range.from) this.line(LINE.codeLast, last.from)
    }

    if (isRevealed(spans, node.from, node.to)) return

    // To the end of the line, which takes the language name with the opening fence.
    if (opening !== undefined) this.hide(opening.from, first.to)
    if (closing !== undefined) this.hide(closing.from, doc.lineAt(closing.from).to)
  }

  /**
   * `---` — drawn as a rule, and shown as the characters it is written with only
   * on the line the cursor is on.
   */
  private rule(node: SyntaxNodeRef, spans: readonly Span[], range: Span): void {
    this.eachLine(node, LINE.rule, range)

    if (isRevealed(spans, node.from, node.to)) return

    this.replaceWithWidget(RULE, node.from, node.to)
  }

  /**
   * Inline HTML: `<kbd>Ctrl</kbd>`, `<sub>2</sub>`, `<br>`, `<img width="…">`.
   *
   * Markdown hands these over one tag at a time, with the text between an opening
   * and a closing tag left as ordinary Markdown. So this works like `**bold**`:
   * the content is styled where it stands, and the tags are hidden as syntax.
   * Nothing from the document is turned into markup. The element drawn is one this
   * file names, and the only attributes used are the ones `parseInlineTag` checked.
   *
   * A tag this editor does not draw, one with no partner, and one that wraps onto
   * another line all stay as the text they are.
   */
  private htmlTag(node: SyntaxNodeRef, spans: readonly Span[]): void {
    if (this.state.doc.lineAt(node.from).to < node.to) return

    const tag = parseInlineTag(this.state.doc.sliceString(node.from, node.to))
    if (tag === null || tag.kind === 'close') return
    if (tag.kind === 'void') return this.voidHtmlTag(node, tag, spans)

    const style = htmlStyle(tag)
    if (style === null) return

    const closing = this.closingTag(node.node, tag.name)
    if (closing === null) return

    this.mark(style, node.to, closing.from)

    // The element is the unit: revealing one tag of a pair would read as a typo.
    if (isRevealed(spans, node.from, closing.to)) return

    this.hide(node.from, node.to)
    this.hide(closing.from, closing.to)
  }

  private voidHtmlTag(node: SyntaxNodeRef, tag: InlineTag, spans: readonly Span[]): void {
    if (isRevealed(spans, node.from, node.to)) return

    if (tag.name === 'br') return this.replaceWithWidget(BREAK, node.from, node.to)
    if (tag.name !== 'img') return

    // The same question a Markdown image is asked, with the same answer.
    const { src, alt = '', width, height } = tag.attributes
    const load = src === undefined ? null : imageLoader(this.state)(src)
    if (src === undefined || load === null) return

    this.replaceWithWidget(
      Decoration.replace({ widget: new ImageWidget(src, alt, load, { width, height }) }),
      node.from,
      node.to,
    )
  }

  /** The tag that closes `open`, allowing for the same element nested inside it. */
  private closingTag(open: SyntaxNode, name: string): SyntaxNode | null {
    let nested = 0
    let distance = 0

    for (let next = open.nextSibling; next !== null; next = next.nextSibling) {
      distance += 1
      if (distance > MAX_TAG_DISTANCE) return null
      if (next.name !== 'HTMLTag') continue

      const tag = parseInlineTag(this.state.doc.sliceString(next.from, next.to))
      if (tag === null || tag.name !== name) continue

      if (tag.kind === 'open') nested += 1
      else if (tag.kind === 'close' && nested === 0) return next
      else if (tag.kind === 'close') nested -= 1
    }

    return null
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
   * `![alt](picture.png)` — rendered when the file is in the workspace, or when
   * the source is an `https:` address.
   */
  private image(node: SyntaxNodeRef, spans: readonly Span[]): void {
    const url = node.node.getChild('URL')
    if (url === null) return

    if (isRevealed(spans, node.from, node.to)) return
    // A replacement may not cover a line break, so an image whose source wraps
    // stays as text.
    if (this.state.doc.lineAt(node.from).to < node.to) return

    const source = this.state.doc.sliceString(url.from, url.to)
    // A source we will not load stays as Markdown, so the reader can see what it
    // is. Replacing it with "not found" would be a lie: nothing was looked for.
    const load = imageLoader(this.state)(source)
    if (load === null) return

    const marks = node.node.getChildren('LinkMark')
    const opening = marks.at(0)
    const closing = marks.at(1)
    const alt =
      opening === undefined || closing === undefined
        ? ''
        : this.state.doc.sliceString(opening.to, closing.from)

    this.replaceWithWidget(
      Decoration.replace({ widget: new ImageWidget(source, alt, load) }),
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

/** How the content of an inline HTML element is drawn, or null if it is not. */
function htmlStyle(tag: InlineTag): Decoration | null {
  if (tag.name === 'a') return tag.attributes.href === undefined ? null : MARK.link

  const known = HTML_AS_MARKDOWN[tag.name]
  if (known !== undefined) return known
  if (!HTML_ELEMENTS.has(tag.name)) return null

  const { title } = tag.attributes
  return Decoration.mark({
    tagName: tag.name,
    class: 'cm-md-html-' + tag.name,
    ...(title === undefined ? {} : { attributes: { title } }),
  })
}
