import { fileSystemService, isHiddenEntry, isMarkdownFile } from '~/services/fileSystemService'
import { releaseImages } from '~/services/imageService'
import { isSameFile, type DirectoryNode, type FileNode, type FileTreeNode } from '~/types/fileSystem'

export type WorkspaceError =
  | { kind: 'unsupported' }
  | { kind: 'permission-denied' }
  /** Something other than a Markdown file was dropped onto the app. */
  | { kind: 'not-markdown'; names: string[] }
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
  /**
   * Files dropped onto the app that are not part of the open folder, in the order
   * they arrived. Listed apart from the tree; forgotten on reload.
   */
  const externalFiles = useState<FileNode[]>('workspace:external', () => [])

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
    if (!(await closeWorkspaceDocument())) return

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
    // A file dropped while permission was being asked for is the one the user wants.
    if (first !== undefined && openDocuments.activeDocument.value === null) {
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
    if (!(await closeWorkspaceDocument())) return

    releaseImages()
    root.value = null
    expandedPaths.value = []
    error.value = null
    await fileSystemService.forgetDirectory()
  }

  /**
   * Closes the open document if it belongs to the folder. A dropped file is not
   * part of any folder, so it stays open when the folder changes.
   */
  async function closeWorkspaceDocument(): Promise<boolean> {
    if (openDocuments.activeDocument.value?.file.externalId !== undefined) return true
    return openDocuments.closeDocument()
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

    const fileName = toMarkdownFileName(rawName)
    if (fileName === null) return

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

  /**
   * Validates a name typed by the user and gives it a Markdown extension if it has
   * none. Resolves to `null`, with the error set, when the name is not usable.
   */
  function toMarkdownFileName(rawName: string): string | null {
    const name = rawName.trim()
    if (name === '' || /[\\/:*?"<>|]/.test(name) || isHiddenEntry(name)) {
      error.value = { kind: 'read-failed', path: name, message: 'Invalid file name' }
      return null
    }
    return isMarkdownFile(name) ? name : `${name}.md`
  }

  /**
   * Renames a file in place, keeping it open if it was the open document.
   *
   * Appends `.md` when the new name has no Markdown extension. `confirm` is asked
   * with that final name, and nothing happens unless it agrees. The open document
   * is saved first; if that fails the file keeps its name.
   */
  async function renameFile(
    file: FileNode,
    rawName: string,
    confirm: (fileName: string) => boolean,
  ): Promise<void> {
    if (root.value === null) return

    error.value = null
    const fileName = toMarkdownFileName(rawName)
    if (fileName === null || fileName === file.name || !confirm(fileName)) return

    const active = openDocuments.activeDocument.value
    const wasOpen = active !== null && isSameFile(active.file, file)
    if (wasOpen && !(await openDocuments.closeDocument())) return

    error.value = null
    busy.value = true
    try {
      const renamed = await fileSystemService.renameFile(root.value, file, fileName)
      if (renamed === null) {
        // Reopening clears the error, so it is set afterwards.
        if (wasOpen) await openFile(file)
        error.value = { kind: 'read-failed', path: fileName, message: 'A file with that name already exists' }
        return
      }
      withRawHandle(renamed)
      await refresh()
      if (wasOpen) await openFile(renamed)
    } catch (cause) {
      error.value = toWorkspaceError(cause, file.path)
      await refresh()
    } finally {
      busy.value = false
    }
  }

  /** Deletes a file from disk, closing it first if it is the open document. */
  async function deleteFile(file: FileNode): Promise<void> {
    if (root.value === null) return

    const active = openDocuments.activeDocument.value
    if (active !== null && isSameFile(active.file, file)) {
      await openDocuments.discardDocument()
    }

    error.value = null
    busy.value = true
    try {
      await fileSystemService.deleteFile(root.value, file)
      await refresh()
    } catch (cause) {
      error.value = toWorkspaceError(cause, file.path)
    } finally {
      busy.value = false
    }
  }

  /**
   * Opens the Markdown files dropped onto the app, the first one in the editor.
   *
   * Call it from the `drop` handler itself, not after an await: the browser hands
   * over the files only while that event is being handled. A file that lives in the
   * open folder opens as part of it; any other is listed under the tree, apart.
   */
  async function openDroppedFiles(transfer: DataTransfer): Promise<void> {
    // Started before anything is awaited, for the reason above.
    const dropping = fileSystemService.filesFromDrop(transfer)
    error.value = null

    let dropped
    try {
      dropped = await dropping
    } catch (cause) {
      error.value = toWorkspaceError(cause, '')
      return
    }

    let first: FileNode | null = null
    for (const file of dropped.files) {
      withRawHandle(file)
      const node = (await findInWorkspace(file)) ?? (await addExternalFile(file))
      first ??= node
    }

    if (first !== null) await openFile(first)
    // Reported after opening, which clears the error.
    if (dropped.rejected.length > 0 && error.value === null) {
      error.value = { kind: 'not-markdown', names: dropped.rejected }
    }
  }

  /**
   * The tree's node for a dropped file that lives in the open folder, with the
   * directories leading to it expanded. `null` when it lives elsewhere, or somewhere
   * the tree does not show, such as a hidden folder.
   */
  async function findInWorkspace(file: FileNode): Promise<FileNode | null> {
    const directory = root.value
    if (directory === null) return null

    const segments = await fileSystemService.locateInDirectory(directory, file)
    if (segments === null || segments.length === 0) return null

    try {
      let current = directory
      const opened: string[] = []
      for (const segment of segments.slice(0, -1)) {
        await loadChildren(current)
        const next = current.children?.find(
          (child): child is DirectoryNode => child.kind === 'directory' && child.name === segment,
        )
        if (next === undefined) return null
        opened.push(next.path)
        current = next
      }
      await loadChildren(current)
      const node = current.children?.find(
        (child): child is FileNode => child.kind === 'file' && child.name === segments.at(-1),
      )
      if (node === undefined) return null

      expandedPaths.value = [...new Set([...expandedPaths.value, ...opened])]
      return node
    } catch {
      return null
    }
  }

  /** Lists a dropped file apart from the tree, once: dropping it again finds the first. */
  async function addExternalFile(file: FileNode): Promise<FileNode> {
    for (const known of externalFiles.value) {
      if (await fileSystemService.isSameEntry(known, file)) return known
    }
    externalFiles.value = [...externalFiles.value, file]
    return file
  }

  /** Takes a dropped file off the list, saving and closing it first if it is open. */
  async function closeExternalFile(file: FileNode): Promise<void> {
    const active = openDocuments.activeDocument.value
    if (active !== null && isSameFile(active.file, file)) {
      if (!(await openDocuments.closeDocument())) return
    }
    externalFiles.value = externalFiles.value.filter((known) => !isSameFile(known, file))
  }

  return {
    root,
    externalFiles,
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
    renameFile,
    deleteFile,
    openDroppedFiles,
    closeExternalFile,
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
