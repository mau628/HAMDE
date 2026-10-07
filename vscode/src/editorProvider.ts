import * as vscode from 'vscode'

import { isSafeHref } from '~/services/links'
import { resolveImagePath } from './imagePath'
import {
  parseWebviewMessage,
  sameShape,
  type FromWebview,
  type Shape,
  type TextChange,
  type ToWebview,
} from './protocol'
import { webviewHtml } from './webviewHtml'

export const VIEW_TYPE = 'hamde.markdown'

/**
 * Opens a Markdown file in the HAMDE editor.
 *
 * A custom *text* editor: VS Code owns the document. Saving, the dirty marker, hot
 * exit, undo, line endings, encoding and "the file changed on disk" are all VS
 * Code's, exactly as for a file in its own text editor. This extension only shows
 * the document in a webview and relays edits, which is why none of the web app's
 * file handling is here.
 */
export class HamdeEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly sessions = new Set<EditorSession>()

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const session = new EditorSession(this.extensionUri, document, panel)

    this.sessions.add(session)
    panel.onDidDispose(() => this.sessions.delete(session))
  }

  /**
   * The documents whose webview has started and asked for its text.
   *
   * Nothing in the extension needs this. It is what lets a test tell, from outside
   * the webview, that the editor's script really loaded and ran under the page's
   * Content Security Policy; see test/smoke.
   */
  readyDocuments(): string[] {
    return [...this.sessions]
      .filter((session) => session.ready)
      .map((session) => session.document.uri.toString())
  }
}

/** One webview showing one document. Lives as long as the panel does. */
class EditorSession {
  /** Counts the document messages sent to the webview, so it can say which it has seen. */
  private seq = 0

  /**
   * Set while an edit from the webview is being applied: the shape the document
   * will have once it lands. The change event that produces this shape is the echo
   * of that edit, which the webview already has and must not be sent again.
   */
  private echo: Shape | null = null

  /** Something other than the echo arrived while an edit was being applied. */
  private drifted = false

  /** Edits are applied one at a time, in the order the webview made them. */
  private queue: Promise<void> = Promise.resolve()

  private disposed = false

  /** Whether the webview's script has run and announced itself. */
  ready = false

  private readonly webview: vscode.Webview
  private readonly imageRoot: vscode.Uri

  constructor(
    extensionUri: vscode.Uri,
    readonly document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ) {
    this.webview = panel.webview

    // Images are read from the workspace folder the document belongs to, or from
    // its own directory when it was opened on its own.
    this.imageRoot =
      vscode.workspace.getWorkspaceFolder(document.uri)?.uri ??
      vscode.Uri.joinPath(document.uri, '..')

    const assets = vscode.Uri.joinPath(extensionUri, 'dist', 'webview')

    this.webview.options = {
      enableScripts: true,
      // The only two places the webview can load anything from. VS Code enforces
      // this itself, underneath whatever the checks in this file decide.
      localResourceRoots: [assets, this.imageRoot],
    }
    this.webview.html = webviewHtml({
      cspSource: this.webview.cspSource,
      scriptUri: this.webview.asWebviewUri(vscode.Uri.joinPath(assets, 'main.js')).toString(),
      styleUri: this.webview.asWebviewUri(vscode.Uri.joinPath(assets, 'webview.css')).toString(),
    })

    const subscriptions = [
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === document.uri.toString()) {
          this.onDocumentChange(event)
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('hamde.editor.wide')) {
          this.post({ type: 'config', wide: this.wide() })
        }
      }),
      this.webview.onDidReceiveMessage((raw: unknown) => {
        const message = parseWebviewMessage(raw)
        if (message !== null) this.onMessage(message)
      }),
    ]

    panel.onDidDispose(() => {
      this.disposed = true
      for (const subscription of subscriptions) subscription.dispose()
    })
  }

  // --- from the webview -------------------------------------------------------

  private onMessage(message: FromWebview): void {
    switch (message.type) {
      // Sent every time the webview starts, which is also every time its tab is
      // shown again: VS Code discards a hidden webview's page.
      case 'ready':
        this.ready = true
      // falls through
      case 'resync':
        // Queued behind any edit still being applied, so it describes the result.
        return this.enqueue(async () => this.sync())
      case 'edit':
        return this.enqueue(() => this.applyEdit(message.seenSeq, message.changes, message.shape))
      case 'resolveImage':
        return void this.resolveImage(message.id, message.source)
      case 'openLink':
        return this.openLink(message.href)
    }
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((error: unknown) => {
      console.error('HAMDE: could not apply an edit', error)
      this.sync()
    })
  }

  /**
   * Applies what the user typed in the webview to the document.
   *
   * The copies are known to match when this returns, one way or the other: either
   * the edit landed as the webview described it, or the webview is sent the
   * document as it actually is.
   */
  private async applyEdit(seenSeq: number, changes: TextChange[], shape: Shape): Promise<void> {
    // The edit was made before the webview saw a change we sent it, so its
    // positions refer to a document that no longer exists. The document wins.
    if (seenSeq !== this.seq) return this.sync()

    const edit = new vscode.WorkspaceEdit()
    for (const change of changes) {
      edit.replace(this.document.uri, toRange(change), change.text)
    }

    this.echo = shape
    this.drifted = false
    let applied = false
    let landed = false
    try {
      applied = await vscode.workspace.applyEdit(edit)
      landed = this.echo === null
    } finally {
      this.echo = null
    }

    // An edit that changes nothing fires no event; then the shapes simply agree.
    const consistent = landed || sameShape(shapeOf(this.document), shape)
    if (!applied || this.drifted || !consistent) this.sync()
  }

  private async resolveImage(id: number, source: string): Promise<void> {
    this.post({ type: 'image', id, uri: await this.imageUri(source) })
  }

  /** The webview address of an image in the workspace, or `null`. */
  private async imageUri(source: string): Promise<string | null> {
    const { uri } = this.document
    const path = resolveImagePath(
      uri.path,
      this.imageRoot.path,
      source,
      process.platform === 'win32',
    )
    if (path === null) return null

    const target = uri.with({ path, query: '', fragment: '' })
    try {
      const { type } = await vscode.workspace.fs.stat(target)
      // A link can point anywhere, and the folder check above only saw its name.
      if (type !== vscode.FileType.File) return null
    } catch {
      return null
    }

    return this.webview.asWebviewUri(target).toString()
  }

  /**
   * Opens a link in the user's browser.
   *
   * Checked again here although the webview checks too: this side is the one that
   * acts, so it does not take the other side's word for what is safe.
   */
  private openLink(href: string): void {
    if (!isSafeHref(href)) return
    void vscode.env.openExternal(vscode.Uri.parse(href.trim(), true))
  }

  // --- to the webview ---------------------------------------------------------

  /**
   * Relays a change to the document: an undo, an edit in another editor of the
   * same file, a formatter, or the file being reloaded from disk.
   */
  private onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    // Saving fires this event too, with nothing in it.
    if (event.contentChanges.length === 0) return

    if (this.echo !== null) {
      if (sameShape(shapeOf(this.document), this.echo)) this.echo = null
      else this.drifted = true
      return
    }

    this.seq += 1
    this.post({
      type: 'changes',
      seq: this.seq,
      changes: event.contentChanges.map(toTextChange),
      shape: shapeOf(this.document),
      reveal: event.reason !== undefined,
    })
  }

  /** Sends the whole document, replacing whatever the webview has. */
  private sync(): void {
    this.seq += 1
    this.post({ type: 'sync', seq: this.seq, text: this.document.getText(), wide: this.wide() })
  }

  private wide(): boolean {
    return vscode.workspace.getConfiguration('hamde.editor').get('wide', false)
  }

  private post(message: ToWebview): void {
    // An image lookup or a queued edit can finish after the tab was closed.
    if (!this.disposed) void this.webview.postMessage(message)
  }
}

function toRange(change: TextChange): vscode.Range {
  return new vscode.Range(
    change.start.line,
    change.start.character,
    change.end.line,
    change.end.character,
  )
}

function toTextChange(change: vscode.TextDocumentContentChangeEvent): TextChange {
  const { start, end } = change.range
  return {
    start: { line: start.line, character: start.character },
    end: { line: end.line, character: end.character },
    text: change.text,
  }
}

function shapeOf(document: vscode.TextDocument): Shape {
  const lines = document.lineCount
  const end = document.offsetAt(document.lineAt(lines - 1).range.end)
  // A CRLF document counts two characters for every line break; the webview one.
  const breakLength = document.eol === vscode.EndOfLine.CRLF ? 2 : 1

  return { length: end - (lines - 1) * (breakLength - 1), lines }
}
