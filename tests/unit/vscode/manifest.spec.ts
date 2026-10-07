import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Properties of the extension manifest that are decisions rather than boilerplate,
 * and that nothing else would notice being undone.
 */

const manifest = JSON.parse(readFileSync('vscode/package.json', 'utf8'))
const root = JSON.parse(readFileSync('package.json', 'utf8'))

describe('the extension manifest', () => {
  const [editor] = manifest.contributes.customEditors

  it('opens Markdown files only from real file systems', () => {
    // A pattern with a `/` is matched against `scheme:path`. Without the scheme,
    // HAMDE would also take over the read-only side of a Git diff.
    for (const { filenamePattern } of editor.selector) {
      expect(filenamePattern).toMatch(/^\{file,vscode-remote\}:\/\*\*\/\*\.(md|markdown)$/)
    }
  })

  it('is the default editor for those files', () => {
    expect(editor.priority).toBe('default')
  })

  it('works in an untrusted workspace, since every document is treated as hostile', () => {
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe(true)
  })

  it('compiles against the oldest VS Code it claims to support', () => {
    // vsce refuses to package when the typings are newer than the engine range.
    expect(manifest.engines.vscode).toBe('^' + manifest.devDependencies['@types/vscode'])
  })

  it('has no runtime dependencies, because everything is bundled', () => {
    expect(manifest.dependencies).toBeUndefined()
  })

  it('pins every dependency exactly, like the rest of the repository', () => {
    for (const version of Object.values<string>(manifest.devDependencies)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it('is installed with the root lockfile', () => {
    expect(root.workspaces).toContain('vscode')
  })
})
