import { ensureSyntaxTree, LanguageDescription } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { NodeProp } from '@lezer/common'
import { describe, expect, it } from 'vitest'

import { codeLanguages } from '../../app/editor/codeLanguages'
import { buildPreviewDecorations } from '../../app/editor/livePreview/decorations'
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

  it('hides nothing inside a fenced block', async () => {
    await LanguageDescription.matchLanguageName(codeLanguages, 'javascript', true)!.load()

    const doc = '```javascript\nconst s = "**bold** and [a](b)"\n```\n'
    const state = EditorState.create({ doc, extensions: [createMarkdownSupport()] })

    const { hidden } = buildPreviewDecorations(state, [{ from: 0, to: doc.length }])

    let count = 0
    hidden.between(0, doc.length, () => {
      count += 1
    })
    expect(count).toBe(0)
  })
})
