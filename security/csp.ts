/**
 * Content Security Policy for HAMDE.
 *
 * Delivered as a <meta http-equiv> because GitHub Pages cannot set HTTP headers.
 * Known limitation of the meta form: `frame-ancestors`, `sandbox` and `report-uri`
 * are ignored by browsers, so they are deliberately absent here.
 *
 * Rationale per directive is documented in docs/security.md.
 */

/** Directives shared by every environment. */
const base: Record<string, string> = {
  'default-src': "'none'",
  'script-src': "'self'",
  // 'unsafe-inline' is unavoidable: CodeMirror's style engine (style-mod) injects a
  // <style> element and assigns textContent. It accepts a nonce, but a static site
  // cannot mint per-request nonces. See docs/security.md.
  'style-src': "'self' 'unsafe-inline'",
  // blob: is how an image from the user's local folder is shown. https: is for an
  // image a document points to on the web, which is the one kind of request this
  // app makes on a document's behalf; see docs/security.md for what that costs.
  // Plain http: is deliberately absent.
  'img-src': "'self' data: blob: https:",
  'font-src': "'self'",
  'base-uri': "'none'",
  'form-action': "'none'",
  'object-src': "'none'",
  'frame-src': "'none'",
  'worker-src': "'self'",
  'manifest-src': "'self'",
}

/**
 * Builds the policy string.
 *
 * Development needs two relaxations that production must never have:
 *
 * - `script-src 'unsafe-inline'`, because Nuxt emits its runtime config as an inline
 *   script and the dev server serves HTML on the fly, so the build step that hashes
 *   those scripts (scripts/apply-csp-hashes.mjs) has not run. Without this the app
 *   does not mount at all: `window.__NUXT__` never gets defined.
 * - `connect-src 'self' ws: wss:`, for Vite's HMR socket and DevTools' own probes.
 *
 * Production keeps `script-src 'self'` plus per-script hashes, and `connect-src
 * 'none'` as the technical backstop for "notes never leave the device".
 */
export function buildCsp(dev: boolean): string {
  const directives: Record<string, string> = {
    ...base,
    'script-src': dev ? "'self' 'unsafe-inline'" : base['script-src']!,
    'connect-src': dev ? "'self' ws: wss:" : "'none'",
  }
  return Object.entries(directives)
    .map(([name, value]) => `${name} ${value}`)
    .join('; ')
}

export const productionCsp = buildCsp(false)
