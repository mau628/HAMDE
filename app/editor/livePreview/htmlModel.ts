import { htmlLanguage } from '@codemirror/lang-html'
import type { SyntaxNode } from '@lezer/common'

import { isSafeHref } from '~/services/links'

/**
 * HTML embedded in a document, as plain data that is safe to draw.
 *
 * A Markdown file is untrusted, and HTML is the part of it that most wants to be
 * executed. So it is never given to the browser as HTML: not through `innerHTML`,
 * and not through `DOMParser` either. It is parsed here, by the grammar CodeMirror
 * already ships for highlighting, into the small model below, and the model is
 * what `htmlToDom` builds elements from.
 *
 * That makes the rule an allowlist, enforced by construction rather than by
 * cleaning: an element or attribute reaches the page only if it is named in this
 * file. There is nothing to scrub afterwards and no markup to slip past a scrubber,
 * because no markup from the document ever exists in the page — only elements this
 * code created, with attributes this code set.
 *
 * What an element outside the list becomes depends on what it is for:
 *
 * - One whose content is not text for the reader (`<script>`, `<style>`,
 *   `<iframe>`, `<svg>`, a form control) is dropped with everything inside it.
 * - Any other is unwrapped: the tag goes, its content stays, so `<font>` or
 *   `<section>` or a tag nobody has heard of does not take the text with it.
 *
 * No DOM is involved, so all of it is unit-tested.
 */

export interface HtmlText {
  kind: 'text'
  text: string
}

export interface HtmlElement {
  kind: 'element'
  tag: string
  /** Only names from `ATTRIBUTES`, with values that passed their check. */
  attributes: Readonly<Record<string, string>>
  children: readonly HtmlNode[]
}

export type HtmlNode = HtmlText | HtmlElement

export interface HtmlFragment {
  nodes: readonly HtmlNode[]
  /**
   * Whether every element that was opened was closed, and nothing was closed that
   * had not been opened. CommonMark ends an HTML block at a blank line, so a
   * `<details>` around several paragraphs arrives as two halves; each half is left
   * as source rather than drawn as something it is not.
   */
  balanced: boolean
}

/** Elements drawn as themselves. */
const ALLOWED = new Set([
  // Blocks
  'p', 'div', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'center',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'details', 'summary', 'figure', 'figcaption',
  // Inline
  'a', 'img', 'br', 'wbr', 'span',
  'b', 'strong', 'i', 'em', 'u', 's', 'del', 'strike', 'ins', 'mark', 'small',
  'sub', 'sup', 'kbd', 'code', 'samp', 'var', 'abbr', 'cite', 'q',
])

/** Elements removed together with their content. */
const DROPPED = new Set([
  'script', 'style', 'template', 'noscript', 'noembed', 'noframes',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'svg', 'math', 'canvas', 'audio', 'video', 'source', 'track', 'picture', 'map', 'area',
  'head', 'title', 'meta', 'link', 'base',
  'textarea', 'select', 'option', 'optgroup', 'datalist', 'input', 'button',
])

type Check = (value: string) => string | null

const text: Check = (value) => value
const keyword =
  (...allowed: string[]): Check =>
  (value) => {
    const lower = value.trim().toLowerCase()
    return allowed.includes(lower) ? lower : null
  }
/** A small whole number, as `colspan` or `start` take. */
const count: Check = (value) => (/^\d{1,4}$/.test(value.trim()) ? value.trim() : null)
/** A length in pixels or a percentage, which is all `width` and `height` may be. */
const size: Check = (value) => (/^\d{1,4}%?$/.test(value.trim()) ? value.trim() : null)
/** A boolean attribute: present is all it says. */
const flag: Check = () => ''

const ALIGN = keyword('left', 'center', 'right', 'justify')

/**
 * The attributes that survive, per element. `*` applies to every element.
 *
 * Absent on purpose: `style` and `class` (the document does not get to restyle the
 * editor), `id` and `name` (which can shadow properties of `document`), every
 * `on…` handler, and `srcset`, which names more URLs than `src` does.
 */
const ATTRIBUTES: Readonly<Record<string, Readonly<Record<string, Check>>>> = {
  '*': { title: text, align: ALIGN },
  // The same rule as a Markdown link: http, https and mailto, or it is not a link.
  // Plus a link to a heading of the document itself, which goes nowhere but there.
  a: { href: (value) => (isSafeHref(value) || isFragment(value) ? value.trim() : null) },
  // Whether the source may be loaded is decided where it is loaded, by the same
  // rule as a Markdown image. Here it is only text.
  img: { src: (value) => value.trim() || null, alt: text, width: size, height: size },
  td: { colspan: count, rowspan: count },
  th: { colspan: count, rowspan: count },
  ol: { start: count, type: (value) => (/^[1aAiI]$/.test(value.trim()) ? value.trim() : null) },
  details: { open: flag },
}

/** Elements HTML lets you leave unclosed: the next one, or the parent's end, closes them. */
const OPTIONAL_END = new Set([
  'p', 'li', 'dt', 'dd', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'caption',
])

/** `#section`: a name, with nothing in it that could be read as anything else. */
function isFragment(value: string): boolean {
  return /^#[^\s#]+$/.test(value.trim())
}

/** Elements that stand for something visible even with no text inside. */
const VISIBLE_WHEN_EMPTY = new Set(['img', 'hr'])

/** A document made of nothing but nested tags would otherwise recurse without end. */
const MAX_DEPTH = 64
const MAX_LENGTH = 200_000

const NOTHING: HtmlFragment = { nodes: [], balanced: false }

const cache = new Map<string, HtmlFragment>()
const CACHE_LIMIT = 300

/**
 * Parses a piece of HTML into the model.
 *
 * Remembered by source: the block layer asks about every HTML block in the
 * document on each change, and all but the one being typed in are unchanged.
 */
export function parseHtml(source: string): HtmlFragment {
  const known = cache.get(source)
  if (known !== undefined) return known

  const fragment = source.length > MAX_LENGTH ? NOTHING : build(source)

  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(source, fragment)
  return fragment
}

/** Whether a fragment is worth replacing its source with. */
export function isRenderableHtml(fragment: HtmlFragment): boolean {
  return fragment.balanced && fragment.nodes.some(hasVisibleContent)
}

function hasVisibleContent(node: HtmlNode): boolean {
  if (node.kind === 'text') return node.text.trim() !== ''
  return VISIBLE_WHEN_EMPTY.has(node.tag) || node.children.some(hasVisibleContent)
}

function build(source: string): HtmlFragment {
  const tree = htmlLanguage.parser.parse(source)
  let balanced = true

  function children(parent: SyntaxNode, depth: number): HtmlNode[] {
    const result: HtmlNode[] = []
    for (let node = parent.firstChild; node !== null; node = node.nextSibling) {
      append(result, node, depth)
    }
    return result
  }

  function append(result: HtmlNode[], node: SyntaxNode, depth: number): void {
    if (node.type.isError || node.name === 'MismatchedCloseTag') {
      balanced = false
      return
    }

    switch (node.name) {
      case 'Text':
        return pushText(result, source.slice(node.from, node.to))
      case 'EntityReference':
      case 'CharacterReference':
        return pushText(result, decodeEntity(source.slice(node.from, node.to)))
      case 'InvalidEntity':
        return pushText(result, source.slice(node.from, node.to))
      case 'Element':
        return element(result, node, depth)
      default:
        // Comments, doctypes, processing instructions, and the tags themselves.
        return
    }
  }

  function element(result: HtmlNode[], node: SyntaxNode, depth: number): void {
    const open = node.getChild('OpenTag') ?? node.getChild('SelfClosingTag')
    const name = open?.getChild('TagName')
    if (open === null || name == null) return

    const tag = source.slice(name.from, name.to).toLowerCase()

    // An element still open where the text ends is not reported as an error by
    // the parser, so it is looked for here.
    if (open.name === 'OpenTag' && node.getChild('CloseTag') === null && !OPTIONAL_END.has(tag)) {
      balanced = false
    }

    if (DROPPED.has(tag) || depth >= MAX_DEPTH) return

    const inside = children(node, depth + 1)
    if (!ALLOWED.has(tag)) {
      for (const child of inside) {
        if (child.kind === 'text') pushText(result, child.text)
        else result.push(child)
      }
      return
    }

    result.push({ kind: 'element', tag, attributes: attributes(open, tag), children: inside })
  }

  function attributes(open: SyntaxNode, tag: string): Record<string, string> {
    const result: Record<string, string> = {}

    for (const attribute of open.getChildren('Attribute')) {
      const nameNode = attribute.getChild('AttributeName')
      if (nameNode === null) continue

      const name = source.slice(nameNode.from, nameNode.to).toLowerCase()
      const check = ATTRIBUTES[tag]?.[name] ?? ATTRIBUTES['*']![name]
      // The first one wins, as it does in a browser.
      if (check === undefined || name in result) continue

      const value = check(attributeValue(attribute))
      if (value !== null) result[name] = value
    }

    return result
  }

  function attributeValue(attribute: SyntaxNode): string {
    const quoted = attribute.getChild('AttributeValue')
    if (quoted !== null) return decodeEntities(source.slice(quoted.from + 1, quoted.to - 1))

    const bare = attribute.getChild('UnquotedAttributeValue')
    return bare === null ? '' : decodeEntities(source.slice(bare.from, bare.to))
  }

  const nodes = children(tree.topNode, 0)
  return { nodes, balanced }
}

/** Adjacent text is one node, so a decoded entity does not split a word in two. */
function pushText(result: HtmlNode[], value: string): void {
  if (value === '') return

  const last = result.at(-1)
  if (last !== undefined && last.kind === 'text') {
    result[result.length - 1] = { kind: 'text', text: last.text + value }
  } else {
    result.push({ kind: 'text', text: value })
  }
}

/**
 * The entities worth knowing by name. HTML defines some two thousand; these are
 * the ones people type. An unknown one is shown as written, which is also what it
 * means: the text is always text, whatever it decodes to.
 */
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±', times: '×', divide: '÷',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', bull: '•', middot: '·', para: '¶', sect: '§',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔',
  euro: '€', pound: '£', yen: '¥', cent: '¢',
  check: '✓', cross: '✗', star: '☆', hearts: '♥',
  ensp: ' ', emsp: ' ', thinsp: ' ', zwj: '‍', zwnj: '‌', shy: '­',
}

function decodeEntity(entity: string): string {
  const body = entity.replace(/^&/, '').replace(/;$/, '')

  if (body.startsWith('#')) {
    const hex = body[1] === 'x' || body[1] === 'X'
    const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
    // A lone surrogate or a code past the end of Unicode is not a character.
    const valid = Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
    return valid ? String.fromCodePoint(code) : '�'
  }

  return ENTITIES[body] ?? entity
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, decodeEntity)
}

export interface InlineTag {
  name: string
  kind: 'open' | 'close' | 'void'
  /** Checked attributes of an opening tag; empty for a closing one. */
  attributes: Readonly<Record<string, string>>
}

const VOID = new Set(['br', 'wbr', 'img', 'hr'])

/**
 * Reads a single tag, as Markdown hands inline HTML over: one node per tag, with
 * the text between an opening and a closing tag left as ordinary Markdown.
 *
 * Returns null for anything that is not one allowed tag.
 */
export function parseInlineTag(source: string): InlineTag | null {
  const closing = /^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>$/.exec(source)
  if (closing !== null) {
    const name = closing[1]!.toLowerCase()
    return ALLOWED.has(name) ? { name, kind: 'close', attributes: {} } : null
  }

  if (!/^<[a-zA-Z]/.test(source)) return null

  const [node] = parseHtml(source).nodes
  if (node === undefined || node.kind !== 'element') return null

  return {
    name: node.tag,
    kind: VOID.has(node.tag) || source.endsWith('/>') ? 'void' : 'open',
    attributes: node.attributes,
  }
}
