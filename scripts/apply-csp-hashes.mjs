#!/usr/bin/env node
/**
 * Post-processes the generated HTML so the CSP hashes its own inline scripts.
 *
 * Runs as part of `npm run generate`. Fails loudly: a silent miss here would
 * ship a page whose scripts the browser refuses to run.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { collectInlineScriptHashes, withScriptHashes } from '../security/inline-script-hashes.mjs'

const ROOT = '.output/public'
const META_PATTERN = /(<meta http-equiv="content-security-policy" content=")([^"]+)(")/i

const htmlFiles = (await readdir(ROOT, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
  .map((entry) => join(ROOT, entry.name))

if (htmlFiles.length === 0) {
  console.error(`No HTML files found in ${ROOT}. Did the build run?`)
  process.exit(1)
}

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8')
  const hashes = collectInlineScriptHashes(html)

  if (!META_PATTERN.test(html)) {
    console.error(`${file}: no CSP meta tag found. The policy must be present in every page.`)
    process.exit(1)
  }

  const patched = html.replace(META_PATTERN, (_, open, policy, close) =>
    `${open}${withScriptHashes(policy, hashes)}${close}`,
  )

  await writeFile(file, patched)
  console.log(`${file}: ${hashes.length} inline script hash(es) added`)
}
