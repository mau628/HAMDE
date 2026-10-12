/**
 * Mermaid rendering.
 *
 * Mermaid is the largest dependency in the project, so it is imported dynamically
 * and only when a document actually contains a diagram. It is configured with the
 * strictest settings it offers.
 *
 * The rendered SVG is the only generated markup this app puts in the DOM. It is not
 * inserted with `innerHTML`: it is parsed with `DOMParser` and scrubbed first, so the
 * codebase keeps the property that no string is ever interpreted as HTML.
 */

import { currentTheme, type Theme } from '~/services/theme'

export type DiagramResult =
  | { ok: true; svg: SVGElement }
  | { ok: false; message: string }

type Mermaid = typeof import('mermaid').default

/**
 * Rendered diagrams by theme and source, so moving the cursor never re-renders.
 *
 * By theme as well, because a diagram's colours are part of its SVG: the one drawn
 * for a dark screen is not the one that goes on paper.
 */
const cache = new Map<string, SVGElement>()

let loading: Promise<Mermaid> | null = null
let nextId = 0

/** The theme Mermaid is set up for. It has one configuration, shared by every render. */
let configured: Theme | null = null

/** Renders run one at a time, so a change of theme cannot land in the middle of one. */
let queue: Promise<unknown> = Promise.resolve()

function cacheKey(code: string, theme: Theme): string {
  return theme + '\n' + code
}

async function getMermaid(): Promise<Mermaid> {
  loading ??= import('mermaid').then(({ default: mermaid }) => mermaid)
  return loading
}

function configure(mermaid: Mermaid, theme: Theme): void {
  if (configured === theme) return

  mermaid.initialize({
    // Rendering is driven by the editor, never by a page scan.
    startOnLoad: false,
    // Encodes HTML in diagram labels and disables click directives, so a diagram
    // in an untrusted document cannot introduce markup or behaviour.
    securityLevel: 'strict',
    // Labels as SVG text rather than embedded HTML: one less way for content to
    // become markup, and it keeps the diagram a pure SVG.
    flowchart: { htmlLabels: false },
    class: { htmlLabels: false },
    theme: theme === 'dark' ? 'dark' : 'default',
    fontFamily: 'system-ui, sans-serif',
  })
  configured = theme
}

/** A diagram already rendered, for a widget that can show it immediately. */
export function cachedDiagram(code: string, theme: Theme = currentTheme()): SVGElement | undefined {
  return cache.get(cacheKey(code, theme))
}

/**
 * Renders a diagram, in the theme in effect unless another is asked for.
 *
 * Invalid syntax is a normal outcome — the user is typing — so it comes back as a
 * message rather than an exception.
 */
export async function renderDiagram(
  code: string,
  theme: Theme = currentTheme(),
): Promise<DiagramResult> {
  const key = cacheKey(code, theme)
  const cached = cache.get(key)
  if (cached !== undefined) return { ok: true, svg: cached.cloneNode(true) as SVGElement }

  let mermaid: Mermaid
  try {
    mermaid = await getMermaid()
  } catch (cause) {
    return { ok: false, message: describe(cause, 'Could not load Mermaid') }
  }

  const drawn = queue.then(async (): Promise<DiagramResult> => {
    try {
      configure(mermaid, theme)

      // parse() first: it reports a syntax error without leaving anything behind.
      await mermaid.parse(code)

      nextId += 1
      const { svg } = await mermaid.render('hamde-diagram-' + nextId, code)

      const element = svgFromMarkup(svg)
      if (element === null) return { ok: false, message: 'Mermaid produced markup that is not SVG' }

      cache.set(key, element)
      return { ok: true, svg: element.cloneNode(true) as SVGElement }
    } catch (cause) {
      return { ok: false, message: describe(cause, 'Invalid diagram') }
    }
  })
  queue = drawn

  return drawn
}

function describe(cause: unknown, fallback: string): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string') return cause
  return fallback
}

/**
 * Turns Mermaid's SVG string into an element, without `innerHTML`.
 *
 * `securityLevel: 'strict'` already encodes anything the document supplied, so this
 * is defence in depth: parsing as SVG executes nothing, and the scrub then removes
 * the two things that could still carry behaviour if Mermaid ever changed —
 * script elements and event handler attributes.
 */
export function svgFromMarkup(markup: string): SVGElement | null {
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')

  if (parsed.querySelector('parsererror') !== null) return null

  const root = parsed.documentElement
  if (!(root instanceof SVGElement)) return null

  scrub(root)
  return root
}

const SAFE_LINK = /^(https?:|mailto:|#)/i

function scrub(element: Element): void {
  for (const script of element.querySelectorAll('script')) script.remove()

  for (const node of [element, ...element.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase()

      // Event handlers: onclick, onload, and anything else of that shape.
      if (name.startsWith('on')) {
        node.removeAttribute(attribute.name)
        continue
      }

      // A link is only allowed to go somewhere a Markdown link could.
      if ((name === 'href' || name === 'xlink:href') && !SAFE_LINK.test(attribute.value.trim())) {
        node.removeAttribute(attribute.name)
      }
    }
  }
}
