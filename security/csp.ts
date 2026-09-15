/**
 * Content Security Policy for YAMDE.
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
  // blob: is required to render images from the user's local folder.
  // Remote image hosts are intentionally NOT allowed: loading them would leak
  // which note the user is reading.
  'img-src': "'self' data: blob:",
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
 * @param dev  In development, Nuxt's HMR client needs a WebSocket, so `connect-src`
 *             is relaxed. Production enforces `connect-src 'none'`, which is the
 *             technical backstop for "notes never leave the device".
 */
export function buildCsp(dev: boolean): string {
  const directives: Record<string, string> = {
    ...base,
    'connect-src': dev ? "'self' ws: wss:" : "'none'",
  }
  return Object.entries(directives)
    .map(([name, value]) => `${name} ${value}`)
    .join('; ')
}

export const productionCsp = buildCsp(false)
