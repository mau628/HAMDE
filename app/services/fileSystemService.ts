import type {
  DirectoryNode,
  FileNode,
  FileStamp,
  FileSystemService,
  FileTreeNode,
  WriteResult,
} from '~/types/fileSystem'

/**
 * The only module in the app that talks to the File System Access API.
 *
 * Everything else works with the node types from `~/types/fileSystem`, which keeps
 * handles, writable streams and permission prompts in one auditable place and makes
 * the rest of the app testable without a browser.
 */

const MARKDOWN_EXTENSIONS = ['.md', '.markdown']

/** Markdown files are the only files the explorer shows. */
export function isMarkdownFile(name: string): boolean {
  const lower = name.toLowerCase()
  return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/**
 * Entries starting with a dot are skipped: `.git`, `.obsidian` and friends are not
 * the user's notes, and walking them wastes time on large folders.
 */
export function isHiddenEntry(name: string): boolean {
  return name.startsWith('.')
}

/** Directories first, then files, each alphabetically and case-insensitively. */
export function sortTreeNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  })
}

function joinPath(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`
}

/** The directory a workspace-relative path lives in, walked down from the root. */
async function parentHandleOf(root: DirectoryNode, path: string): Promise<FileSystemDirectoryHandle> {
  const segments = path.split('/').filter((segment) => segment !== '')
  segments.pop()

  let current = root.handle
  for (const segment of segments) current = await current.getDirectoryHandle(segment)
  return current
}

async function exists(directory: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await directory.getFileHandle(name)
    return true
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return false
    throw error
  }
}

/** Copies a file within `directory` under a new name, then removes the original. */
async function copyAndRemove(
  directory: FileSystemDirectoryHandle,
  source: { handle: FileSystemFileHandle; name: string },
  name: string,
): Promise<FileSystemFileHandle> {
  const bytes = await (await source.handle.getFile()).arrayBuffer()
  const handle = await directory.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(bytes)
  } catch (error) {
    await writable.abort?.()
    throw error
  }
  await writable.close()
  await directory.removeEntry(source.name)
  return handle
}

function stampOf(file: File): FileStamp {
  return { lastModified: file.lastModified, size: file.size }
}

function sameStamp(a: FileStamp, b: FileStamp): boolean {
  return a.lastModified === b.lastModified && a.size === b.size
}

const DATABASE = 'hamde'
const STORE = 'handles'
const LAST_FOLDER_KEY = 'lastFolder'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function runOnStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(database.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

export function createFileSystemService(): FileSystemService {
  return {
    isSupported() {
      return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
    },

    async pickDirectory() {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
        return { kind: 'directory', name: handle.name, path: '', handle, children: null }
      } catch (error) {
        // The user dismissing the picker is a normal outcome, not a failure.
        if (error instanceof DOMException && error.name === 'AbortError') return null
        throw error
      }
    },

    async rememberDirectory(directory: DirectoryNode) {
      // Remembering is a convenience: a blocked or full store must not surface.
      try {
        await runOnStore('readwrite', (store) => store.put(directory.handle, LAST_FOLDER_KEY))
      } catch {
        // ignore
      }
    },

    async forgetDirectory() {
      try {
        await runOnStore('readwrite', (store) => store.delete(LAST_FOLDER_KEY))
      } catch {
        // ignore
      }
    },

    async recallDirectory(options) {
      try {
        const handle = await runOnStore<unknown>('readonly', (store) => store.get(LAST_FOLDER_KEY))
        if (!(handle instanceof FileSystemDirectoryHandle)) return null

        const descriptor: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' }
        let permission = await handle.queryPermission(descriptor)
        // Prompting needs a user gesture, so only the caller that is inside one may ask.
        if (permission === 'prompt' && options.prompt) {
          permission = await handle.requestPermission(descriptor)
        }
        if (permission !== 'granted') return null

        return { kind: 'directory', name: handle.name, path: '', handle, children: null }
      } catch {
        return null
      }
    },

    async listChildren(directory: DirectoryNode) {
      const children: FileTreeNode[] = []

      for await (const [name, handle] of directory.handle.entries()) {
        if (isHiddenEntry(name)) continue

        if (handle.kind === 'directory') {
          children.push({
            kind: 'directory',
            name,
            path: joinPath(directory.path, name),
            handle,
            children: null,
          })
        } else if (isMarkdownFile(name)) {
          children.push({ kind: 'file', name, path: joinPath(directory.path, name), handle })
        }
      }

      return sortTreeNodes(children)
    },

    async readFile(file: FileNode) {
      const blob = await file.handle.getFile()
      // Read as UTF-8 and leave the bytes otherwise untouched: line endings included,
      // because writing back must not rewrite them.
      return { text: await blob.text(), stamp: stampOf(blob) }
    },

    async statFile(file: FileNode) {
      return stampOf(await file.handle.getFile())
    },

    async writeFile(file: FileNode, text: string, expected: FileStamp | null): Promise<WriteResult> {
      const current = stampOf(await file.handle.getFile())
      if (expected !== null && !sameStamp(current, expected)) {
        return { ok: false, reason: 'conflict', current }
      }

      const bytes = new TextEncoder().encode(text)

      // `keepExistingData: true` means the file is not truncated when the stream
      // opens. If the process dies mid-write the file keeps its old tail instead of
      // becoming empty; the explicit truncate below trims it to the new length.
      const writable = await file.handle.createWritable({ keepExistingData: true })
      try {
        await writable.write({ type: 'write', position: 0, data: bytes })
        await writable.truncate(bytes.byteLength)
      } catch (error) {
        await writable.abort?.()
        throw error
      }
      await writable.close()

      return { ok: true, stamp: stampOf(await file.handle.getFile()) }
    },

    async readFileAtPath(directory: DirectoryNode, path: string) {
      const segments = path.split('/').filter((segment) => segment !== '')
      const name = segments.pop()
      if (name === undefined) return null

      try {
        let current = directory.handle
        for (const segment of segments) current = await current.getDirectoryHandle(segment)

        return await (await current.getFileHandle(name)).getFile()
      } catch {
        // Missing file, missing folder, or permission withdrawn: all the same to
        // the caller, which simply does not render anything.
        return null
      }
    },

    async createFile(directory: DirectoryNode, name: string) {
      if (await exists(directory.handle, name)) return null // never overwrite

      const handle = await directory.handle.getFileHandle(name, { create: true })
      return { kind: 'file', name, path: joinPath(directory.path, name), handle }
    },

    async renameFile(root: DirectoryNode, file: FileNode, name: string) {
      if (name === file.name) return file

      const parent = await parentHandleOf(root, file.path)
      const path = file.path.slice(0, file.path.length - file.name.length) + name
      // On a case-insensitive disk a case-only rename finds the file itself.
      const caseOnly = name.toLowerCase() === file.name.toLowerCase()
      if (!caseOnly && (await exists(parent, name))) return null

      // `move` renames in place where the browser has it.
      const movable = file.handle as FileSystemFileHandle & { move?: (name: string) => Promise<void> }
      if (typeof movable.move === 'function') {
        await movable.move(name)
        return { kind: 'file', name, path, handle: file.handle }
      }

      // Elsewhere the file is copied and the original removed only once the copy is
      // closed, so a failure part way leaves the original intact. A case-only rename
      // goes through a temporary name: copying onto the same file would destroy it.
      let source = { handle: file.handle, name: file.name }
      if (caseOnly) {
        const temporary = `.${name}.${Date.now()}.tmp`
        source = { handle: await copyAndRemove(parent, source, temporary), name: temporary }
      }
      const handle = await copyAndRemove(parent, source, name)

      return { kind: 'file', name, path, handle }
    },

    async deleteFile(root: DirectoryNode, file: FileNode) {
      await (await parentHandleOf(root, file.path)).removeEntry(file.name)
    },

    async ensureWritePermission(node: FileTreeNode) {
      const descriptor: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' }

      if ((await node.handle.queryPermission(descriptor)) === 'granted') return true
      // Chrome only prompts from a user gesture; outside one this resolves to 'denied'
      // rather than throwing, which the caller surfaces as a save error.
      return (await node.handle.requestPermission(descriptor)) === 'granted'
    },
  }
}

export const fileSystemService = createFileSystemService()
