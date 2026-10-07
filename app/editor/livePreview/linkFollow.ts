import { Facet } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

import { openExternal } from '~/services/links'
import { fragmentOf, jumpToHeading } from './headings'

/** Opens a link target, and says whether it did. */
export type LinkOpener = (href: string) => boolean

/**
 * How a link leaves the editor.
 *
 * A facet because "open" depends on where the editor runs: in a browser tab it is
 * a new tab, and a host without `window.open` has to ask something else to do it.
 */
export const linkOpener = Facet.define<LinkOpener, LinkOpener>({
  combine: (values) => values[0] ?? openExternal,
})

/**
 * Follows a link, wherever in the editor it was activated. Says whether it did.
 *
 * A link to a heading of this document (`#features`) is followed here, by moving
 * to that heading. Any other is handed to the host, which opens it only if
 * `isSafeHref` allows its protocol.
 */
export function followLink(view: EditorView, href: string): boolean {
  const fragment = fragmentOf(href)
  if (fragment !== null) return jumpToHeading(view, fragment)

  return view.state.facet(linkOpener)(href)
}
