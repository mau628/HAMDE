import { describe, expect, it } from 'vitest'

import { createMarkdownSupport } from '../../app/editor/markdown'

const parser = createMarkdownSupport().language.parser

/**
 * Prints the parse tree with each node's text, so the live preview can be written
 * against the shape the parser actually produces rather than an assumed one.
 *
 * These assertions double as documentation: if the parser changes the structure the
 * decoration code relies on, they fail here rather than producing odd rendering.
 */
function shape(source: string): string {
  const lines: string[] = []
  parser.parse(source).iterate({
    enter: (node) => {
      const text = source.slice(node.from, node.to).replace(/\n/g, '\\n')
      lines.push('  '.repeat(depth(node.node)) + node.name + ' ' + JSON.stringify(text))
    },
  })
  return lines.join('\n')
}

function depth(node: { parent: unknown } | null): number {
  let level = 0
  let current = node as { parent: { parent: unknown } | null } | null
  while (current?.parent) {
    level += 1
    current = current.parent as { parent: { parent: unknown } | null } | null
  }
  return level
}

describe('parse tree shapes the live preview depends on', () => {
  it('heading', () => {
    expect(shape('## Hello **world**\n')).toMatchInlineSnapshot(`
      "Document "## Hello **world**\\\\n"
        ATXHeading2 "## Hello **world**"
          HeaderMark "##"
          StrongEmphasis "**world**"
            EmphasisMark "**"
            EmphasisMark "**""
    `)
  })

  it('emphasis', () => {
    expect(shape('a **b** c *d* e ~~f~~ g `h`\n')).toMatchInlineSnapshot(`
      "Document "a **b** c *d* e ~~f~~ g \`h\`\\\\n"
        Paragraph "a **b** c *d* e ~~f~~ g \`h\`"
          StrongEmphasis "**b**"
            EmphasisMark "**"
            EmphasisMark "**"
          Emphasis "*d*"
            EmphasisMark "*"
            EmphasisMark "*"
          Strikethrough "~~f~~"
            StrikethroughMark "~~"
            StrikethroughMark "~~"
          InlineCode "\`h\`"
            CodeMark "\`"
            CodeMark "\`""
    `)
  })

  it('blockquote', () => {
    expect(shape('> quoted\n> more\n')).toMatchInlineSnapshot(`
      "Document "> quoted\\\\n> more\\\\n"
        Blockquote "> quoted\\\\n> more"
          QuoteMark ">"
          Paragraph "quoted\\\\n> more"
            QuoteMark ">""
    `)
  })

  it('bullet list', () => {
    expect(shape('- one\n- two\n')).toMatchInlineSnapshot(`
      "Document "- one\\\\n- two\\\\n"
        BulletList "- one\\\\n- two"
          ListItem "- one"
            ListMark "-"
            Paragraph "one"
          ListItem "- two"
            ListMark "-"
            Paragraph "two""
    `)
  })

  it('ordered list', () => {
    expect(shape('1. one\n2. two\n')).toMatchInlineSnapshot(`
      "Document "1. one\\\\n2. two\\\\n"
        OrderedList "1. one\\\\n2. two"
          ListItem "1. one"
            ListMark "1."
            Paragraph "one"
          ListItem "2. two"
            ListMark "2."
            Paragraph "two""
    `)
  })

  it('task list', () => {
    expect(shape('- [ ] todo\n- [x] done\n')).toMatchInlineSnapshot(`
      "Document "- [ ] todo\\\\n- [x] done\\\\n"
        BulletList "- [ ] todo\\\\n- [x] done"
          ListItem "- [ ] todo"
            ListMark "-"
            Task "[ ] todo"
              TaskMarker "[ ]"
          ListItem "- [x] done"
            ListMark "-"
            Task "[x] done"
              TaskMarker "[x]""
    `)
  })

  it('link', () => {
    expect(shape('see [text](https://example.com "title")\n')).toMatchInlineSnapshot(`
      "Document "see [text](https://example.com \\"title\\")\\\\n"
        Paragraph "see [text](https://example.com \\"title\\")"
          Link "[text](https://example.com \\"title\\")"
            LinkMark "["
            LinkMark "]"
            LinkMark "("
            URL "https://example.com"
            LinkTitle "\\"title\\""
            LinkMark ")""
    `)
  })

  it('autolink', () => {
    expect(shape('see https://example.com now\n')).toMatchInlineSnapshot(`
      "Document "see https://example.com now\\\\n"
        Paragraph "see https://example.com now"
          URL "https://example.com""
    `)
  })

  it('image', () => {
    expect(shape('![alt](cat.png)\n')).toMatchInlineSnapshot(`
      "Document "![alt](cat.png)\\\\n"
        Paragraph "![alt](cat.png)"
          Image "![alt](cat.png)"
            LinkMark "!["
            LinkMark "]"
            LinkMark "("
            URL "cat.png"
            LinkMark ")""
    `)
  })

  it('horizontal rule', () => {
    expect(shape('---\n')).toMatchInlineSnapshot(`
      "Document "---\\\\n"
        HorizontalRule "---""
    `)
  })

  it('setext heading', () => {
    expect(shape('Title\n=====\n')).toMatchInlineSnapshot(`
      "Document "Title\\\\n=====\\\\n"
        SetextHeading1 "Title\\\\n====="
          HeaderMark "=====""
    `)
  })

  it('fenced code', () => {
    expect(shape('```ts\nconst a = 1\n```\n')).toMatchInlineSnapshot(`
      "Document "\`\`\`ts\\\\nconst a = 1\\\\n\`\`\`\\\\n"
        FencedCode "\`\`\`ts\\\\nconst a = 1\\\\n\`\`\`"
          CodeMark "\`\`\`"
          CodeInfo "ts"
          CodeText "const a = 1"
          CodeMark "\`\`\`""
    `)
  })

  it('nested list', () => {
    expect(shape('- one\n  - nested\n')).toMatchInlineSnapshot(`
      "Document "- one\\\\n  - nested\\\\n"
        BulletList "- one\\\\n  - nested"
          ListItem "- one\\\\n  - nested"
            ListMark "-"
            Paragraph "one"
            BulletList "- nested"
              ListItem "- nested"
                ListMark "-"
                Paragraph "nested""
    `)
  })

  it('closed atx heading', () => {
    expect(shape('## Hi ##\n')).toMatchInlineSnapshot(`
      "Document "## Hi ##\\\\n"
        ATXHeading2 "## Hi ##"
          HeaderMark "##"
          HeaderMark "##""
    `)
  })

  it('reference link without a URL', () => {
    expect(shape('[text][ref]\n\n[ref]: https://example.com\n')).toMatchInlineSnapshot(`
      "Document "[text][ref]\\\\n\\\\n[ref]: https://example.com\\\\n"
        Paragraph "[text][ref]"
          Link "[text][ref]"
            LinkMark "["
            LinkMark "]"
            LinkLabel "[ref]"
        LinkReference "[ref]: https://example.com"
          LinkLabel "[ref]"
          LinkMark ":"
          URL "https://example.com""
    `)
  })

  it('bracketed autolink', () => {
    expect(shape('<https://example.com> and [a](<https://x.com>)\n')).toMatchInlineSnapshot(`
      "Document "<https://example.com> and [a](<https://x.com>)\\\\n"
        Paragraph "<https://example.com> and [a](<https://x.com>)"
          Autolink "<https://example.com>"
            LinkMark "<"
            URL "https://example.com"
            LinkMark ">"
          Link "[a](<https://x.com>)"
            LinkMark "["
            LinkMark "]"
            LinkMark "("
            URL "<https://x.com>"
            LinkMark ")""
    `)
  })

  it('link across two lines', () => {
    expect(shape('[a](\nhttps://x.com)\n')).toMatchInlineSnapshot(`
      "Document "[a](\\\\nhttps://x.com)\\\\n"
        Paragraph "[a](\\\\nhttps://x.com)"
          Link "[a](\\\\nhttps://x.com)"
            LinkMark "["
            LinkMark "]"
            LinkMark "("
            URL "https://x.com"
            LinkMark ")""
    `)
  })

  it('unterminated fence', () => {
    expect(shape('```\ncode\n')).toMatchInlineSnapshot(`
      "Document "\`\`\`\\\\ncode\\\\n"
        FencedCode "\`\`\`\\\\ncode\\\\n"
          CodeMark "\`\`\`"
          CodeText "code\\\\n""
    `)
  })

  it('table', () => {
    expect(shape('| a | b |\n| - | - |\n| 1 | 2 |\n')).toMatchInlineSnapshot(`
      "Document "| a | b |\\\\n| - | - |\\\\n| 1 | 2 |\\\\n"
        Table "| a | b |\\\\n| - | - |\\\\n| 1 | 2 |"
          TableHeader "| a | b |"
            TableDelimiter "|"
            TableCell "a"
            TableDelimiter "|"
            TableCell "b"
            TableDelimiter "|"
          TableDelimiter "| - | - |"
          TableRow "| 1 | 2 |"
            TableDelimiter "|"
            TableCell "1"
            TableDelimiter "|"
            TableCell "2"
            TableDelimiter "|""
    `)
  })

  /**
   * The rendered table counts its columns from the separators rather than from the
   * cells, because of this: an empty cell produces no `TableCell` at all.
   */
  it('table with an empty cell', () => {
    expect(shape('| a | b |\n| - | - |\n| 1 |  |\n')).toMatchInlineSnapshot(`
      "Document "| a | b |\\\\n| - | - |\\\\n| 1 |  |\\\\n"
        Table "| a | b |\\\\n| - | - |\\\\n| 1 |  |"
          TableHeader "| a | b |"
            TableDelimiter "|"
            TableCell "a"
            TableDelimiter "|"
            TableCell "b"
            TableDelimiter "|"
          TableDelimiter "| - | - |"
          TableRow "| 1 |  |"
            TableDelimiter "|"
            TableCell "1"
            TableDelimiter "|"
            TableDelimiter "|""
    `)
  })

  /** An escaped pipe is an `Escape` inside the cell, and does not end it. */
  it('table with an escaped pipe', () => {
    expect(shape('| a \\| b | c |\n| - | - |\n')).toMatchInlineSnapshot(`
      "Document "| a \\\\| b | c |\\\\n| - | - |\\\\n"
        Table "| a \\\\| b | c |\\\\n| - | - |"
          TableHeader "| a \\\\| b | c |"
            TableDelimiter "|"
            TableCell "a \\\\| b"
              Escape "\\\\|"
            TableDelimiter "|"
            TableCell "c"
            TableDelimiter "|"
          TableDelimiter "| - | - |""
    `)
  })

  /** Alignment lives in the one `TableDelimiter` that is a child of the table. */
  it('table with alignment', () => {
    expect(shape('| a | b |\n| :- | -: |\n| 1 | 2 |\n')).toMatchInlineSnapshot(`
      "Document "| a | b |\\\\n| :- | -: |\\\\n| 1 | 2 |\\\\n"
        Table "| a | b |\\\\n| :- | -: |\\\\n| 1 | 2 |"
          TableHeader "| a | b |"
            TableDelimiter "|"
            TableCell "a"
            TableDelimiter "|"
            TableCell "b"
            TableDelimiter "|"
          TableDelimiter "| :- | -: |"
          TableRow "| 1 | 2 |"
            TableDelimiter "|"
            TableCell "1"
            TableDelimiter "|"
            TableCell "2"
            TableDelimiter "|""
    `)
  })
})
