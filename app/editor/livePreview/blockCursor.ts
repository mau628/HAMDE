import type { EditorView } from '@codemirror/view'

/**
 * Getting the cursor into a replaced block.
 *
 * A block widget stands in for lines that are not in the layout, so the editor's
 * own click handling maps a click on it to a position *outside* the replaced range
 * and the source never opens. Every block widget has to do this itself, and they
 * all need the same two steps: find where the block starts, then put the cursor
 * somewhere inside it.
 *
 * The start comes from the DOM at event time rather than being captured when the
 * widget was built. CodeMirror reuses a widget wherever an equal one is needed, so
 * a position stored at build time can belong to a different part of the document by
 * the time it is clicked. What a widget may safely remember is an *offset* from its
 * own start, because that depends only on its source.
 */

/** Where the block this DOM node stands for begins, or null if that is unknowable. */
export function blockStart(view: EditorView, dom: HTMLElement): number | null {
  try {
    return view.posAtDOM(dom)
  } catch {
    // posAtDOM throws for a node that is no longer part of the content, which can
    // happen if the document changed between render and click.
    return null
  }
}

/** Moves the cursor to a position, clamped to the document, and takes focus. */
export function moveCursorTo(view: EditorView, position: number): void {
  const anchor = Math.max(0, Math.min(position, view.state.doc.length))
  view.dispatch({ selection: { anchor }, scrollIntoView: true })
  view.focus()
}
