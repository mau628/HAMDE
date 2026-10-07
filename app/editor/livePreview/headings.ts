import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

import { inlineModel, type InlineNode } from './inlineModel'

/**
 * Links to a heading of the same document: `[Features](#features)`.
 *
 * A table of contents at the top of a README is made of these. They name a heading
 * by the identifier a renderer derives from its text, and the derivation used here
 * is GitHub's, because that is where such links are written to work:
 *
 * - lower case;
 * - everything dropped but letters, digits, spaces, hyphens and underscores;
 * - each space turned into a hyphen;
 * - a second heading with the same result gets `-1`, the third `-2`.
 *
 * So `## Why Easy!Appointments` is `#why-easyappointments`.
 */

/** Node types a heading can be inside. Nothing else is descended into. */
const CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem'])

/** How long the parser may spend finishing a large document before a link gives up. */
const PARSE_BUDGET_MS = 200

export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
    .replace(/ /g, '-')
}

/** The text of a heading as a reader sees it: no markers, no link targets. */
function headingText(state: EditorState, node: SyntaxNode): string {
  const flatten = (nodes: readonly InlineNode[]): string =>
    nodes.map((inline) => (inline.kind === 'text' ? inline.text : flatten(inline.children))).join('')

  // Between the markers: after the `##` of an ATX heading and before a closing
  // one, or above the underline of a setext heading.
  const marks = node.getChildren('HeaderMark')
  const setext = node.name.startsWith('Setext')
  const from = setext ? node.from : (marks.at(0)?.to ?? node.from)
  const closing = setext ? marks.at(0) : marks.at(1)

  return flatten(inlineModel(state, node, from, closing?.from ?? node.to))
}

/**
 * Where the heading a fragment names starts, or `null` if no heading has that name.
 *
 * The whole document is looked at, since a link at the top usually points far
 * below; the walk only enters what can contain a heading, so it is a pass over the
 * document's blocks, not its text.
 */
export function headingPosition(state: EditorState, fragment: string): number | null {
  let wanted: string
  try {
    wanted = decodeURIComponent(fragment).toLowerCase()
  } catch {
    wanted = fragment.toLowerCase()
  }
  if (wanted === '') return null

  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS)
  if (tree === null) return null

  const seen = new Map<string, number>()
  let found: number | null = null

  tree.iterate({
    enter: (node) => {
      if (found !== null) return false

      if (node.name.startsWith('ATXHeading') || node.name.startsWith('SetextHeading')) {
        const base = headingSlug(headingText(state, node.node))
        const repeats = seen.get(base) ?? 0
        seen.set(base, repeats + 1)

        if ((repeats === 0 ? base : base + '-' + repeats) === wanted) found = node.from
        return false
      }

      return CONTAINERS.has(node.name)
    },
  })

  return found
}

/**
 * Goes to the heading a fragment names. Says whether there was one.
 *
 * The cursor goes with the view, to the end of the heading, so that the keyboard
 * is where the eyes are.
 */
export function jumpToHeading(view: EditorView, fragment: string): boolean {
  const position = headingPosition(view.state, fragment)
  if (position === null) return false

  const line = view.state.doc.lineAt(position)
  view.dispatch({
    selection: { anchor: line.to },
    effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 16 }),
  })
  view.focus()
  return true
}

/** The fragment of a link that points into this document, or `null` for any other. */
export function fragmentOf(href: string): string | null {
  const trimmed = href.trim()
  return trimmed.startsWith('#') && trimmed.length > 1 ? trimmed.slice(1) : null
}
