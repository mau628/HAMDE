import { defaultKeymap, history, historyKeymap, redo } from '@codemirror/commands'
import { syntaxHighlighting } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightSpecialChars, keymap } from '@codemirror/view'

import { codeFenceCompletion } from './codeFence'
import { markdownHighlightStyle } from './highlightStyle'
import {
  imageResolver,
  imageSourceFilter,
  type ImageResolver,
  type ImageSourceFilter,
} from './livePreview/images'
import { linkOpener, livePreview, type LinkOpener } from './livePreview'
import { createMarkdownSupport } from './markdown'
import { editorTheme } from './theme'

/**
 * The editor's extension set.
 *
 * Deliberately assembled by hand instead of using CodeMirror's `basicSetup`: that
 * bundle brings search, autocompletion, bracket matching, code folding and a
 * gutter, none of which belong in a minimal prose editor.
 *
 * Everything the editor needs from its surroundings arrives through these options,
 * so the same set runs in the browser app and in the VS Code extension's webview.
 */
export interface EditorOptions {
  /**
   * Turns an image path in a document into something the browser can show.
   *
   * Supplied by the host, which is the part that knows where the files are.
   */
  resolveImage: ImageResolver
  /** Which image sources reach `resolveImage`. Defaults to paths inside the folder. */
  acceptsImage?: ImageSourceFilter
  /** Opens a link target. Defaults to a new browser tab. */
  openLink?: LinkOpener
  /** Switches between the narrow and wide editor. Bound to Ctrl/Cmd+, when given. */
  toggleWidth?: () => void
  /**
   * Whether the editor keeps its own undo history. On unless the host owns the
   * document and its undo stack, in which case two histories would fight.
   */
  history?: boolean
}

/**
 * The undo and redo keys, claimed and then left alone.
 *
 * Without a history of its own the editor has nothing to do with them, but the
 * browser does: it would apply its own undo to the editable content, behind the
 * back of a host that is about to undo the same edit itself. Claiming the key stops
 * that; the host still sees the key press and acts on it.
 */
const HOST_UNDO_KEYS = ['Mod-z', 'Mod-y', 'Mod-Shift-z'].map((key) => ({ key, run: () => true }))

export function createEditorExtensions(options: EditorOptions): Extension[] {
  const { toggleWidth } = options
  const ownHistory = options.history ?? true

  return [
    imageResolver.of(options.resolveImage),
    options.acceptsImage ? imageSourceFilter.of(options.acceptsImage) : [],
    options.openLink ? linkOpener.of(options.openLink) : [],
    // Undo/redo. CodeMirror's history is transaction-aware, so it will treat the
    // live-preview decorations (M5) and widget edits (M6) correctly.
    ownHistory ? history() : [],
    keymap.of([
      // historyKeymap binds redo to Mod-y on Windows/Linux and Mod-Shift-z only on
      // macOS. Ctrl+Shift+Z is what users of every other editor reach for, so it is
      // bound everywhere.
      ...(ownHistory ? [{ key: 'Mod-Shift-z', run: redo }] : []),
      ...(toggleWidth
        ? [
            {
              key: 'Mod-,',
              run: () => {
                toggleWidth()
                return true
              },
            },
          ]
        : []),
      ...defaultKeymap,
      ...(ownHistory ? historyKeymap : HOST_UNDO_KEYS),
    ]),

    EditorState.allowMultipleSelections.of(true),
    drawSelection(),
    // Renders control characters visibly instead of letting them corrupt the view.
    highlightSpecialChars(),
    // Prose wraps; a Markdown document has no horizontal scroll.
    EditorView.lineWrapping,

    codeFenceCompletion,
    createMarkdownSupport(),
    syntaxHighlighting(markdownHighlightStyle),
    // Renders Markdown in place, revealing the syntax of the line the cursor is on.
    livePreview(),
    editorTheme,
  ]
}
