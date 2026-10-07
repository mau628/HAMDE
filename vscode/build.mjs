#!/usr/bin/env node
/**
 * Builds the extension into dist/.
 *
 * Two bundles, because the two halves run in different worlds:
 *
 * - dist/extension.js runs in VS Code's extension host, which is Node. `vscode` is
 *   provided by the host and must not be bundled.
 * - dist/webview/ runs in the webview, which is a browser. It is the editor from
 *   ../app/editor, imported directly rather than copied. ES modules with code
 *   splitting keep Mermaid and the code grammars out of the first load, exactly as
 *   in the web app: a document without a diagram never parses Mermaid.
 *
 *   node build.mjs               development build, with source maps
 *   node build.mjs --production  minified, no source maps
 *   node build.mjs --watch       rebuild on change
 */
import { copyFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { context } from 'esbuild'

const here = (path) => fileURLToPath(new URL(path, import.meta.url))

const production = process.argv.includes('--production')
const watch = process.argv.includes('--watch')

const shared = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  // Licence notices of bundled libraries go to .LEGAL.txt files beside the code:
  // still shipped, as the licences ask, but not inside what the webview runs.
  legalComments: 'external',
  logLevel: 'info',
  // The same alias Nuxt and Vitest use, so the core's own imports resolve.
  alias: { '~': here('../app') },
}

const builds = [
  {
    ...shared,
    entryPoints: [here('src/extension.ts')],
    outfile: here('dist/extension.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
  },
  {
    ...shared,
    entryPoints: [here('src/webview/main.ts'), here('src/webview/webview.css')],
    outdir: here('dist/webview'),
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    splitting: true,
    entryNames: '[name]',
    chunkNames: 'chunks/[name]-[hash]',
  },
]

await rm(here('dist'), { recursive: true, force: true })
// vsce packages the licence that sits next to the manifest; the repository has one.
await copyFile(here('../LICENSE'), here('LICENSE'))

const contexts = await Promise.all(builds.map((options) => context(options)))

if (watch) {
  await Promise.all(contexts.map((build) => build.watch()))
} else {
  await Promise.all(contexts.map((build) => build.rebuild()))
  await Promise.all(contexts.map((build) => build.dispose()))
}
