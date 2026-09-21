/**
 * Link handling.
 *
 * Markdown is untrusted content, so a link target is a string that wants to be
 * executed until proven otherwise. Only these schemes are ever opened; everything
 * else — `javascript:`, `data:`, `blob:`, `file:`, `vbscript:`, and anything
 * unrecognised — is left as inert text.
 */
const ALLOWED_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])

/**
 * Whether a Markdown link target may be opened.
 *
 * Parsed with `URL` rather than matched with a regular expression: the parser is the
 * same one the browser uses, so tricks like `java\nscript:` or `JaVaScRiPt:` resolve
 * to their real protocol instead of slipping past a pattern.
 */
export function isSafeHref(href: string): boolean {
  const trimmed = href.trim()
  if (trimmed === '') return false

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    // Relative targets have no protocol of their own. They point inside the user's
    // folder, which M9 resolves; until then they are not opened.
    return false
  }

  return ALLOWED_PROTOCOLS.has(url.protocol)
}

/**
 * Opens a validated link in a new tab.
 *
 * `noopener,noreferrer` keeps the new page from reaching back into this one through
 * `window.opener`, and stops the referrer from disclosing anything about the editor.
 */
export function openExternal(href: string): boolean {
  if (!isSafeHref(href)) return false

  window.open(href.trim(), '_blank', 'noopener,noreferrer')
  return true
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** The modifier key name shown in hints: Cmd on Apple platforms, Ctrl elsewhere. */
export const MOD_KEY_LABEL = IS_MAC ? 'Cmd' : 'Ctrl'

/** The tooltip for a link: a plain click edits the text, so opening needs a modifier. */
export const OPEN_LINK_HINT = `${MOD_KEY_LABEL}+click to open link`
