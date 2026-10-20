/**
 * An in-memory stand-in for the File System Access API.
 *
 * It implements only what `fileSystemService` actually calls, so the service can be
 * tested — including its write path — without a browser or a real disk.
 */

export interface FakeTree {
  [name: string]: string | FakeTree
}

export interface FakeOptions {
  /** Permission state reported by `queryPermission`. */
  permission?: PermissionState
  /** Whether `requestPermission` grants access when asked. */
  grantOnRequest?: boolean
  /** Throws from `getFile`/`entries` to simulate a read failure. */
  failWith?: Error
}

let clock = 1_000_000

/** Every write advances a shared clock, the way `lastModified` moves on disk. */
function nextTimestamp(): number {
  clock += 1000
  return clock
}

class FakeFile {
  constructor(
    public name: string,
    public contents: Uint8Array,
    public lastModified = nextTimestamp(),
  ) {}

  get size(): number {
    return this.contents.byteLength
  }
}

class FakeWritable {
  private buffer: Uint8Array<ArrayBufferLike>

  constructor(
    private readonly file: FakeFile,
    keepExistingData: boolean,
  ) {
    this.buffer = keepExistingData ? new Uint8Array(file.contents) : new Uint8Array(0)
  }

  async write(
    command: { type: 'write'; position: number; data: Uint8Array } | ArrayBuffer,
  ): Promise<void> {
    if (command instanceof ArrayBuffer) command = { type: 'write', position: 0, data: new Uint8Array(command) }
    const end = command.position + command.data.byteLength
    const next = new Uint8Array(Math.max(this.buffer.byteLength, end))
    next.set(this.buffer)
    next.set(command.data, command.position)
    this.buffer = next
  }

  async truncate(size: number): Promise<void> {
    this.buffer = this.buffer.slice(0, size)
  }

  async close(): Promise<void> {
    this.file.contents = this.buffer
    this.file.lastModified = nextTimestamp()
  }

  async abort(): Promise<void> {
    // Discards the buffer: the file keeps whatever it had.
  }
}

class FakeFileHandle {
  readonly kind = 'file'

  constructor(
    readonly name: string,
    private readonly file: FakeFile,
    private readonly options: FakeOptions,
  ) {}

  async getFile() {
    if (this.options.failWith) throw this.options.failWith
    const file = this.file
    return {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      text: async () => new TextDecoder().decode(file.contents),
      arrayBuffer: async () => file.contents.slice().buffer,
    }
  }

  async createWritable(options?: { keepExistingData?: boolean }) {
    return new FakeWritable(this.file, options?.keepExistingData === true)
  }

  async queryPermission() {
    return this.options.permission ?? 'granted'
  }

  async requestPermission() {
    return this.options.grantOnRequest === false ? 'denied' : 'granted'
  }

  async isSameEntry(other: unknown) {
    return other === this
  }
}

class FakeDirectoryHandle {
  readonly kind = 'directory'

  constructor(
    readonly name: string,
    private readonly tree: FakeTree,
    private readonly options: FakeOptions,
    private readonly files: Map<string, FakeFile>,
  ) {}

  /** Subdirectory handles are cached so their files keep their state across lookups. */
  private readonly directories = new Map<string, FakeDirectoryHandle>()

  private fileHandle(name: string, value: string): FakeFileHandle {
    let file = this.files.get(name)
    if (!file) {
      file = new FakeFile(name, new TextEncoder().encode(value))
      this.files.set(name, file)
    }
    return new FakeFileHandle(name, file, this.options)
  }

  private directoryHandle(name: string, value: FakeTree): FakeDirectoryHandle {
    let directory = this.directories.get(name)
    if (!directory) {
      directory = new FakeDirectoryHandle(name, value, this.options, new Map())
      this.directories.set(name, directory)
    }
    return directory
  }

  async *entries(): AsyncGenerator<[string, FakeFileHandle | FakeDirectoryHandle]> {
    if (this.options.failWith) throw this.options.failWith

    for (const [name, value] of Object.entries(this.tree)) {
      yield [name, typeof value === 'string' ? this.fileHandle(name, value) : this.directoryHandle(name, value)]
    }
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const value = this.tree[name]
    if (value === undefined && options?.create) {
      this.tree[name] = ''
      return this.fileHandle(name, '')
    }
    if (typeof value !== 'string') throw new DOMException('Not a file', 'NotFoundError')
    return this.fileHandle(name, value)
  }

  async getDirectoryHandle(name: string) {
    const value = this.tree[name]
    if (value === undefined || typeof value === 'string') {
      throw new DOMException('Not a directory', 'NotFoundError')
    }
    return this.directoryHandle(name, value)
  }

  async removeEntry(name: string) {
    if (this.tree[name] === undefined) throw new DOMException('Not found', 'NotFoundError')
    delete this.tree[name]
    this.files.delete(name)
    this.directories.delete(name)
  }

  async queryPermission() {
    return this.options.permission ?? 'granted'
  }

  async requestPermission() {
    return this.options.grantOnRequest === false ? 'denied' : 'granted'
  }
}

/** Builds a directory handle for a literal tree: nested objects are folders. */
export function fakeDirectory(name: string, tree: FakeTree, options: FakeOptions = {}) {
  return new FakeDirectoryHandle(name, tree, options, new Map()) as unknown as FileSystemDirectoryHandle
}

/** Builds a single file handle whose content can be inspected afterwards. */
export function fakeFile(name: string, contents: string, options: FakeOptions = {}) {
  const file = new FakeFile(name, new TextEncoder().encode(contents))
  const handle = new FakeFileHandle(name, file, options) as unknown as FileSystemFileHandle

  return {
    handle,
    /** Current bytes on "disk", decoded. */
    read: () => new TextDecoder().decode(file.contents),
    byteLength: () => file.contents.byteLength,
    touch: () => {
      file.lastModified = nextTimestamp()
    },
  }
}
