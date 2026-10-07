/**
 * What both test runners need: which VS Code to run, and somewhere disposable to
 * run it.
 *
 * By default that is the oldest VS Code the manifest claims to support, downloaded
 * once into .vscode-test/. Two overrides:
 *
 *   VSCODE_VERSION=stable        test another release
 *   VSCODE_EXECUTABLE=<path>     use a VS Code that is already installed
 *
 * Either way it runs with its own throwaway profile and workspace, so it never
 * reads or writes the settings of the VS Code you work in.
 */
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const here = (path) => fileURLToPath(new URL(path, import.meta.url))

const manifest = JSON.parse(readFileSync(here('../package.json'), 'utf8'))

// Without the trailing separator a directory URL resolves to. On Windows a command
// line argument that ends in a backslash swallows the arguments after it, and VS
// Code would then start without the flags that follow this path.
export const extensionPath = dirname(here('../package.json'))
export const executable = process.env.VSCODE_EXECUTABLE
export const version = process.env.VSCODE_VERSION ?? manifest.engines.vscode.replace(/^\^/, '')

// Set in processes that VS Code itself starts, such as a task or another extension.
// Inherited, it would make the VS Code launched here run as plain Node instead.
delete process.env.ELECTRON_RUN_AS_NODE

/**
 * An empty workspace, profile and extensions folder, and the function that removes
 * them again.
 */
export async function createScratch() {
  const scratch = await mkdtemp(join(tmpdir(), 'hamde-test-'))
  const workspace = join(scratch, 'workspace')
  const profile = join(scratch, 'profile')
  const extensions = join(scratch, 'extensions')

  await Promise.all([workspace, profile, extensions].map((path) => mkdir(path)))

  return {
    scratch,
    workspace,
    profile,
    extensions,
    remove: () => rm(scratch, { recursive: true, force: true }).catch(() => {}),
  }
}
