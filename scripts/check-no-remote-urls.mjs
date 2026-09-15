#!/usr/bin/env node
/**
 * Fails the build if the static output references any remote origin.
 *
 * "No network after load" is a product requirement, so it is enforced
 * mechanically rather than by convention or code review.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = '.output/public'

import { ALLOWED_INERT_URLS } from "./allowed-origins.mjs"

/** Files whose contents never reach the browser at runtime. */
const IGNORED_EXTENSIONS = ['.map']

const URL_PATTERN = /https?:\/\/[^\s"'()<>]+/g

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else yield path
  }
}

function isAllowed(url) {
  return ALLOWED_INERT_URLS.some((allowed) => url.startsWith(allowed))
}

const findings = []
let scanned = 0

for await (const path of walk(ROOT)) {
  if (IGNORED_EXTENSIONS.some((extension) => path.endsWith(extension))) continue
  scanned += 1

  const contents = await readFile(path, 'utf8').catch(() => null)
  if (contents === null) continue // binary asset

  for (const match of contents.matchAll(URL_PATTERN)) {
    if (!isAllowed(match[0])) {
      findings.push({ file: relative(ROOT, path), url: match[0] })
    }
  }
}

if (findings.length > 0) {
  console.error(`Remote URLs found in ${ROOT}:\n`)
  for (const { file, url } of findings) console.error(`  ${file}: ${url}`)
  console.error('\nThe app must be fully self-contained. See docs/security.md.')
  process.exit(1)
}

console.log(`No remote URLs found (${scanned} files scanned).`)
