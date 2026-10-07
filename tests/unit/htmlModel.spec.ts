import { describe, expect, it } from 'vitest'

import {
  isRenderableHtml,
  parseHtml,
  parseInlineTag,
  type HtmlNode,
} from '../../app/editor/livePreview/htmlModel'

/**
 * What HTML in a document is allowed to become.
 *
 * This is the security boundary for rendered HTML, and it is an allowlist: the
 * tests below are less about what is removed than about the fact that nothing
 * reaches the model unless it is named there. The model is all `htmlToDom` ever
 * sees, so a tag or attribute that is not in it cannot be in the page.
 */

/** The model written back as markup, so a test can state what it expects to read. */
function shown(nodes: readonly HtmlNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === 'text') return node.text

      const attributes = Object.entries(node.attributes)
        .map(([name, value]) => ` ${name}="${value}"`)
        .join('')
      return `<${node.tag}${attributes}>${shown(node.children)}</${node.tag}>`
    })
    .join('')
}

const model = (source: string) => shown(parseHtml(source).nodes)

/** Every tag and every attribute name in a model, however deep. */
function vocabulary(nodes: readonly HtmlNode[]): { tags: string[]; attributes: string[] } {
  const tags: string[] = []
  const attributes: string[] = []

  const walk = (list: readonly HtmlNode[]) => {
    for (const node of list) {
      if (node.kind === 'text') continue
      tags.push(node.tag)
      attributes.push(...Object.keys(node.attributes))
      walk(node.children)
    }
  }
  walk(nodes)

  return { tags, attributes }
}

describe('what is drawn', () => {
  it.each([
    ['<p>text</p>', '<p>text</p>'],
    ['<div><b>bold</b> and <i>italic</i></div>', '<div><b>bold</b> and <i>italic</i></div>'],
    ['<kbd>Ctrl</kbd>+<kbd>S</kbd>', '<kbd>Ctrl</kbd>+<kbd>S</kbd>'],
    ['H<sub>2</sub>O, x<sup>2</sup>', 'H<sub>2</sub>O, x<sup>2</sup>'],
    ['<ul><li>one<li>two</ul>', '<ul><li>one</li><li>two</li></ul>'],
    ['line<br>break', 'line<br></br>break'],
    [
      '<details open><summary>More</summary>Hidden</details>',
      '<details open=""><summary>More</summary>Hidden</details>',
    ],
    [
      '<table><tr><th colspan="2">Head</th></tr><tr><td>a</td><td>b</td></tr></table>',
      '<table><tr><th colspan="2">Head</th></tr><tr><td>a</td><td>b</td></tr></table>',
    ],
  ])('keeps %j', (source, expected) => {
    expect(model(source)).toBe(expected)
  })

  it('lowercases tag and attribute names', () => {
    expect(model('<DIV ALIGN="CENTER">x</DIV>')).toBe('<div align="center">x</div>')
  })

  it('decodes entities into text, never into markup', () => {
    expect(model('<p>a &amp; b &lt;script&gt; &#65;&#x42; &copy;</p>')).toBe(
      '<p>a & b <script> AB ©</p>',
    )
    // The result is one text node whose text happens to contain angle brackets.
    const [paragraph] = parseHtml('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>').nodes
    expect(paragraph).toEqual({
      kind: 'element',
      tag: 'p',
      attributes: {},
      children: [{ kind: 'text', text: '<script>alert(1)</script>' }],
    })
  })

  it('shows an entity it does not know as written', () => {
    expect(model('<p>&bogus; &#xD800; &#99999999;</p>')).toBe('<p>&bogus; � �</p>')
  })
})

describe('what never reaches the model', () => {
  it.each([
    ['a script', '<script>alert(1)</script>'],
    ['a script with attributes', '<script src="https://evil.example/x.js"></script>'],
    ['a style sheet', '<style>body { display: none }</style>'],
    ['a frame', '<iframe src="https://evil.example"></iframe>'],
    ['an object', '<object data="x.swf"></object><embed src="x.swf">'],
    ['inline SVG', '<svg onload="alert(1)"><script>alert(2)</script><circle r="1"/></svg>'],
    ['MathML', '<math><mi xlink:href="javascript:alert(1)">x</mi></math>'],
    ['a template', '<template><img src=x onerror=alert(1)></template>'],
    ['form controls', '<input value="x" autofocus onfocus="alert(1)"><button>Go</button>'],
    ['a text area', '<textarea><b>x</b></textarea>'],
    ['document metadata', '<meta http-equiv="refresh" content="0;url=https://evil.example">'],
    ['a base', '<base href="https://evil.example/">'],
    ['a linked style sheet', '<link rel="stylesheet" href="https://evil.example/x.css">'],
    ['media', '<video src="https://evil.example/v.mp4" autoplay></video><audio src="x"></audio>'],
  ])('drops %s, with its content', (_name, source) => {
    expect(parseHtml(source).nodes).toEqual([])
  })

  it('drops a dropped element from inside an allowed one, keeping the rest', () => {
    expect(model('<p>before<script>alert(1)</script>after</p>')).toBe('<p>beforeafter</p>')
    expect(model('<div><style>p{}</style><b>kept</b></div>')).toBe('<div><b>kept</b></div>')
  })

  it.each([
    ['an event handler', '<p onclick="alert(1)" onmouseover="alert(2)">x</p>', '<p>x</p>'],
    ['a handler on an image', '<img src="a.png" onerror="alert(1)" onload="x()">', '<img src="a.png"></img>'],
    ['inline style', '<p style="position:fixed;inset:0;background:url(https://evil.example)">x</p>', '<p>x</p>'],
    ['a class', '<div class="shell__explorer welcome">x</div>', '<div>x</div>'],
    ['an id and a name', '<p id="body" name="cookie">x</p>', '<p>x</p>'],
    ['a srcset', '<img src="a.png" srcset="https://evil.example/b.png 2x">', '<img src="a.png"></img>'],
    ['data and aria attributes', '<span data-x="1" aria-label="y">x</span>', '<span>x</span>'],
    ['contenteditable', '<div contenteditable="true">x</div>', '<div>x</div>'],
  ])('drops %s', (_name, source, expected) => {
    expect(model(source)).toBe(expected)
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\nscript:alert(1)',
    '&#106;avascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'relative/path.md',
    '#',
    '# two words',
    '#one#two',
  ])('leaves a link to %j with no target at all', (href) => {
    expect(model(`<a href="${href}">link</a>`)).toBe('<a>link</a>')
  })

  it.each(['#features', '#why-easyappointments', '#secci%C3%B3n'])(
    'keeps a link to %j, a heading of the document itself',
    (href) => {
      expect(model(`<a href="${href}">link</a>`)).toBe(`<a href="${href}">link</a>`)
    },
  )

  it.each(['https://example.com/a?b=1', 'http://example.com', 'mailto:someone@example.com'])(
    'keeps a link to %j',
    (href) => {
      expect(model(`<a href="${href}">link</a>`)).toBe(`<a href="${href}">link</a>`)
    },
  )

  it('takes the first of a repeated attribute, as a browser does', () => {
    expect(model('<a href="https://example.com" href="javascript:alert(1)">x</a>')).toBe(
      '<a href="https://example.com">x</a>',
    )
    // And a refused first one is not replaced by a second.
    expect(model('<td colspan="2" colspan="9999999">x</td>')).toBe('<td colspan="2">x</td>')
  })

  it.each([
    ['<td colspan="2e9">x</td>', '<td>x</td>'],
    ['<td rowspan="-1">x</td>', '<td>x</td>'],
    ['<img src="a.png" width="100%" height="40">', '<img src="a.png" width="100%" height="40"></img>'],
    ['<img src="a.png" width="calc(100vw)" height="1e9">', '<img src="a.png"></img>'],
    ['<p align="middle; position: fixed">x</p>', '<p>x</p>'],
    ['<ol start="5" type="a"><li>x</li></ol>', '<ol start="5" type="a"><li>x</li></ol>'],
    ['<ol type="disc"><li>x</li></ol>', '<ol><li>x</li></ol>'],
  ])('checks the value of an attribute it does keep: %j', (source, expected) => {
    expect(model(source)).toBe(expected)
  })
})

describe('an element nobody listed', () => {
  it('is unwrapped, so its text is not lost', () => {
    expect(model('<font color="red">red</font> and <section><p>in</p></section>')).toBe(
      'red and <p>in</p>',
    )
    expect(model('<made-up onclick="alert(1)">text</made-up>')).toBe('text')
  })

  it('cannot bring a dropped element back with it', () => {
    expect(model('<section><script>alert(1)</script>x</section>')).toBe('x')
  })
})

describe('the invariant', () => {
  const HOSTILE = [
    '<img src=x onerror=alert(1)>',
    '<svg><animate onbegin=alert(1) attributeName=x dur=1s>',
    '<a href="jav&#x09;ascript:alert(1)">x</a>',
    '<p><style><img src="</style><img src=x onerror=alert(1)>"></p>',
    '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">',
    '<form action="https://evil.example"><input name=q><button formaction="javascript:alert(1)">',
    '<div style="background:url(javascript:alert(1))" class="x" id="y">',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<details open ontoggle=alert(1)><summary>x</summary></details>',
    '<body onload=alert(1)><marquee onstart=alert(1)>x</marquee>',
    '<a href="https://example.com" target="_top" ping="https://evil.example" download>x</a>',
    '<img src="a.png" usemap="#m" ismap longdesc="javascript:alert(1)">',
    '<<script>script>alert(1)</script>',
    '<p title="&quot; onmouseover=&quot;alert(1)">x</p>',
    '</p></div><b>unbalanced',
    '<'.repeat(200),
    '<div>'.repeat(200) + 'deep' + '</div>'.repeat(200),
  ]

  const ALLOWED_ATTRIBUTES = new Set([
    'title', 'align', 'href', 'src', 'alt', 'width', 'height',
    'colspan', 'rowspan', 'start', 'type', 'open',
  ])

  it.each(HOSTILE)('holds for %j', (source) => {
    const { tags, attributes } = vocabulary(parseHtml(source).nodes)

    for (const tag of tags) {
      expect(['script', 'style', 'iframe', 'svg', 'math', 'form', 'input', 'button', 'body']).not.toContain(tag)
    }
    for (const name of attributes) {
      expect(ALLOWED_ATTRIBUTES, name).toContain(name)
      expect(name.startsWith('on')).toBe(false)
    }
  })

  it('never records a link target that is not http, https, mailto or a heading', () => {
    for (const source of HOSTILE) {
      const hrefs: string[] = []
      const walk = (nodes: readonly HtmlNode[]) => {
        for (const node of nodes) {
          if (node.kind === 'text') continue
          if (node.attributes.href !== undefined) hrefs.push(node.attributes.href)
          walk(node.children)
        }
      }
      walk(parseHtml(source).nodes)

      for (const href of hrefs) expect(href).toMatch(/^(https?:|mailto:|#)/)
    }
  })

  it('keeps a value with markup in it as a value', () => {
    const [paragraph] = parseHtml('<p title="&quot; onmouseover=&quot;alert(1)">x</p>').nodes
    expect(paragraph).toMatchObject({ tag: 'p', attributes: { title: '" onmouseover="alert(1)' } })
  })
})

describe('whether a block is replaced by its rendering', () => {
  const renderable = (source: string) => isRenderableHtml(parseHtml(source))

  it.each([
    '<p align="center">text</p>',
    '<div>\n  <img src="logo.svg" width="160">\n</div>',
    '<details><summary>More</summary>text</details>',
    '<hr>',
    '<ul><li>one<li>two</ul>',
  ])('renders %j', (source) => {
    expect(renderable(source)).toBe(true)
  })

  it.each([
    ['an opening half', '<details>\n<summary>More</summary>'],
    ['a closing half', '</details>'],
    ['a stray closing tag', '<p>text</p></div>'],
    ['an element left open', '<div><b>text</div>'],
  ])('leaves %s as source, because it is not a whole thing', (_name, source) => {
    expect(renderable(source)).toBe(false)
  })

  it.each([
    ['a script', '<script>alert(1)</script>'],
    ['a comment', '<!-- a note to self -->'],
    ['an empty element', '<div></div>'],
    ['only white space', '<p>   \n  </p>'],
  ])('leaves %s as source, because nothing of it would be visible', (_name, source) => {
    expect(renderable(source)).toBe(false)
  })
})

describe('a single inline tag', () => {
  it('reads an opening tag and its checked attributes', () => {
    expect(parseInlineTag('<kbd>')).toEqual({ name: 'kbd', kind: 'open', attributes: {} })
    expect(parseInlineTag('<a href="https://example.com" onclick="alert(1)">')).toEqual({
      name: 'a',
      kind: 'open',
      attributes: { href: 'https://example.com' },
    })
    expect(parseInlineTag('<a href="javascript:alert(1)">')).toEqual({
      name: 'a',
      kind: 'open',
      attributes: {},
    })
  })

  it('reads a closing tag', () => {
    expect(parseInlineTag('</kbd>')).toEqual({ name: 'kbd', kind: 'close', attributes: {} })
    expect(parseInlineTag('</KBD >')).toEqual({ name: 'kbd', kind: 'close', attributes: {} })
  })

  it('knows the tags that stand alone', () => {
    expect(parseInlineTag('<br>')?.kind).toBe('void')
    expect(parseInlineTag('<br/>')?.kind).toBe('void')
    expect(parseInlineTag('<img src="a.png" width="10" onerror="alert(1)">')).toEqual({
      name: 'img',
      kind: 'void',
      attributes: { src: 'a.png', width: '10' },
    })
  })

  it.each(['<script>', '</script>', '<iframe src="x">', '<made-up>', '<!-- note -->', 'text', '<>'])(
    'refuses %j',
    (source) => {
      expect(parseInlineTag(source)).toBeNull()
    },
  )
})
