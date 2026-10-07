#!/usr/bin/env node
/**
 * Runs test/smoke inside a real VS Code, with the built extension loaded.
 *
 * Which VS Code, and how to choose another, is in ./environment.mjs.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { runTests } from '@vscode/test-electron'

import { createScratch, executable, extensionPath, here, version } from './environment.mjs'

const { workspace, profile, extensions, remove } = await createScratch()

await writeFile(join(workspace, 'note.md'), '# Note\n\nSome text.\n')
await writeFile(join(workspace, 'long-name.markdown'), '# Also Markdown\n')

try {
  await runTests({
    ...(executable ? { vscodeExecutablePath: executable } : { version }),
    extensionDevelopmentPath: extensionPath,
    extensionTestsPath: here('smoke/index.cjs'),
    launchArgs: [
      workspace,
      '--user-data-dir=' + profile,
      // An empty folder, so only the extension under test is there to claim .md files.
      '--extensions-dir=' + extensions,
      '--disable-extensions',
      '--disable-workspace-trust',
    ],
  })
} finally {
  await remove()
}
