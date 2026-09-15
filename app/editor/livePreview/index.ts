import { syntaxTree } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

import { openExternal } from '~/services/links'
import { buildPreviewDecorations } from './decorations'

/**
 * Obsidian-style live preview.
 *
 * Markdown renders in place, and the line the cursor is on shows its syntax. The
 * document always holds the original Markdown: this is presentation only.
 *
 * ## Why this is a view plugin
 *
 * Decorations can be provided either directly or through a plugin. CodeMirror's
 * documentation is explicit about the difference:
 *
 * > Only decoration sets provided directly are allowed to influence the editor's
 * > vertical layout structure. The ones provided as functions are called after the
 * > new viewport has been computed, and thus must not introduce block widgets or
 * > replacing decorations that cover line breaks.
 *
 * A plugin only sees the viewport, which is exactly what inline decorations want: a
 * 50,000-line document costs the same as a short one. The price is that nothing here
 * may replace a line break — hence the rendered Mermaid diagram (M8), which replaces
 * a whole block, has to come from a state field instead.
 */
export function livePreview(): Extension {
  return [previewPlugin, atomicHiddenRanges, linkClicks]
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

    const href = linkTargetAt(view, position)
    if (href === null) return false

    event.preventDefault()
    return openExternal(href)
  },
})

/** The URL of the link or autolink at a position, if there is one. */
function linkTargetAt(view: EditorView, position: number): string | null {
  let node = syntaxTree(view.state).resolveInner(position, 1)

  while (node.parent !== null) {
    if (node.name === 'Link') {
      const url = node.getChild('URL')
      return url === null ? null : view.state.doc.sliceString(url.from, url.to)
    }
    if (node.name === 'URL') {
      return view.state.doc.sliceString(node.from, node.to)
    }
    if (node.name === 'Image') return null
    node = node.parent
  }

  return null
}
