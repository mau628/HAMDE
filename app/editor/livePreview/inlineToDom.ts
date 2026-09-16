import { isSafeHref } from '~/services/links'
import type { InlineNode } from './inlineModel'

/**
 * Inline content as DOM.
 *
 * Built with `createElement` and text nodes, never `innerHTML`: a Markdown document
 * is untrusted input, and the rule that it can put no markup in the page holds here
 * as it does for every other widget in this app.
 *
 * The classes are the ones the inline decoration layer already applies, so a bold
 * word inside a rendered block looks exactly like a bold word in a paragraph, and
 * there is one place to restyle either.
 */

const TAGS = {
  strong: { tag: 'strong', class: 'cm-md-strong' },
  emphasis: { tag: 'em', class: 'cm-md-emphasis' },
  strikethrough: { tag: 'del', class: 'cm-md-strikethrough' },
  code: { tag: 'code', class: 'cm-md-code' },
} as const

export function inlineToDom(nodes: readonly InlineNode[]): DocumentFragment {
  const fragment = document.createDocumentFragment()
  for (const node of nodes) fragment.append(build(node))
  return fragment
}

function build(node: InlineNode): Node {
  if (node.kind === 'text') return document.createTextNode(node.text)
  if (node.kind === 'link') return link(node.href, node.children)

  const spec = TAGS[node.kind]
  const element = document.createElement(spec.tag)
  element.className = spec.class
  element.append(inlineToDom(node.children))
  return element
}

/**
 * A real anchor when the target is one this editor would open, and styled text when
 * it is not.
 *
 * The href goes through the same `isSafeHref` the editor's Ctrl+click uses, so a
 * `javascript:` target never reaches the DOM. A relative target is refused for the
 * reason it is refused elsewhere: it points inside the user's folder, which is not
 * something to open in a browser tab. `noopener,noreferrer` matches `openExternal`
 * — the new page must not reach back into the editor, and the referrer must not
 * say which note was open.
 */
function link(href: string, children: readonly InlineNode[]): HTMLElement {
  if (!isSafeHref(href)) {
    const span = document.createElement('span')
    span.className = 'cm-md-link'
    span.append(inlineToDom(children))
    return span
  }

  const anchor = document.createElement('a')
  anchor.className = 'cm-md-link'
  anchor.href = href.trim()
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  anchor.append(inlineToDom(children))
  return anchor
}
