import type { LineEnding } from '~/services/lineEndings'

/**
 * The workspace model the rest of the app works with.
 *
 * Browser file handles live on these nodes, but only `services/fileSystemService.ts`
 * is allowed to touch them — see tests/unit/architecture.spec.ts, which fails if any
 * other module reaches for the File System Access API.
 */

/** Cheap identity of a file's content on disk, used to detect external edits. */
export interface FileStamp {
  lastModified: number
  size: number
}

export interface FileNode {
  kind: 'file'
  name: string
  /** Slash-separated path relative to the workspace root, for display and keys. */
  path: string
  handle: FileSystemFileHandle
}

export interface DirectoryNode {
  kind: 'directory'
  name: string
  path: string
  handle: FileSystemDirectoryHandle
  /** `null` until the directory is expanded: children are read on demand. */
  children: FileTreeNode[] | null
}

export type FileTreeNode = FileNode | DirectoryNode

/** An open document, with the stamp it had when it was read. */
export interface OpenDocument {
  file: FileNode
  /** Always with LF endings: the editor works in that form. */
  text: string
  stamp: FileStamp
  /** What the file on disk uses, so writing it back does not rewrite every line. */
  lineEnding: LineEnding
}

export type WriteResult =
  | { ok: true; stamp: FileStamp }
  /** The file changed on disk since `expected`; nothing was written. */
  | { ok: false; reason: 'conflict'; current: FileStamp }

export interface FileSystemService {
  /** Whether this browser can open local folders at all. */
  isSupported(): boolean
  /** Prompts for a folder. Resolves to `null` if the user cancels. */
  pickDirectory(): Promise<DirectoryNode | null>
  /** Stores the folder so the next page load can reopen it. Never throws. */
  rememberDirectory(directory: DirectoryNode): Promise<void>
  /** Drops the stored folder. Never throws. */
  forgetDirectory(): Promise<void>
  /**
   * The stored folder, if it can be used without prompting; otherwise `null`.
   * Never throws.
   */
  recallDirectory(): Promise<DirectoryNode | null>
  /** Reads one level: subdirectories and Markdown files, sorted for display. */
  listChildren(directory: DirectoryNode): Promise<FileTreeNode[]>
  readFile(file: FileNode): Promise<{ text: string; stamp: FileStamp }>
  statFile(file: FileNode): Promise<FileStamp>
  /**
   * Writes `text`, but only if the file still matches `expected`.
   *
   * Pass `null` to write unconditionally. This is the single place in the app where
   * a file is overwritten, which is why conflict detection is part of its contract
   * rather than something layered on later.
   */
  writeFile(file: FileNode, text: string, expected: FileStamp | null): Promise<WriteResult>
  /**
   * Creates an empty file directly inside `directory`.
   *
   * Never overwrites: resolves to `null` if a file with that name already exists.
   */
  createFile(directory: DirectoryNode, name: string): Promise<FileNode | null>
  /** Ensures write permission is still granted, prompting if the browser allows. */
  ensureWritePermission(node: FileTreeNode): Promise<boolean>
  /**
   * Reads any file inside the workspace by its relative path.
   *
   * For images, which are referenced by path from a document rather than picked
   * from the tree. Resolves to `null` when the path does not lead to a file.
   */
  readFileAtPath(directory: DirectoryNode, path: string): Promise<File | null>
}
