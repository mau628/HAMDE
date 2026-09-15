import { describe, expect, it } from 'vitest'

import { createMarkdownSupport } from '../../app/editor/markdown'

const parser = createMarkdownSupport().language.parser

/** Every node name that appears in the parse tree of `source`. */
function nodeNames(source: string): Set<string> {
  const names = new Set<string>()
  parser.parse(source).iterate({
    enter: (node) => {
      names.add(node.name)
    },
  })
  return names
}

describe('GFM support', () => {
  // `markdown()` defaults to commonmarkLanguage, which silently lacks all of the
  // below. These tests exist so that regression cannot go unnoticed.
  it('parses tables', () => {
    const names = nodeNames('| A | B |\n| - | - |\n| 1 | 2 |\n')
    expect(names).toContain('Table')
    expect(names).toContain('TableHeader')
    expect(names).toContain('TableRow')
  })

  it('parses task lists', () => {
    const names = nodeNames('- [ ] todo\n- [x] done\n')
    expect(names).toContain('Task')
    expect(names).toContain('TaskMarker')
  })

  it('parses strikethrough', () => {
    const names = nodeNames('~~gone~~')
    expect(names).toContain('Strikethrough')
    expect(names).toContain('StrikethroughMark')
  })

  it('parses autolinks', () => {
    expect(nodeNames('see https://example.com now')).toContain('URL')
  })
})

describe('CommonMark support', () => {
  it('parses headings with their markers', () => {
    const names = nodeNames('## Heading\n')
    expect(names).toContain('ATXHeading2')
    expect(names).toContain('HeaderMark')
  })

  it('parses emphasis and strong emphasis separately', () => {
    const names = nodeNames('*a* and **b**')
    expect(names).toContain('Emphasis')
    expect(names).toContain('StrongEmphasis')
    expect(names).toContain('EmphasisMark')
  })

  it('parses inline code and fenced code', () => {
    expect(nodeNames('`x`')).toContain('InlineCode')

    const fenced = nodeNames('```ts\nconst a = 1\n```\n')
    expect(fenced).toContain('FencedCode')
    expect(fenced).toContain('CodeInfo')
  })

  it('parses links and images with their marks', () => {
    const names = nodeNames('[text](https://example.com) ![alt](image.png)')
    expect(names).toContain('Link')
    expect(names).toContain('Image')
    expect(names).toContain('LinkMark')
  })

  it('parses blockquotes and lists', () => {
    expect(nodeNames('> quoted\n')).toContain('Blockquote')

    const bullet = nodeNames('- one\n- two\n')
    expect(bullet).toContain('BulletList')
    expect(bullet).toContain('ListMark')

    expect(nodeNames('1. one\n2. two\n')).toContain('OrderedList')
  })

  it('treats a multi-line fenced block as a single structure', () => {
    // The live preview depends on this: a fenced block is one node even though it
    // spans lines, so it can be decorated as a unit rather than line by line.
    const source = '```\nline one\nline two\n```\n'
    const fence = parser.parse(source).topNode.firstChild
    expect(fence?.name).toBe('FencedCode')
    expect(fence?.from).toBe(0)
    // The whole block, both fences included, is one node.
    expect(fence?.to).toBe(source.trimEnd().length)
  })

  it('does not execute or strip embedded HTML: it stays in the document as markup', () => {
    const source = '<script>alert(1)</script>\n'
    const names = nodeNames(source)
    expect([...names].some((name) => name.startsWith('HTML'))).toBe(true)
  })
})
