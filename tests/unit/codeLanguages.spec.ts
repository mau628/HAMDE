import { ensureSyntaxTree, LanguageDescription } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { NodeProp } from '@lezer/common'
import { highlightTree } from '@lezer/highlight'
import { describe, expect, it } from 'vitest'

import { codeLanguages } from '../../app/editor/codeLanguages'
import { buildPreviewDecorations } from '../../app/editor/livePreview/decorations'
import { markdownHighlightStyle } from '../../app/editor/highlightStyle'
import { createMarkdownSupport } from '../../app/editor/markdown'

/**
 * Fenced code highlighting.
 *
 * The risk here is not logic, it is wiring: an import path that does not exist, an
 * export that is named something else, or an info string nobody matches. Every
 * language is therefore actually loaded and actually used to parse a snippet.
 */

const EXPECTED = [
  'javascript',
  'typescript',
  'json',
  'html',
  'css',
  'sql',
  'xml',
  'yaml',
  'bash',
  'ini',
  'powershell',
  'csharp',
]

/** Parses a fenced block and returns the language mounted inside it, if any. */
async function mountedLanguage(info: string, code: string): Promise<string | null> {
  const description = LanguageDescription.matchLanguageName(codeLanguages, info, true)
  if (description !== null) await description.load()

  const doc = '```' + info + '\n' + code + '\n```\n'
  const state = EditorState.create({ doc, extensions: [createMarkdownSupport()] })
  const tree = ensureSyntaxTree(state, doc.length, 10_000)
  if (tree === null) return null

  let mounted: string | null = null
  tree.iterate({
    enter: (node) => {
      const mount = node.node.tree?.prop(NodeProp.mounted)
      if (mount) mounted = mount.tree.type.name
    },
  })
  return mounted
}

describe('the language list', () => {
  it('covers every language the project committed to', () => {
    expect(codeLanguages.map((language) => language.name)).toEqual(EXPECTED)
  })

  it.each(EXPECTED)('loads %s', async (name) => {
    const description = codeLanguages.find((language) => language.name === name)!

    const support = await description.load()

    expect(support.language).toBeDefined()
    expect(support.language.parser).toBeDefined()
  })
})

describe('matching an info string', () => {
  it.each([
    ['js', 'javascript'],
    ['jsx', 'javascript'],
    ['ts', 'typescript'],
    ['tsx', 'typescript'],
    ['yml', 'yaml'],
    ['sh', 'bash'],
    ['shell', 'bash'],
    ['zsh', 'bash'],
    ['ini', 'ini'],
    ['properties', 'ini'],
    ['conf', 'ini'],
    ['ps1', 'powershell'],
    ['pwsh', 'powershell'],
    ['cs', 'csharp'],
    ['c#', 'csharp'],
    ['postgres', 'sql'],
    ['svg', 'xml'],
    ['scss', 'css'],
  ])('resolves %j to %s', (info, expected) => {
    expect(LanguageDescription.matchLanguageName(codeLanguages, info, true)?.name).toBe(expected)
  })

  it.each(['JavaScript', 'SQL', 'YAML', 'PowerShell'])('is case-insensitive for %s', (info) => {
    expect(LanguageDescription.matchLanguageName(codeLanguages, info, true)).not.toBeNull()
  })

  it('matches nothing for a language we do not carry', () => {
    expect(LanguageDescription.matchLanguageName(codeLanguages, 'brainfuck', false)).toBeNull()
  })
})

describe('parsing a fenced block with its language', () => {
  it.each([
    ['javascript', 'const a = 1', 'Script'],
    ['typescript', 'const a: string = "x"', 'Script'],
    ['json', '{"a": 1}', 'JsonText'],
    ['css', 'a { color: red; }', 'StyleSheet'],
    ['html', '<p>hi</p>', 'Document'],
    ['sql', 'select 1', 'Script'],
    ['xml', '<a><b/></a>', 'Document'],
    ['yaml', 'key: value', 'Stream'],
  ])('mounts a %s parser', async (info, code, expected) => {
    expect(await mountedLanguage(info, code)).toBe(expected)
  })

  it.each([
    ['bash', 'echo "hi"'],
    ['ini', '[section]\nkey = value'],
    ['powershell', 'Write-Output "hi"'],
    ['csharp', 'var a = 1;'],
  ])('mounts the legacy %s mode', async (info, code) => {
    // Stream parsers produce a tree of their own; the name is an implementation
    // detail, so it is enough that something was mounted.
    expect(await mountedLanguage(info, code)).not.toBeNull()
  })

  it('leaves a block with an unknown language unparsed, without breaking', async () => {
    expect(await mountedLanguage('brainfuck', '++++.')).toBeNull()
  })

  it('leaves a block with no info string unparsed', async () => {
    expect(await mountedLanguage('', 'plain text')).toBeNull()
  })
})

/** The pieces of a fenced block's code that the highlight style gives a colour. */
async function coloured(info: string, code: string): Promise<string[]> {
  await LanguageDescription.matchLanguageName(codeLanguages, info, true)!.load()

  const doc = '```' + info + '\n' + code + '\n```\n'
  const state = EditorState.create({ doc, extensions: [createMarkdownSupport()] })
  const tree = ensureSyntaxTree(state, doc.length, 10_000)!
  const start = doc.indexOf('\n') + 1
  const end = start + code.length

  const pieces: string[] = []
  highlightTree(tree, markdownHighlightStyle, (from, to) => {
    if (from >= start && to <= end) pieces.push(doc.slice(from, to).trim())
  })
  return pieces
}

describe('colouring what a parser finds', () => {
  // A language that parses but is not coloured looks exactly like one that is not
  // supported. That is what a block of shell commands looked like: the parser
  // knew `npm` was a command, and nothing gave commands a colour.
  it('colours the command, the flag, the string and the comment of a shell line', async () => {
    const pieces = await coloured('bash', 'npm install --save "left-pad" # why')

    expect(pieces).toEqual(expect.arrayContaining(['npm', '--save', '"left-pad"', '# why']))
  })

  it('colours a shell variable and a keyword', async () => {
    const pieces = await coloured('bash', 'if true; then echo $HOME; fi')

    expect(pieces).toEqual(expect.arrayContaining(['if', 'true', 'then', 'echo', '$HOME', 'fi']))
  })

  it('colours the section, the key, the value and the comment of an ini file', async () => {
    const pieces = await coloured('ini', '[core]\nname = value\n; note')

    expect(pieces).toEqual(expect.arrayContaining(['[core]', 'name', 'value', '; note']))
  })

  it('does not colour a blockquote or a heading on the way', async () => {
    // The ini parser calls a section a `header` and a value a `quote`, which are
    // the names Markdown uses for a heading and a blockquote. Colouring those
    // names instead of renaming them would have coloured prose.
    const doc = '# Heading\n\n> quoted text\n'
    const state = EditorState.create({ doc, extensions: [createMarkdownSupport()] })
    const tree = ensureSyntaxTree(state, doc.length, 10_000)!

    const pieces: string[] = []
    highlightTree(tree, markdownHighlightStyle, (from, to) => pieces.push(doc.slice(from, to)))

    expect(pieces.join('|')).not.toContain('Heading')
    expect(pieces.join('|')).not.toContain('quoted text')
  })
})

describe('code is not Markdown', () => {
  it('does not decorate anything inside a fenced block', async () => {
    await LanguageDescription.matchLanguageName(codeLanguages, 'css', true)!.load()

    // CSS has a url() token, and a naive walk would style it as a Markdown URL.
    // The decoration walk never enters a mounted language tree, so it cannot.
    const doc = '```css\na { background: url(https://x.com/i.png); }\n```\n'
    const state = EditorState.create({ doc, extensions: [createMarkdownSupport()] })

    const { decorations } = buildPreviewDecorations(state, [{ from: 0, to: doc.length }])

    const classes = new Set<string>()
    decorations.between(0, doc.length, (_from, _to, value) => {
      const className = value.spec.class
      if (typeof className === 'string') for (const part of className.split(' ')) classes.add(part)
    })

    // The whole block is styled as code, and nothing in it is styled as Markdown.
    expect(classes).toContain('cm-md-code-line')
    expect(classes).not.toContain('cm-md-url')
    expect(classes).not.toContain('cm-md-link')
  })

  it('hides nothing inside a fenced block but its fences', async () => {
    await LanguageDescription.matchLanguageName(codeLanguages, 'javascript', true)!.load()

    const doc = '```javascript\nconst s = "**bold** and [a](b)"\n```\n'
    // The cursor is past the block, so the block is drawn rather than revealed.
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [createMarkdownSupport()],
    })

    const { hidden } = buildPreviewDecorations(state, [{ from: 0, to: doc.length }])

    const texts: string[] = []
    hidden.between(0, doc.length, (from, to) => {
      texts.push(doc.slice(from, to))
    })
    expect(texts).toEqual(['```javascript', '```'])
  })
})
