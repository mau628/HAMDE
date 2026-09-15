import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Enforces the boundary that makes the app testable: only the file system service
 * knows about the File System Access API. Everything else works with the node types
 * from ~/types/fileSystem.
 *
 * Without this test the boundary is a convention, and conventions erode.
 */

const APP = 'app'

/** The two modules allowed to name the browser API. */
const OWNERS = ['app/services/fileSystemService.ts', 'app/types/fileSystem.ts']

const BROWSER_API_IDENTIFIERS = [
  'showDirectoryPicker',
  'createWritable',
  'FileSystemWritableFileStream',
  'FileSystemDirectoryHandle',
  'FileSystemFileHandle',
  'FileSystemHandlePermissionDescriptor',
  'queryPermission',
  'requestPermission',
]

/**
 * Strips comments before scanning.
 *
 * The rule constrains code, not prose: documentation is allowed to name the API it
 * is explaining, and a comment mentioning a handle type is not a boundary breach.
 */
function codeOnly(source: string): string {
  const blockComment = /\/\*[\s\S]*?\*\//g
  const lineComment = /^[ \t]*\/\/.*$/gm
  return source.replace(blockComment, '').replace(lineComment, '')
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|vue)$/.test(entry.name) ? [path] : []
  })
}

describe('file system boundary', () => {
  const files = sourceFiles(APP).map((path) => relative('.', path).split('\\').join('/'))

  it('finds the app sources', () => {
    expect(files.length).toBeGreaterThan(5)
    expect(files).toContain('app/services/fileSystemService.ts')
  })

  it.each(BROWSER_API_IDENTIFIERS)('keeps %s inside the service layer', (identifier) => {
    const offenders = files
      .filter((path) => !OWNERS.includes(path))
      .filter((path) => codeOnly(readFileSync(path, 'utf8')).includes(identifier))

    expect(offenders).toEqual([])
  })
})
