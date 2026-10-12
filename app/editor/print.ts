import { forceParsing } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { ViewPlugin, type EditorView } from '@codemirror/view'

import { isPrinting, setPrinting } from './livePreview/reveal'

/**
 * Printing the document.
 *
 * What goes on paper is the editor itself, restyled by the `@media print` rules in
 * the stylesheets, so a printed page cannot drift from the preview on screen. Three
 * things about the editor are wrong for paper, and each is put right here:
 *
 * - **It only draws what is on screen.** Everything else is an empty spacer of the
 *   right height. The whole document is drawn for the duration of the print.
 * - **It reveals the line the cursor is on.** Paper has no cursor; see
 *   `printingField`.
 * - **Images and diagrams arrive late.** A file is read, a diagram is drawn, and
 *   neither is there yet when the element is created. The print waits for them.
 *
 * The last one needs time, and only a print started from here has any: the browser
 * gives a page no chance to wait once its own menu has been used. Such a print still
 * gets the whole document with nothing revealed, but an image that was never
 * scrolled to is not in it.
 */

export interface PrintOptions {
  /** The page's title for the duration, which is what a saved PDF is named after. */
  title?: string
}

/** How long the parser gets to reach the end of a very large document. */
const PARSE_TIMEOUT = 5000

/** How long images and diagrams get. A print that never starts is worse than a gap. */
const SETTLE_TIMEOUT = 8000

function drawForPaper(view: EditorView, on: boolean): void {
  if (isPrinting(view.state) !== on) view.dispatch({ effects: setPrinting.of(on) })
}

/**
 * Lifts the limit that keeps the editor to drawing only what is visible.
 *
 * CodeMirror has this switch and throws it itself when the browser announces a
 * print, but it has no public name: it turns it back off half a second later, which
 * is not long enough to load an image in. `tests/e2e/print.spec.ts` is what says so
 * if an upgrade moves it.
 */
function drawWholeDocument(view: EditorView, whole: boolean): void {
  const { viewState } = view as unknown as { viewState?: { printing: boolean } }
  if (viewState !== undefined) viewState.printing = whole
  view.requestMeasure()
}

/** Resolves once the editor has measured again, which is when it redraws. */
function measured(view: EditorView): Promise<void> {
  return new Promise((resolve) => {
    view.requestMeasure({ read: () => null, write: () => resolve() })
    // A page that is not being shown is not measured at all.
    setTimeout(resolve, 500)
  })
}

function isPending(content: HTMLElement): boolean {
  if (content.querySelector('.cm-md-diagram--pending') !== null) return true

  // An image is given its address once its file has been read, and is replaced by
  // a note if there is nothing to show; one with no address is still on its way.
  return [...content.querySelectorAll<HTMLImageElement>('img.cm-md-image__img')].some(
    (image) => image.getAttribute('src') === null || !image.complete,
  )
}

async function settled(view: EditorView): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT

  do {
    await new Promise((resolve) => setTimeout(resolve, 50))
  } while (isPending(view.contentDOM) && Date.now() < deadline)
}

/** One print at a time: a second request while the first is being prepared is the same one. */
let busy = false

/**
 * Prints the document: the whole of it, rendered, once everything in it has loaded.
 *
 * Resolves when the print dialog has been closed, in a browser that says when that
 * is.
 */
export async function printDocument(view: EditorView, options: PrintOptions = {}): Promise<void> {
  if (busy) return
  busy = true

  const title = document.title
  let began = false

  const onBegin = () => {
    began = true
  }

  const finish = () => {
    window.removeEventListener('beforeprint', onBegin)
    window.removeEventListener('afterprint', finish)

    drawWholeDocument(view, false)
    drawForPaper(view, false)
    document.title = title
    busy = false
  }

  try {
    // The preview is built from the syntax tree, and the parser stops a little past
    // what is on screen until it is asked for more.
    forceParsing(view, view.state.doc.length, PARSE_TIMEOUT)

    drawForPaper(view, true)
    drawWholeDocument(view, true)
    await measured(view)
    await settled(view)

    if (options.title) document.title = options.title

    window.addEventListener('beforeprint', onBegin)
    window.addEventListener('afterprint', finish)
    window.print()
  } catch (cause) {
    finish()
    throw cause
  }

  // Nothing announced a print, so nothing will announce its end either.
  if (!began) finish()
}

/**
 * A print started from the browser's own menu.
 *
 * CodeMirror draws the whole document for that by itself. What it cannot know is
 * that the line the cursor is on should not show its syntax.
 */
const menuPrint = ViewPlugin.define((view) => {
  const before = () => drawForPaper(view, true)
  const after = () => drawForPaper(view, false)

  window.addEventListener('beforeprint', before)
  window.addEventListener('afterprint', after)

  return {
    destroy() {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    },
  }
})

export function printSupport(): Extension {
  return menuPrint
}
