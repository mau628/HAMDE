import { describe, expect, it } from 'vitest'

import {
  createFileSystemService,
  isHiddenEntry,
  isMarkdownFile,
  sortTreeNodes,
} from '../../app/services/fileSystemService'
import type { DirectoryNode, FileNode, FileTreeNode } from '../../app/types/fileSystem'
import { fakeDirectory, fakeFile } from '../support/fakeFileSystem'

const service = createFileSystemService()

function rootNode(handle: FileSystemDirectoryHandle): DirectoryNode {
  return { kind: 'directory', name: handle.name, path: '', handle, children: null }
}

function fileNode(handle: FileSystemFileHandle, path = handle.name): FileNode {
  return { kind: 'file', name: handle.name, path, handle }
}

describe('file filtering', () => {
  it('recognises Markdown extensions, case-insensitively', () => {
    expect(isMarkdownFile('notes.md')).toBe(true)
    expect(isMarkdownFile('NOTES.MD')).toBe(true)
    expect(isMarkdownFile('notes.markdown')).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isMarkdownFile('image.png')).toBe(false)
    expect(isMarkdownFile('notes.md.bak')).toBe(false)
    expect(isMarkdownFile('md')).toBe(false)
  })

  it('treats dot-entries as hidden, so .git and .obsidian are skipped', () => {
    expect(isHiddenEntry('.git')).toBe(true)
    expect(isHiddenEntry('.obsidian')).toBe(true)
    expect(isHiddenEntry('notes.md')).toBe(false)
  })
})

describe('sortTreeNodes', () => {
  const node = (kind: 'file' | 'directory', name: string) => ({ kind, name, path: name }) as FileTreeNode

  it('puts directories before files', () => {
    const sorted = sortTreeNodes([node('file', 'a.md'), node('directory', 'z')])
    expect(sorted.map((entry) => entry.name)).toEqual(['z', 'a.md'])
  })

  it('sorts alphabetically, ignoring case', () => {
    const sorted = sortTreeNodes([node('file', 'b.md'), node('file', 'A.md')])
    expect(sorted.map((entry) => entry.name)).toEqual(['A.md', 'b.md'])
  })

  it('orders numbered files the way a human would', () => {
    const sorted = sortTreeNodes([node('file', '10.md'), node('file', '2.md')])
    expect(sorted.map((entry) => entry.name)).toEqual(['2.md', '10.md'])
  })

  it('does not mutate its input', () => {
    const input = [node('file', 'b.md'), node('file', 'a.md')]
    sortTreeNodes(input)
    expect(input.map((entry) => entry.name)).toEqual(['b.md', 'a.md'])
  })
})

describe('listChildren', () => {
  it('lists Markdown files and subdirectories, and nothing else', async () => {
    const handle = fakeDirectory('notes', {
      'README.md': '# Readme',
      'photo.png': 'binary',
      'todo.txt': 'not markdown',
      Projects: { 'api.md': '# API' },
      '.git': { config: 'ignored' },
    })

    const children = await service.listChildren(rootNode(handle))

    expect(children.map((child) => child.kind + ':' + child.name)).toEqual([
      'directory:Projects',
      'file:README.md',
    ])
  })

  it('builds paths relative to the workspace root', async () => {
    const handle = fakeDirectory('notes', { Projects: { 'api.md': '# API' } })

    const [projects] = await service.listChildren(rootNode(handle))
    const grandchildren = await service.listChildren(projects as DirectoryNode)

    expect(projects!.path).toBe('Projects')
    expect(grandchildren[0]!.path).toBe('Projects/api.md')
  })

  it('reads one level only, so opening a folder never walks the whole tree', async () => {
    const handle = fakeDirectory('notes', { Deep: { Deeper: { 'note.md': '# Note' } } })

    const [deep] = await service.listChildren(rootNode(handle))

    // Children of Deep are unread: null means "not loaded yet", not "empty".
    expect((deep as DirectoryNode).children).toBeNull()
  })

  it('returns an empty list for an empty directory', async () => {
    expect(await service.listChildren(rootNode(fakeDirectory('empty', {})))).toEqual([])
  })

  it('propagates read failures instead of pretending the folder is empty', async () => {
    const handle = fakeDirectory('notes', { 'a.md': 'x' }, { failWith: new Error('EIO') })
    await expect(service.listChildren(rootNode(handle))).rejects.toThrow('EIO')
  })
})

describe('readFile', () => {
  it('returns the text with the stamp it had when read', async () => {
    const file = fakeFile('note.md', '# Hello')

    const { text, stamp } = await service.readFile(fileNode(file.handle))

    expect(text).toBe('# Hello')
    expect(stamp.size).toBe(7)
    expect(stamp.lastModified).toBeGreaterThan(0)
  })

  it('preserves CRLF line endings exactly', async () => {
    const file = fakeFile('note.md', 'one\r\ntwo\r\n')
    const { text } = await service.readFile(fileNode(file.handle))
    expect(text).toBe('one\r\ntwo\r\n')
  })

  it('decodes multi-byte characters and reports byte size, not character count', async () => {
    const file = fakeFile('note.md', 'café ✓')
    const { text, stamp } = await service.readFile(fileNode(file.handle))

    expect(text).toBe('café ✓')
    expect(stamp.size).toBeGreaterThan(text.length)
  })
})

describe('writeFile', () => {
  it('writes the text to disk', async () => {
    const file = fakeFile('note.md', 'old')

    const result = await service.writeFile(fileNode(file.handle), 'new text', null)

    expect(result.ok).toBe(true)
    expect(file.read()).toBe('new text')
  })

  it('truncates when the new text is shorter, leaving no tail behind', async () => {
    const file = fakeFile('note.md', 'a very long original document')

    await service.writeFile(fileNode(file.handle), 'short', null)

    expect(file.read()).toBe('short')
    expect(file.byteLength()).toBe(5)
  })

  it('writes the expected number of bytes for multi-byte text', async () => {
    const file = fakeFile('note.md', '')

    await service.writeFile(fileNode(file.handle), 'café', null)

    expect(file.read()).toBe('café')
    expect(file.byteLength()).toBe(5) // the accented character takes two bytes
  })

  it('refuses to write when the file changed on disk, and leaves it untouched', async () => {
    const file = fakeFile('note.md', 'original')
    const node = fileNode(file.handle)
    const { stamp } = await service.readFile(node)

    file.touch() // another program saved the file

    const result = await service.writeFile(node, 'ours', stamp)

    expect(result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(file.read()).toBe('original')
  })

  it('writes when the stamp still matches', async () => {
    const file = fakeFile('note.md', 'original')
    const node = fileNode(file.handle)
    const { stamp } = await service.readFile(node)

    const result = await service.writeFile(node, 'ours', stamp)

    expect(result.ok).toBe(true)
    expect(file.read()).toBe('ours')
  })

  it('returns a stamp that matches what was just written, so the next write is clean', async () => {
    const file = fakeFile('note.md', 'original')
    const node = fileNode(file.handle)

    const first = await service.writeFile(node, 'one', null)
    expect(first.ok).toBe(true)

    const second = await service.writeFile(node, 'two', first.ok ? first.stamp : null)

    expect(second.ok).toBe(true)
    expect(file.read()).toBe('two')
  })
})

describe('ensureWritePermission', () => {
  it('passes when permission is already granted', async () => {
    const file = fakeFile('note.md', 'x', { permission: 'granted' })
    expect(await service.ensureWritePermission(fileNode(file.handle))).toBe(true)
  })

  it('asks when permission is only prompted for', async () => {
    const file = fakeFile('note.md', 'x', { permission: 'prompt', grantOnRequest: true })
    expect(await service.ensureWritePermission(fileNode(file.handle))).toBe(true)
  })

  it('reports failure when the request is denied', async () => {
    const file = fakeFile('note.md', 'x', { permission: 'prompt', grantOnRequest: false })
    expect(await service.ensureWritePermission(fileNode(file.handle))).toBe(false)
  })
})

describe('renameFile', () => {
  async function fileIn(root: DirectoryNode, path: string): Promise<FileNode> {
    let directory = root
    const segments = path.split('/')
    for (const segment of segments.slice(0, -1)) {
      const children = await service.listChildren(directory)
      directory = children.find((child) => child.name === segment) as DirectoryNode
    }
    const children = await service.listChildren(directory)
    return children.find((child) => child.path === path) as FileNode
  }

  it('renames a nested file and keeps its content', async () => {
    const tree = { Projects: { 'api.md': '# API', 'other.md': 'x' } }
    const root = rootNode(fakeDirectory('notes', tree))

    const renamed = await service.renameFile(root, await fileIn(root, 'Projects/api.md'), 'endpoints.md')

    expect(renamed).toMatchObject({ name: 'endpoints.md', path: 'Projects/endpoints.md' })
    expect(Object.keys(tree.Projects).sort()).toEqual(['endpoints.md', 'other.md'])
    expect((await service.readFile(renamed!)).text).toBe('# API')
  })

  it('refuses to overwrite an existing file, and leaves both untouched', async () => {
    const tree = { 'a.md': 'first', 'b.md': 'second' }
    const root = rootNode(fakeDirectory('notes', tree))

    expect(await service.renameFile(root, await fileIn(root, 'a.md'), 'b.md')).toBeNull()

    expect(Object.keys(tree).sort()).toEqual(['a.md', 'b.md'])
    expect((await service.readFile(await fileIn(root, 'b.md'))).text).toBe('second')
  })

  it('changes only the case of a name without losing the file', async () => {
    const tree = { 'note.md': 'kept' }
    const root = rootNode(fakeDirectory('notes', tree))

    const renamed = await service.renameFile(root, await fileIn(root, 'note.md'), 'Note.md')

    expect(Object.keys(tree)).toEqual(['Note.md'])
    expect((await service.readFile(renamed!)).text).toBe('kept')
  })
})

describe('deleteFile', () => {
  it('removes a nested file and nothing else', async () => {
    const tree = { 'keep.md': 'x', Projects: { 'api.md': '# API', 'todo.md': '# Todo' } }
    const root = rootNode(fakeDirectory('notes', tree))
    const [projects] = await service.listChildren(root)
    const [api] = await service.listChildren(projects as DirectoryNode)

    await service.deleteFile(root, api as FileNode)

    expect(Object.keys(tree.Projects)).toEqual(['todo.md'])
    expect(Object.keys(tree).sort()).toEqual(['Projects', 'keep.md'])
  })
})

describe('filesFromDrop', () => {
  /** A drop as Chromium hands it over: items that each resolve to a handle. */
  function transfer(...handles: (FileSystemHandle | null)[]): DataTransfer {
    const items = handles.map((handle) => ({
      kind: 'file',
      getAsFileSystemHandle: async () => handle,
    }))
    return { items } as unknown as DataTransfer
  }

  const directory = (name: string) => fakeDirectory(name, {}) as unknown as FileSystemHandle

  it('keeps the Markdown files, marked as outside the workspace', async () => {
    const { handle } = fakeFile('notes.md', '# Notes\n')
    const { files, rejected } = await service.filesFromDrop(transfer(handle))

    expect(rejected).toEqual([])
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ kind: 'file', name: 'notes.md', path: 'notes.md' })
    expect(files[0]!.externalId).toEqual(expect.any(Number))
  })

  it('tells two dropped files with the same name apart', async () => {
    const { files } = await service.filesFromDrop(
      transfer(fakeFile('a.md', '').handle, fakeFile('a.md', '').handle),
    )
    expect(files[0]!.externalId).not.toBe(files[1]!.externalId)
  })

  it('rejects other files and folders by name', async () => {
    const { files, rejected } = await service.filesFromDrop(
      transfer(fakeFile('photo.png', '').handle, directory('Projects'), fakeFile('b.md', '').handle),
    )
    expect(files.map((file) => file.name)).toEqual(['b.md'])
    expect(rejected).toEqual(['photo.png', 'Projects'])
  })

  it('asks for every handle before awaiting anything', async () => {
    let asked = 0
    const items = [1, 2].map(() => ({
      kind: 'file',
      getAsFileSystemHandle: () => {
        asked += 1
        return Promise.resolve(fakeFile('x.md', '').handle)
      },
    }))
    const pending = service.filesFromDrop({ items } as unknown as DataTransfer)
    // The browser empties the transfer when the drop handler returns.
    expect(asked).toBe(2)
    await pending
  })

  it('ignores what is not a file, and a browser that gives no handle', async () => {
    const items = [
      { kind: 'string', getAsFileSystemHandle: async () => fakeFile('text.md', '').handle },
      { kind: 'file' },
    ]
    expect(await service.filesFromDrop({ items } as unknown as DataTransfer)).toEqual({
      files: [],
      rejected: [],
    })
  })
})

describe('hasWritePermission', () => {
  it('reports a granted permission without prompting', async () => {
    const { handle } = fakeFile('a.md', '', { permission: 'granted' })
    expect(await service.hasWritePermission(fileNode(handle))).toBe(true)
  })

  it('reports anything else as not writable', async () => {
    const { handle } = fakeFile('a.md', '', { permission: 'prompt' })
    expect(await service.hasWritePermission(fileNode(handle))).toBe(false)
  })
})
