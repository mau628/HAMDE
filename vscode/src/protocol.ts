/**
 * The messages between the extension and its webview.
 *
 * The document lives in VS Code. The webview holds a copy, and the two are kept
 * equal by sending changes, never the whole text, in both directions — a keystroke
 * in a megabyte document must not cost a megabyte.
 *
 * Positions are a line and a character, not an offset. CodeMirror stores every line
 * break as one character and VS Code keeps a CRLF file as two, so an offset means
 * different things on each side; a line and a character mean the same.
 *
 * Shared by both halves, so it imports nothing from either.
 */

/** A zero-based line, and a UTF-16 offset within it. */
export interface Position {
  line: number
  character: number
}

/** Replaces the text between two positions. */
export interface TextChange {
  start: Position
  end: Position
  text: string
}

/**
 * Enough about a document to tell that two copies have drifted, without sending
 * either. `length` counts each line break as one character, whatever the file uses.
 */
export interface Shape {
  length: number
  lines: number
}

export function sameShape(a: Shape, b: Shape): boolean {
  return a.length === b.length && a.lines === b.lines
}

export type ToWebview =
  /** The whole document. Sent once at start, and again whenever the copies drift. */
  | { type: 'sync'; seq: number; text: string; wide: boolean }
  /**
   * Changes made outside this webview. Applied in order, each to the result of the
   * one before. `reveal` moves the cursor to them, for undo and redo.
   */
  | { type: 'changes'; seq: number; changes: TextChange[]; shape: Shape; reveal: boolean }
  | { type: 'config'; wide: boolean }
  | { type: 'image'; id: number; uri: string | null }

export type FromWebview =
  | { type: 'ready' }
  /**
   * Something the user typed. Every position refers to the document as it was
   * before the edit, and `shape` describes it afterwards. `seenSeq` is the last
   * message from the extension the webview had applied when the edit was made.
   */
  | { type: 'edit'; seenSeq: number; changes: TextChange[]; shape: Shape }
  /** The webview found its copy does not match what the extension described. */
  | { type: 'resync' }
  | { type: 'resolveImage'; id: number; source: string }
  | { type: 'openLink'; href: string }

/**
 * Checks a message from the webview before the extension acts on it.
 *
 * The webview is where untrusted Markdown is rendered, so it is the less trusted
 * side: nothing it sends is used without being checked here first.
 */
export function parseWebviewMessage(value: unknown): FromWebview | null {
  if (!isRecord(value)) return null

  switch (value.type) {
    case 'ready':
    case 'resync':
      return { type: value.type }

    case 'edit': {
      const { seenSeq, changes, shape } = value
      if (!isCount(seenSeq) || !Array.isArray(changes) || !isShape(shape)) return null
      if (!changes.every(isTextChange)) return null
      return { type: 'edit', seenSeq, changes, shape }
    }

    case 'resolveImage': {
      const { id, source } = value
      if (!isCount(id) || typeof source !== 'string') return null
      return { type: 'resolveImage', id, source }
    }

    case 'openLink':
      return typeof value.href === 'string' ? { type: 'openLink', href: value.href } : null

    default:
      return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isPosition(value: unknown): value is Position {
  return isRecord(value) && isCount(value.line) && isCount(value.character)
}

function isTextChange(value: unknown): value is TextChange {
  return (
    isRecord(value) &&
    isPosition(value.start) &&
    isPosition(value.end) &&
    typeof value.text === 'string'
  )
}

function isShape(value: unknown): value is Shape {
  return isRecord(value) && isCount(value.length) && isCount(value.lines)
}
