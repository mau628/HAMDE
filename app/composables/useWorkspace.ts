import { fileSystemService, isHiddenEntry, isMarkdownFile } from '~/services/fileSystemService'
import { releaseImages } from '~/services/imageService'
import type { DirectoryNode, FileNode, FileTreeNode } from '~/types/fileSystem'

export type WorkspaceError =
  | { kind: 'unsupported' }
  | { kind: 'permission-denied' }
  | { kind: 'read-failed'; path: string; message: string }

/**
 * Workspace state: the open folder and which directories are expanded.
 *
 * The open document and its save state live in `useDocument`.
 *
 * Deliberately built on `useState` and plain refs rather than a store: the state is
 * three values, and every mutation goes through the functions below.
 */
export function useWorkspace() {
  // Resolved here, at setup time, rather than inside the async functions below:
  // composables must not be called after an await.
  const openDocuments = useDocument()

  const root = useState<DirectoryNode | null>('workspace:root', () => null)
  const error = useState<WorkspaceError | null>('workspace:error', () => null)
  /** Paths of the directories the user has expanded. View state, not file state. */
  const expandedPaths = useState<string[]>('workspace:expanded', () => [])
  const busy = useState<boolean>('workspace:busy', () => false)

  const isSupported = computed(() => fileSystemService.isSupported())

  /**
   * Keeps browser handles out of Vue's reactive proxies.
   *
   * A proxied FileSystemFileHandle is a different object than the one Chrome
   * handed us, and passing it back into the API is asking for trouble. The tree
   * around it stays reactive; only the handle is opaque.
   */
  function withRawHandle<T extends FileTreeNode>(node: T): T {
    markRaw(node.handle)
    return node
  }

  function isExpanded(path: string): boolean {
    return expandedPaths.value.includes(path)
  }

  /** Loads a directory's children the first time it is expanded. */
  async function loadChildren(directory: DirectoryNode): Promise<void> {
    if (directory.children !== null) return
    directory.children = (await fileSystemService.listChildren(directory)).map(withRawHandle)
  }

  async function openFolder(): Promise<void> {
    error.value = null

    if (!fileSystemService.isSupported()) {
      error.value = { kind: 'unsupported' }
      return
    }

    // Leaving a folder abandons the open document, so it has to be saved first.
    if (!(await openDocuments.closeDocument())) return

    busy.value = true
    try {
      const directory = await fileSystemService.pickDirectory()
      if (directory === null) return // user cancelled

      // Object URLs belong to the folder that was open; the new one starts clean.
      releaseImages()
      withRawHandle(directory)

      await loadChildren(directory)
      root.value = directory
      expandedPaths.value = [directory.path]
      void fileSystemService.rememberDirectory(directory)
    } catch (cause) {
      error.value = toWorkspaceError(cause, '')
    } finally {
      busy.value = false
    }
  }

  /**
   * Reopens the folder from the previous session, silently.
   *
   * Any failure — nothing remembered, folder deleted or moved, permission refused —
   * leaves the app on its default document with no message.
   *
   * Chrome usually drops the folder's permission on reload, and asking for it back
   * needs a user gesture. So when it cannot be had silently, the first click or key
   * press in the page asks for it, and only that one time.
   */
  async function restoreLastFolder(): Promise<void> {
    if (root.value !== null || !fileSystemService.isSupported()) return

    if (await restoreFrom(await fileSystemService.recallDirectory({ prompt: false }))) return

    const onGesture = (event: Event) => {
      // The Open Folder button has its own picker; do not stack a prompt on it.
      if (event.target instanceof Element && event.target.closest('.shell__open')) return
      stop()
      if (root.value !== null) return
      void fileSystemService
        .recallDirectory({ prompt: true })
        .then((directory) => restoreFrom(directory))
    }
    const stop = () => {
      window.removeEventListener('pointerdown', onGesture, true)
      window.removeEventListener('keydown', onGesture, true)
    }
    window.addEventListener('pointerdown', onGesture, true)
    window.addEventListener('keydown', onGesture, true)
  }

  /** Opens a recalled folder and its first file. Resolves to whether it was opened. */
  async function restoreFrom(recalled: DirectoryNode | null): Promise<boolean> {
    if (recalled === null) return false

    try {
      const directory = withRawHandle(recalled)
      await loadChildren(directory)
      // The user may have opened a folder themselves while this was resolving.
      if (root.value !== null) return true
      root.value = directory
      expandedPaths.value = [directory.path]
    } catch {
      await fileSystemService.forgetDirectory()
      return false
    }

    // The first file in the explorer's order. Directories sort first, so this is
    // the first file among the root's children, not necessarily the first row.
    const first = recalled.children?.find((child): child is FileNode => child.kind === 'file')
    if (first !== undefined) {
      await openFile(first)
      // Nobody asked for this file, so a failure to read it is not worth a message.
      error.value = null
    }
    return true
  }

  /**
   * Closes the open folder, which brings back the default document.
   *
   * The folder is also forgotten, so the next page load does not reopen it. Unsaved
   * changes are saved first; if that fails the folder stays open.
   */
  async function closeFolder(): Promise<void> {
    if (root.value === null) return
    if (!(await openDocuments.closeDocument())) return

    releaseImages()
    root.value = null
    expandedPaths.value = []
    error.value = null
    await fileSystemService.forgetDirectory()
  }

  async function toggleDirectory(directory: DirectoryNode): Promise<void> {
    if (isExpanded(directory.path)) {
      expandedPaths.value = expandedPaths.value.filter((path) => path !== directory.path)
      return
    }

    try {
      await loadChildren(directory)
      expandedPaths.value = [...expandedPaths.value, directory.path]
    } catch (cause) {
      error.value = toWorkspaceError(cause, directory.path)
    }
  }

  /**
   * Opens a file in the editor.
   *
   * The document layer owns reading and saving; this only reports a read failure in
   * the explorer, next to the file the user clicked.
   */
  async function openFile(file: FileNode): Promise<void> {
    error.value = null
    busy.value = true
    try {
      await openDocuments.openDocument(file)
      const failure = openDocuments.openError.value
      if (failure !== null) error.value = { kind: 'read-failed', path: file.path, message: failure }
    } finally {
      busy.value = false
    }
  }

  /** Re-reads the tree from disk, keeping which directories are expanded. */
  async function refresh(): Promise<void> {
    if (root.value === null) return

    const reload = async (directory: DirectoryNode): Promise<void> => {
      directory.children = (await fileSystemService.listChildren(directory)).map(withRawHandle)
      await Promise.all(
        directory.children
          .filter((child): child is DirectoryNode => child.kind === 'directory')
          .filter((child) => isExpanded(child.path))
          .map(reload),
      )
    }

    busy.value = true
    try {
      await reload(root.value)
    } catch (cause) {
      error.value = toWorkspaceError(cause, root.value.path)
    } finally {
      busy.value = false
    }
  }

  /**
   * Creates an empty Markdown file in the workspace root and opens it.
   *
   * Appends `.md` when the name has no Markdown extension.
   */
  async function createFile(rawName: string): Promise<void> {
    if (root.value === null) return

    const name = rawName.trim()
    if (name === '' || /[\\/:*?"<>|]/.test(name) || isHiddenEntry(name)) {
      error.value = { kind: 'read-failed', path: name, message: 'Invalid file name' }
      return
    }
    const fileName = isMarkdownFile(name) ? name : `${name}.md`

    error.value = null
    busy.value = true
    try {
      const file = await fileSystemService.createFile(root.value, fileName)
      if (file === null) {
        error.value = { kind: 'read-failed', path: fileName, message: 'A file with that name already exists' }
        return
      }
      withRawHandle(file)
      await refresh()
      await openFile(file)
    } catch (cause) {
      error.value = toWorkspaceError(cause, fileName)
    } finally {
      busy.value = false
    }
  }

  return {
    root,
    error: readonly(error),
    busy: readonly(busy),
    isSupported,
    isExpanded,
    openFolder,
    restoreLastFolder,
    closeFolder,
    toggleDirectory,
    openFile,
    refresh,
    createFile,
  }
}

function toWorkspaceError(cause: unknown, path: string): WorkspaceError {
  if (cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'SecurityError')) {
    return { kind: 'permission-denied' }
  }
  return {
    kind: 'read-failed',
    path,
    message: cause instanceof Error ? cause.message : String(cause),
  }
}
