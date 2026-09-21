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

function stampOf(file: File): FileStamp {
  return { lastModified: file.lastModified, size: file.size }
}

function sameStamp(a: FileStamp, b: FileStamp): boolean {
  return a.lastModified === b.lastModified && a.size === b.size
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
      try {
        await directory.handle.getFileHandle(name)
        return null // already exists; never overwrite
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
      }

      const handle = await directory.handle.getFileHandle(name, { create: true })
      return { kind: 'file', name, path: joinPath(directory.path, name), handle }
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
