import type { EditorView } from '@codemirror/view'

import { openExternal } from '~/services/links'
import { fragmentOf, jumpToHeading } from './headings'

/**
 * Follows a link, wherever in the editor it was activated. Says whether it did.
 *
 * A link to a heading of this document (`#features`) is followed here, by moving
 * to that heading. Any other opens in a new tab, only if `isSafeHref` allows its
 * protocol.
 */
export function followLink(view: EditorView, href: string): boolean {
  const fragment = fragmentOf(href)
  if (fragment !== null) return jumpToHeading(view, fragment)

  return openExternal(href)
}
