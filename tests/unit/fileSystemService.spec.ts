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
