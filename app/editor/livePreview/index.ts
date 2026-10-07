import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

import { blockPreview } from './blockPreview'
import { buildPreviewDecorations } from './decorations'
import { htmlRenderer } from './html'
import { parseInlineTag } from './htmlModel'
import { followLink } from './linkFollow'
import { mermaidRenderer } from './mermaid'
import { tableRenderer } from './table'

export { followLink, linkOpener, type LinkOpener } from './linkFollow'

/**
 * Obsidian-style live preview.
 *
 * Markdown renders in place, and the line the cursor is on shows its syntax. The
 * document always holds the original Markdown: this is presentation only.
 *
 * ## Two layers, for one reason
 *
 * Decorations can be provided either directly or through a plugin. CodeMirror's
 * documentation is explicit about the difference:
 *
 * > Only decoration sets provided directly are allowed to influence the editor's
 * > vertical layout structure. The ones provided as functions are called after the
 * > new viewport has been computed, and thus must not introduce block widgets or
 * > replacing decorations that cover line breaks.
 *
 * So there are two:
 *
 * - **Inline** (this file): a plugin, and therefore viewport-limited, which is what
 *   inline decorations want — a 50,000-line document costs the same as a short one.
 *   Nothing here may replace a line break.
 * - **Block** (`blockPreview.ts`): a state field, provided directly, for structures
 *   replaced as a whole — a rendered Mermaid diagram, a rendered table, and a
 *   rendered block of HTML.
 *
 * The inline layer skips whatever the block layer has replaced, so the two never
 * decorate the same text.
 */
export function livePreview(): Extension {
  return [
    blockPreview([mermaidRenderer, tableRenderer, htmlRenderer]),
    previewPlugin,
    atomicHiddenRanges,
    linkClicks,
  ]
}

class LivePreview {
  decorations: DecorationSet = Decoration.none
  hidden: DecorationSet = Decoration.none

  constructor(view: EditorView) {
    this.rebuild(view)
  }

  update(update: ViewUpdate): void {
    // The selection decides what is revealed, so a cursor move is a rebuild.
    // Comparing the trees also catches the parser finishing a later part of a large
    // document, which arrives as its own transaction.
    const parsedFurther = syntaxTree(update.startState) !== syntaxTree(update.state)

    if (update.docChanged || update.viewportChanged || update.selectionSet || parsedFurther) {
      this.rebuild(update.view)
    }
  }

  private rebuild(view: EditorView): void {
    const built = buildPreviewDecorations(view.state, view.visibleRanges)
    this.decorations = built.decorations
    this.hidden = built.hidden
  }
}

const previewPlugin = ViewPlugin.fromClass(LivePreview, {
  decorations: (plugin) => plugin.decorations,
})

/**
 * Makes hidden syntax behave as one unit for cursor motion and deletion.
 *
 * Without this, walking left through `**bold**` stops at invisible positions and the
 * caret appears not to move. Only the hidden ranges are atomic — styled text has to
 * stay navigable character by character.
 */
const atomicHiddenRanges = EditorView.atomicRanges.of(
  (view) => view.plugin(previewPlugin)?.hidden ?? Decoration.none,
)

/**
 * Opens a link on Ctrl/Cmd+click.
 *
 * A plain click has to keep placing the cursor: this is an editor, and the link text
 * is editable text. The target goes through `isSafeHref` before anything is opened.
 */
const linkClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false

    const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (position === null) return false

    const href = linkTargetAt(view.state, position)
    if (href === null) return false

    // Only claim the click once something was actually opened. A refused target —
    // a relative path, or `javascript:` — must still place the cursor, or the click
    // vanishes with no explanation.
    if (!followLink(view, href)) return false

    event.preventDefault()
    return true
  },
})

/**
 * The URL of the link or autolink at a position, if there is one.
 *
 * Exported for testing: this is the function that decides what a click may open, so
 * it is worth exercising directly rather than only through the browser.
 *
 * The whole ancestor chain is walked before any URL is returned, because the
 * address of an image is not a link: an image is something to look at, and
 * clicking it must not open the place it was loaded from. What an image *is* a
 * link to is whatever link it sits inside, which is how a badge is written:
 * `[![build](badge.svg)](https://ci.example)` goes to the CI, not to the badge.
 */
export function linkTargetAt(state: EditorState, position: number): string | null {
  let candidate: string | null = null

  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, 1);
    node !== null;
    node = node.parent
  ) {
    // Whatever was found on the way up to an image belongs to the image.
    if (node.name === 'Image') {
      candidate = null
      continue
    }

    if (node.name === 'Link') {
      const url = node.getChild('URL')
      candidate = url === null ? null : unwrapAngleBrackets(state.doc.sliceString(url.from, url.to))
      continue
    }

    if (candidate === null && (node.name === 'URL' || node.name === 'Autolink')) {
      candidate = unwrapAngleBrackets(state.doc.sliceString(node.from, node.to))
    }
  }

  return candidate ?? htmlLinkTargetAt(state, position)
}

/**
 * The `href` of the inline `<a>` a position is inside, if there is one.
 *
 * An inline anchor is not a node of its own: Markdown hands over `<a href="…">` and
 * `</a>` as two tags with ordinary text between them. So the tags on the line are
 * read in order, and whichever anchor is still open at the position is the answer.
 * The only `href` ever recorded for a tag is one that passed `isSafeHref`, or one
 * that points at a heading of this document.
 */
function htmlLinkTargetAt(state: EditorState, position: number): string | null {
  const line = state.doc.lineAt(position)
  const open: string[] = []

  syntaxTree(state).iterate({
    from: line.from,
    to: position,
    enter: (node) => {
      if (node.name !== 'HTMLTag' || node.from < line.from || node.to > position) return

      const tag = parseInlineTag(state.doc.sliceString(node.from, node.to))
      if (tag === null || tag.name !== 'a') return

      if (tag.kind === 'open') open.push(tag.attributes.href ?? '')
      else if (tag.kind === 'close') open.pop()
    },
  })

  return open.at(-1) || null
}

/**
 * `<https://example.com>` is a URL in pointy brackets, which CommonMark allows both
 * as an autolink and as a link destination. The brackets are syntax, not part of the
 * target, and leaving them on makes the URL unparseable — so the link never opened.
 */
function unwrapAngleBrackets(url: string): string {
  const trimmed = url.trim()
  return trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1) : trimmed
}
