import { Annotation, EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'

import { createEditorExtensions } from '~/editor/editorConfig'
import { followLink } from '~/editor/livePreview'
import { isLocalPath } from '~/services/imagePath'
import { isSafeHref } from '~/services/links'
import { sameShape, type FromWebview, type TextChange, type ToWebview } from '../protocol'
import { offsetAt, shapeOf, toTextChanges } from './changes'

/**
 * The editor, inside VS Code's webview.
 *
 * This is the same editor as the web app's: `createEditorExtensions` from
 * app/editor, given the three things only its surroundings can provide. Here those
 * come from the extension, over messages, because a webview can reach neither the
 * file system nor the user's browser.
 *
 * The document belongs to VS Code. This page holds a copy and keeps it equal by
 * exchanging changes; see ../protocol.ts.
 */

/** Where the user was, kept by VS Code while this page is discarded and rebuilt. */
interface ViewState {
  anchor: number
  head: number
  scrollTop: number
}

const vscode = acquireVsCodeApi<ViewState>()

function post(message: FromWebview): void {
  vscode.postMessage(message)
}

/**
 * Marks a transaction as the document catching up with VS Code rather than the
 * user typing. Without it every change received would be sent straight back.
 */
const Remote = Annotation.define<boolean>()

let view: EditorView | undefined

/** The last message about the document that has been applied here. */
let seenSeq = 0

// --- theme ------------------------------------------------------------------

/**
 * Follows VS Code's theme.
 *
 * The editor core reads `data-theme` for its syntax palette and for Mermaid, so the
 * kind of theme VS Code reports on <body> is translated into that. The surrounding
 * colours come from VS Code's own variables, in webview.css.
 */
function followTheme(): void {
  const { classList } = document.body
  const dark =
    classList.contains('vscode-dark') ||
    (classList.contains('vscode-high-contrast') &&
      !classList.contains('vscode-high-contrast-light'))

  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

followTheme()
new MutationObserver(followTheme).observe(document.body, {
  attributes: true,
  attributeFilter: ['class'],
})

// --- images and links -------------------------------------------------------

const waitingImages = new Map<number, (uri: string | null) => void>()
const knownImages = new Map<string, Promise<string | null>>()
let lastImageId = 0

/** Asks the extension where an image is. It decides whether it may be shown. */
function resolveImage(source: string): Promise<string | null> {
  const known = knownImages.get(source)
  if (known !== undefined) return known

  const lookup = new Promise<string | null>((resolve) => {
    lastImageId += 1
    waitingImages.set(lastImageId, resolve)
    post({ type: 'resolveImage', id: lastImageId, source })
  })

  knownImages.set(source, lookup)
  // Only a hit is remembered: a missing image may be added while the file is open.
  void lookup.then((uri) => {
    if (uri === null) knownImages.delete(source)
  })

  return lookup
}

/** Hands a link to the extension, which opens it in the user's browser. */
function openLink(href: string): boolean {
  if (!isSafeHref(href)) return false

  post({ type: 'openLink', href: href.trim() })
  return true
}

/**
 * Keeps every anchor on the editor's own terms.
 *
 * A rendered table contains real anchors. Left alone, VS Code opens any anchor
 * clicked in a webview, which would bypass both rules the editor has: a plain click
 * edits the text, and a target is checked before it is opened.
 */
document.addEventListener(
  'click',
  (event) => {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null
    if (anchor === null) return

    event.preventDefault()
    event.stopPropagation()

    if (view !== undefined && (event.ctrlKey || event.metaKey)) {
      // To a heading of this document, or to the extension by way of `openLink`.
      followLink(view, anchor.getAttribute('href') ?? anchor.getAttribute('xlink:href') ?? '')
    }
  },
  true,
)

// --- the document -----------------------------------------------------------

function createView(text: string): EditorView {
  const created = new EditorView({
    state: EditorState.create({
      doc: text,
      extensions: [
        ...createEditorExtensions({
          resolveImage,
          // The extension enforces the workspace boundary, so `..` is its call.
          acceptsImage: isLocalPath,
          openLink,
          // Undo belongs to VS Code, which owns the document. A second history in
          // here would undo the same edit twice.
          history: false,
        }),
        EditorView.updateListener.of(onUpdate),
      ],
    }),
    parent: document.getElementById('editor')!,
  })

  const saved = vscode.getState()
  if (saved !== undefined) {
    const { length } = created.state.doc
    created.dispatch({
      selection: EditorSelection.single(
        Math.min(saved.anchor, length),
        Math.min(saved.head, length),
      ),
    })
    requestAnimationFrame(() => {
      created.scrollDOM.scrollTop = saved.scrollTop
    })
  }

  created.scrollDOM.addEventListener('scroll', rememberSoon, { passive: true })
  created.focus()

  return created
}

function onUpdate(update: ViewUpdate): void {
  const remote = update.transactions.some((transaction) => transaction.annotation(Remote))

  if (update.docChanged && !remote) {
    post({
      type: 'edit',
      seenSeq,
      changes: toTextChanges(update.changes, update.startState.doc),
      shape: shapeOf(update.state.doc),
    })
  }

  if (update.docChanged || update.selectionSet) rememberSoon()
}

/** Replaces the whole document with VS Code's. */
function sync(text: string): void {
  if (view === undefined) {
    view = createView(text)
    return
  }

  const { state } = view
  const next = state.toText(text)
  // Identical text would still reset the cursor, so it is left alone.
  if (next.eq(state.doc)) return

  const { anchor, head } = state.selection.main
  view.dispatch({
    changes: { from: 0, to: state.doc.length, insert: next },
    selection: EditorSelection.single(
      Math.min(anchor, next.length),
      Math.min(head, next.length),
    ),
    annotations: Remote.of(true),
  })
}

/** Applies changes made elsewhere, in order, each to the result of the last. */
function applyChanges(target: EditorView, changes: TextChange[], reveal: boolean): void {
  for (const [index, change] of changes.entries()) {
    const { doc } = target.state
    const from = offsetAt(doc, change.start)
    const to = Math.max(from, offsetAt(doc, change.end))
    const insert = target.state.toText(change.text)
    const last = index === changes.length - 1

    target.dispatch({
      changes: { from, to, insert },
      annotations: Remote.of(true),
      // After an undo the cursor goes to what was undone, as it does anywhere else.
      ...(reveal && last
        ? { selection: { anchor: from + insert.length }, scrollIntoView: true }
        : {}),
    })
  }
}

let rememberTimer: ReturnType<typeof setTimeout> | undefined

function rememberSoon(): void {
  clearTimeout(rememberTimer)
  rememberTimer = setTimeout(() => {
    if (view === undefined) return
    const { anchor, head } = view.state.selection.main
    vscode.setState({ anchor, head, scrollTop: view.scrollDOM.scrollTop })
  }, 200)
}

function setWide(wide: boolean): void {
  document.body.classList.toggle('hamde-wide', wide)
}

// --- messages from the extension --------------------------------------------

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
  const message = event.data

  switch (message.type) {
    case 'sync':
      seenSeq = message.seq
      setWide(message.wide)
      sync(message.text)
      return

    case 'changes':
      // Nothing to apply them to yet; the sync that is on its way includes them.
      if (view === undefined) return

      seenSeq = message.seq
      applyChanges(view, message.changes, message.reveal)
      if (!sameShape(shapeOf(view.state.doc), message.shape)) post({ type: 'resync' })
      return

    case 'config':
      setWide(message.wide)
      return

    case 'image':
      waitingImages.get(message.id)?.(message.uri)
      waitingImages.delete(message.id)
      return
  }
})

// Typing should work as soon as the tab is selected, without a click first.
window.addEventListener('focus', () => view?.focus())

post({ type: 'ready' })
