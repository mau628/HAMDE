import { OPEN_LINK_HINT } from '~/services/links'
import { fragmentOf } from './headings'
import type { HtmlElement, HtmlNode } from './htmlModel'
import { imageFigure, imageNote, type ImageLoader } from './images'

/**
 * The HTML model as DOM.
 *
 * Built with `createElement` and text nodes, like every other widget in this app.
 * The model has already decided what may exist; this file only has to be faithful
 * to it, and there is no path from a string in the document to markup in the page.
 *
 * Two elements reach outside the page, and both keep the editor's existing rules:
 *
 * - A link is followed only on Ctrl/Cmd+click, and its target was checked by the
 *   model with the same `isSafeHref` a Markdown link goes through.
 * - An image is loaded exactly as a Markdown image is: from the workspace through
 *   the host, or from an `https:` address.
 */

export interface HtmlDomContext {
  loadImage: ImageLoader
  /** Called when something inside changed size after it was first drawn. */
  onResize: () => void
}

export function htmlToDom(nodes: readonly HtmlNode[], context: HtmlDomContext): DocumentFragment {
  const fragment = document.createDocumentFragment()
  for (const node of nodes) fragment.append(build(node, context))
  return fragment
}

function build(node: HtmlNode, context: HtmlDomContext): Node {
  if (node.kind === 'text') return document.createTextNode(node.text)
  if (node.tag === 'img') return image(node, context)

  // `node.tag` is one of the names the model allows, never text from the document.
  const element = document.createElement(node.tag)
  const { title, align, href, colspan, rowspan, start, type, open } = node.attributes

  if (title !== undefined) element.title = title
  // The presentational attribute, expressed the way it is meant today.
  if (align !== undefined) element.style.textAlign = align
  if (colspan !== undefined) element.setAttribute('colspan', colspan)
  if (rowspan !== undefined) element.setAttribute('rowspan', rowspan)
  if (start !== undefined) element.setAttribute('start', start)
  if (type !== undefined) element.setAttribute('type', type)
  if (open !== undefined) element.setAttribute('open', '')

  // An anchor with no target the editor would follow is not drawn as a link:
  // looking like one and doing nothing is worse than being plain text.
  if (node.tag === 'a' && href !== undefined) {
    element.className = 'cm-md-link'
    element.setAttribute('href', href)
    if (title === undefined) element.title = OPEN_LINK_HINT

    if (fragmentOf(href) === null) {
      // The new page must not reach back into the editor, and the referrer must
      // not say which note was open.
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noopener noreferrer')
    }
  }

  element.append(htmlToDom(node.children, context))
  return element
}

function image(node: HtmlElement, context: HtmlDomContext): HTMLElement {
  const { src, alt = '', width, height } = node.attributes

  if (src === undefined) return imageNote(alt)

  // A source the editor does not load, such as `data:` or a path outside the
  // workspace. Nothing was looked for, so it is not reported as missing: what is
  // left is the description, or failing that the source itself.
  const load = context.loadImage(src)
  if (load === null) return imageNote(alt.trim() || 'Image not loaded: ' + src)

  return imageFigure(src, alt, load, { width, height }, context.onResize)
}
