import { fileSystemService } from '~/services/fileSystemService'
import type { DirectoryNode, FileNode, FileTreeNode, OpenDocument } from '~/types/fileSystem'

export type WorkspaceError =
  | { kind: 'unsupported' }
  | { kind: 'permission-denied' }
  | { kind: 'read-failed'; path: string; message: string }

/**
 * Workspace state: the open folder, which directories are expanded, and the
 * document currently being viewed.
 *
 * Deliberately built on `useState` and plain refs rather than a store: the state is
 * three values, and every mutation goes through the functions below.
 */
export function useWorkspace() {
  const root = useState<DirectoryNode | null>('workspace:root', () => null)
  const activeDocument = useState<OpenDocument | null>('workspace:document', () => null)
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

    busy.value = true
    try {
      const directory = await fileSystemService.pickDirectory()
      if (directory === null) return // user cancelled

      withRawHandle(directory)

      await loadChildren(directory)
      root.value = directory
      expandedPaths.value = [directory.path]
      activeDocument.value = null
    } catch (cause) {
      error.value = toWorkspaceError(cause, '')
    } finally {
      busy.value = false
    }
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

  async function openFile(file: FileNode): Promise<void> {
    error.value = null
    busy.value = true
    try {
      const { text, stamp } = await fileSystemService.readFile(file)
      activeDocument.value = { file, text, stamp }
    } catch (cause) {
      error.value = toWorkspaceError(cause, file.path)
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

  return {
    root,
    activeDocument,
    error: readonly(error),
    busy: readonly(busy),
    isSupported,
    isExpanded,
    openFolder,
    toggleDirectory,
    openFile,
    refresh,
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
