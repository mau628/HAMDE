import { defaultKeymap, history, historyKeymap, redo } from '@codemirror/commands'
import { syntaxHighlighting } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightSpecialChars, keymap } from '@codemirror/view'

import { markdownHighlightStyle } from './highlightStyle'
import { createMarkdownSupport } from './markdown'
import { editorTheme } from './theme'

/**
 * The editor's extension set.
 *
 * Deliberately assembled by hand instead of using CodeMirror's `basicSetup`: that
 * bundle brings search, autocompletion, bracket matching, code folding and a
 * gutter, none of which belong in a minimal prose editor.
 */
export function createEditorExtensions(): Extension[] {
  return [
    // Undo/redo. CodeMirror's history is transaction-aware, so it will treat the
    // live-preview decorations (M5) and widget edits (M6) correctly.
    history(),
    keymap.of([
      // historyKeymap binds redo to Mod-y on Windows/Linux and Mod-Shift-z only on
      // macOS. Ctrl+Shift+Z is what users of every other editor reach for, so it is
      // bound everywhere.
      { key: 'Mod-Shift-z', run: redo },
      ...defaultKeymap,
      ...historyKeymap,
    ]),

    EditorState.allowMultipleSelections.of(true),
    drawSelection(),
    // Renders control characters visibly instead of letting them corrupt the view.
    highlightSpecialChars(),
    // Prose wraps; a Markdown document has no horizontal scroll.
    EditorView.lineWrapping,

    createMarkdownSupport(),
    syntaxHighlighting(markdownHighlightStyle),
    editorTheme,
  ]
}
