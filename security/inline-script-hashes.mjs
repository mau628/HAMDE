/**
 * CSP hashes for the inline scripts Nuxt emits into the generated HTML.
 *
 * Nuxt writes its runtime config as an inline <script>, which `script-src 'self'`
 * blocks. Rather than weakening the policy with 'unsafe-inline', the build hashes
 * each inline script and adds the hash to the policy: only those exact scripts
 * can run, and any tampering with them breaks the hash.
 */
import { createHash } from 'node:crypto'

const SCRIPT_PATTERN = /<script([^>]*)>([\s\S]*?)<\/script>/g
const TYPE_PATTERN = /\btype\s*=\s*["']?([^"'\s>]+)/i
const SRC_PATTERN = /\bsrc\s*=/i

/** Script types the browser executes; anything else is an inert data block. */
const EXECUTABLE_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript'])

function isExecutableInlineScript(attributes) {
  if (SRC_PATTERN.test(attributes)) return false
  const type = TYPE_PATTERN.exec(attributes)?.[1]?.toLowerCase() ?? ''
  return EXECUTABLE_TYPES.has(type)
}

/** @returns CSP source expressions, e.g. `'sha256-abc…='`, one per inline script. */
export function collectInlineScriptHashes(html) {
  const hashes = new Set()

  for (const [, attributes = '', body = ''] of html.matchAll(SCRIPT_PATTERN)) {
    if (!isExecutableInlineScript(attributes)) continue
    const digest = createHash('sha256').update(body, 'utf8').digest('base64')
    hashes.add(`'sha256-${digest}'`)
  }

  return [...hashes]
}

/** Adds the hashes to the `script-src` directive of an existing policy string. */
export function withScriptHashes(policy, hashes) {
  if (hashes.length === 0) return policy

  let found = false
  const patched = policy
    .split('; ')
    .map((directive) => {
      if (!directive.startsWith('script-src ')) return directive
      found = true
      return `${directive} ${hashes.join(' ')}`
    })
    .join('; ')

  if (!found) throw new Error('Policy has no script-src directive to extend')
  return patched
}
