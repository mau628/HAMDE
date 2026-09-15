import type { FileNode, FileStamp, WriteResult } from '~/types/fileSystem'

/**
 * Autosave, as an explicit state machine.
 *
 * Deliberately free of Vue and Nuxt so the part of the app where data loss lives can
 * be tested directly, with fake timers and without a browser. The composable around
 * it (`useDocument`) only mirrors the state into refs.
 *
 *   clean ──edit──▶ dirty ──debounce──▶ saving ──ok──▶ clean
 *                     ▲                   │
 *                     └─ edit while saving┤
 *                                         ├─ stamp mismatch ─▶ conflict
 *                                         └─ failure ────────▶ error
 *
 * Two rules the implementation must never break:
 *
 * 1. Pending text is never dropped. Not on conflict, not on error, not when the
 *    document is closed while a save is failing.
 * 2. A conflict never auto-retries. Retrying would overwrite whatever the other
 *    program wrote.
 */

export type SaveState =
  | { status: 'clean' }
  | { status: 'dirty' }
  | { status: 'saving' }
  /** The file changed on disk; nothing was written. Resolved by the UI in M4. */
  | { status: 'conflict'; current: FileStamp }
  | { status: 'error'; message: string }

export interface AutoSaveDependencies {
  write: (file: FileNode, text: string, expected: FileStamp | null) => Promise<WriteResult>
  ensurePermission: (file: FileNode) => Promise<boolean>
  /** Called on every transition, so the UI can render the current state. */
  onState: (state: SaveState) => void
  /** Quiet period after the last keystroke. */
  delayMs?: number
}

export interface AutoSaveController {
  /** Starts tracking a document. The previous one must be closed first. */
  attach: (file: FileNode, stamp: FileStamp) => void
  /** Records an edit and (re)starts the debounce. */
  edit: (text: string) => void
  /** Writes any pending text now. Resolves once nothing more can be written. */
  flush: () => Promise<void>
  /**
   * Flushes and stops tracking the document.
   *
   * Returns `false` when the text could not be written — the document stays attached
   * with its pending text so the caller can refuse to switch away from it.
   */
  close: () => Promise<boolean>
  /**
   * Resolves a conflict by writing the pending text regardless of what is on disk.
   *
   * Only ever called from an explicit user action: this is the one path that
   * deliberately discards another program's changes.
   */
  overwrite: () => Promise<void>
  /**
   * Drops the pending text.
   *
   * The counterpart of `overwrite`, for when the user chooses the version on disk.
   * The caller must re-read the file and `attach` it again.
   */
  discardPendingText: () => void
  getState: () => SaveState
  /** Whether text is waiting to be written. */
  hasPendingText: () => boolean
  dispose: () => void
}

const DEFAULT_DELAY_MS = 500

export function createAutoSave(dependencies: AutoSaveDependencies): AutoSaveController {
  const delayMs = dependencies.delayMs ?? DEFAULT_DELAY_MS

  let file: FileNode | null = null
  let stamp: FileStamp | null = null
  /** Text the user has typed that is not on disk yet. `null` means nothing pending. */
  let pending: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null
  let state: SaveState = { status: 'clean' }

  function setState(next: SaveState): void {
    state = next
    dependencies.onState(next)
  }

  function cancelTimer(): void {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  /**
   * @param force  Write regardless of what is on disk, for an explicit overwrite.
   *               Every other write passes the stamp and can come back a conflict.
   */
  async function writePending(force: boolean): Promise<void> {
    if (file === null || pending === null) return

    const target = file
    const text = pending
    setState({ status: 'saving' })

    try {
      if (!(await dependencies.ensurePermission(target))) {
        setState({ status: 'error', message: 'Permission to write this file was denied.' })
        return
      }

      const result = await dependencies.write(target, text, force ? null : stamp)

      if (!result.ok) {
        // Leave `pending` in place: the text is the user's, and the UI offers a choice.
        setState({ status: 'conflict', current: result.current })
        return
      }

      if (file === target) stamp = result.stamp

      if (pending === text) {
        pending = null
        setState({ status: 'clean' })
        return
      }

      // The user typed while the write was in progress: write again immediately.
      // Not forced: the stamp is now the one our own write produced.
      await writePending(false)
    } catch (cause) {
      setState({
        status: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  /** Serialises writes: concurrent callers await the same operation. */
  function run(force = false): Promise<void> {
    if (inFlight === null) {
      inFlight = writePending(force).finally(() => {
        inFlight = null
      })
    }
    return inFlight
  }

  async function flush(): Promise<void> {
    cancelTimer()
    await run()

    // An edit can land after a write has already checked the pending text. One extra
    // pass covers it; a conflict or error must not be retried automatically.
    if (pending !== null && state.status !== 'conflict' && state.status !== 'error') {
      await run()
    }
  }

  return {
    attach(nextFile, nextStamp) {
      cancelTimer()
      file = nextFile
      stamp = nextStamp
      pending = null
      setState({ status: 'clean' })
    },

    edit(text) {
      if (file === null) return

      pending = text

      if (state.status === 'conflict') {
        // Keep the conflict visible: writing now would clobber the other program.
        return
      }

      setState({ status: 'dirty' })
      cancelTimer()
      timer = setTimeout(() => {
        timer = null
        void run()
      }, delayMs)
    },

    async close() {
      await flush()

      if (pending !== null) return false

      file = null
      stamp = null
      setState({ status: 'clean' })
      return true
    },

    async overwrite() {
      cancelTimer()
      // Let any write already in progress settle, so the forced write is ours.
      if (inFlight !== null) await inFlight
      await run(true)

      // An edit that lands during the overwrite saves normally from here on.
      if (pending !== null && state.status !== 'conflict' && state.status !== 'error') {
        await run()
      }
    },

    discardPendingText() {
      cancelTimer()
      pending = null
      setState({ status: 'clean' })
    },

    flush,
    getState: () => state,
    hasPendingText: () => pending !== null,

    dispose() {
      cancelTimer()
    },
  }
}
