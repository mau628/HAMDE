import { createAutoSave, type AutoSaveController, type SaveState } from '~/services/autoSave'
import { fileSystemService } from '~/services/fileSystemService'
import { detectLineEnding, fromLf, toLf } from '~/services/lineEndings'
import type { FileNode, OpenDocument } from '~/types/fileSystem'

/**
 * The open document and its save state.
 *
 * One document is open at a time, so the autosave controller is a module-level
 * singleton; this composable is the reactive view of it.
 */

let controller: AutoSaveController | null = null

export function useDocument() {
  const activeDocument = useState<OpenDocument | null>('document:active', () => null)
  const saveState = useState<SaveState>('document:save', () => ({ status: 'clean' }))
  const openError = useState<string | null>('document:openError', () => null)

  function getController(): AutoSaveController {
    if (controller === null) {
      const state = saveState
      const open = activeDocument
      controller = createAutoSave({
        // The editor works in LF; the file gets back the endings it came with.
        // Reading the ending here rather than capturing it at attach time is safe:
        // a document is always closed before another one is opened.
        write: (file, text, expected) =>
          fileSystemService.writeFile(
            file,
            fromLf(text, open.value?.lineEnding ?? '\n'),
            expected,
          ),
        ensurePermission: (file) => fileSystemService.ensureWritePermission(file),
        onState: (next) => {
          state.value = next
        },
      })
    }
    return controller
  }

  /** True while text exists that is not on disk. */
  const hasUnsavedChanges = computed(
    () => saveState.value.status !== 'clean' && activeDocument.value !== null,
  )

  /**
   * Opens a file, saving the current one first.
   *
   * Returns `false` without switching when the open document could not be saved:
   * leaving it behind would discard the user's text.
   */
  async function openDocument(file: FileNode): Promise<boolean> {
    openError.value = null

    if (activeDocument.value !== null) {
      if (!(await getController().close())) return false
    }

    try {
      const { text, stamp } = await fileSystemService.readFile(file)
      activeDocument.value = {
        file,
        text: toLf(text),
        stamp,
        lineEnding: detectLineEnding(text),
      }
      getController().attach(file, stamp)
      return true
    } catch (cause) {
      openError.value = cause instanceof Error ? cause.message : String(cause)
      return false
    }
  }

  /** Records an edit from the editor. Debounced writing happens in the controller. */
  function edit(text: string): void {
    const open = activeDocument.value
    if (open === null) return

    open.text = text
    getController().edit(text)
  }

  /** Writes pending text now, for Ctrl+S and for losing focus. */
  async function saveNow(): Promise<void> {
    if (activeDocument.value === null) return
    await getController().flush()
  }

  /**
   * Resolves a conflict by keeping the version in the editor.
   *
   * Writes the pending text over whatever is on disk. Only reachable from the
   * conflict bar, where the user has been told what the alternative is.
   */
  async function overwriteOnDisk(): Promise<void> {
    if (activeDocument.value === null) return
    await getController().overwrite()
  }

  /**
   * Resolves a conflict by keeping the version on disk.
   *
   * The editor's text is replaced, which CodeMirror records as an undoable change —
   * so Ctrl+Z still brings the discarded text back.
   */
  async function reloadFromDisk(): Promise<void> {
    const open = activeDocument.value
    if (open === null) return

    const controllerRef = getController()
    controllerRef.discardPendingText()

    try {
      const { text, stamp } = await fileSystemService.readFile(open.file)
      // The other program may have changed the line endings too.
      activeDocument.value = {
        file: open.file,
        text: toLf(text),
        stamp,
        lineEnding: detectLineEnding(text),
      }
      controllerRef.attach(open.file, stamp)
    } catch (cause) {
      openError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  /** Closes the document. Returns `false` if its text could not be saved. */
  async function closeDocument(): Promise<boolean> {
    if (activeDocument.value === null) return true
    if (!(await getController().close())) return false

    activeDocument.value = null
    return true
  }

  return {
    activeDocument,
    saveState,
    openError,
    hasUnsavedChanges,
    openDocument,
    closeDocument,
    edit,
    saveNow,
    overwriteOnDisk,
    reloadFromDisk,
  }
}
