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

const files = sourceFiles(APP).map((path) => relative('.', path).split('\\').join('/'))

describe('file system boundary', () => {

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

/**
 * Enforces the boundary that lets the editor run outside this app: everything under
 * app/editor, and the few services it uses, must work without Vue, Nuxt or the file
 * system service. The VS Code extension bundles exactly these files into its webview.
 *
 * Auto-imports are the other way to break this, and a scan cannot see them; the
 * extension's own typecheck (vscode/tsconfig.json), which has no Nuxt globals, does.
 */
describe('editor core boundary', () => {
  const CORE = 'app/editor/'

  /** The only modules outside app/editor the core may reach. */
  const SHARED_SERVICES = [
    'app/services/imagePath.ts',
    'app/services/links.ts',
    'app/services/mermaidService.ts',
    'app/services/theme.ts',
  ]

  const FRAMEWORK = /^(vue|nuxt|#app|#imports|#build)(\/|$)/

  function imports(path: string): string[] {
    const source = codeOnly(readFileSync(path, 'utf8'))
    return [...source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1]!,
    )
  }

  /** The app file an import names, or `null` for a package. */
  function resolve(from: string, specifier: string): string | null {
    const base = specifier.startsWith('~/')
      ? 'app/' + specifier.slice(2)
      : specifier.startsWith('.')
        ? join(from, '..', specifier).split('\\').join('/')
        : null
    if (base === null) return null

    return [base + '.ts', base + '/index.ts', base].find((path) => files.includes(path)) ?? base
  }

  /** Every app file the core reaches, directly or through another file. */
  function reachable(): Map<string, string> {
    const reachedFrom = new Map<string, string>()
    const queue = files.filter((path) => path.startsWith(CORE))

    for (const path of queue) {
      for (const specifier of imports(path)) {
        const target = resolve(path, specifier)
        if (target === null || reachedFrom.has(target)) continue
        reachedFrom.set(target, path)
        if (files.includes(target) && !queue.includes(target)) queue.push(target)
      }
    }

    return reachedFrom
  }

  it('reaches only itself and the shared services', () => {
    const offenders = [...reachable()]
      .filter(([target]) => !target.startsWith(CORE) && !SHARED_SERVICES.includes(target))
      .map(([target, from]) => `${from} -> ${target}`)

    expect(offenders).toEqual([])
  })

  it('reaches every shared service, so the list stays honest', () => {
    const reached = reachable()
    expect(SHARED_SERVICES.filter((path) => !reached.has(path))).toEqual([])
  })

  it('imports no framework module', () => {
    const core = [...files.filter((path) => path.startsWith(CORE)), ...SHARED_SERVICES]
    const offenders = core.flatMap((path) =>
      imports(path)
        .filter((specifier) => FRAMEWORK.test(specifier))
        .map((specifier) => `${path} -> ${specifier}`),
    )

    expect(offenders).toEqual([])
  })
})
