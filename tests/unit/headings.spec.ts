import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import { fragmentOf, headingPosition, headingSlug } from '../../app/editor/livePreview/headings'
import { createMarkdownSupport } from '../../app/editor/markdown'

/**
 * Links to a heading of the same document, which is what the table of contents at
 * the top of a README is made of. The name of a heading is derived the way GitHub
 * derives it, since that is where these links are written to work.
 */

/** The line a fragment leads to, or null. */
function lineFor(doc: string, fragment: string): string | null {
  const state = EditorState.create({ doc, extensions: [createMarkdownSupport()] })
  const position = headingPosition(state, fragment)
  return position === null ? null : state.doc.lineAt(position).text
}

describe('the name of a heading', () => {
  it.each([
    ['Features', 'features'],
    ['Quick Start', 'quick-start'],
    ['Why Easy!Appointments', 'why-easyappointments'],
    ['What is new in v2.0?', 'what-is-new-in-v20'],
    ['snake_case and kebab-case', 'snake_case-and-kebab-case'],
    ['  Padded  ', 'padded'],
    ['Two  spaces', 'two--spaces'],
    ['Instalación rápida', 'instalación-rápida'],
    ['日本語の見出し', '日本語の見出し'],
    ['C# & .NET', 'c--net'],
    ['🚀 Launch', '-launch'],
  ])('%j is %j', (text, slug) => {
    expect(headingSlug(text)).toBe(slug)
  })
})

describe('finding the heading a link names', () => {
  const DOC = [
    '# Project',
    '',
    '[Features](#features) and [Quick Start](#quick-start)',
    '',
    '## Why Easy!Appointments',
    '',
    'Because.',
    '',
    '## Features',
    '',
    '### Quick Start',
    '',
    'Setext one',
    '==========',
    '',
    '## A **bold** and `coded` [linked](https://example.com) title ##',
    '',
  ].join('\n')

  it.each([
    ['project', '# Project'],
    ['features', '## Features'],
    ['quick-start', '### Quick Start'],
    ['why-easyappointments', '## Why Easy!Appointments'],
    ['setext-one', 'Setext one'],
  ])('#%s leads to %j', (fragment, line) => {
    expect(lineFor(DOC, fragment)).toBe(line)
  })

  it('names a heading by its text, not by the syntax around it', () => {
    expect(lineFor(DOC, 'a-bold-and-coded-linked-title')).toBe(
      '## A **bold** and `coded` [linked](https://example.com) title ##',
    )
  })

  it('is not put off by capitals or by an encoded character', () => {
    expect(lineFor(DOC, 'Features')).toBe('## Features')
    expect(lineFor('## Instalación\n', 'instalaci%C3%B3n')).toBe('## Instalación')
    expect(lineFor('## Instalación\n', 'instalación')).toBe('## Instalación')
  })

  it('tells headings with the same text apart, in order', () => {
    const doc = '## Usage\n\none\n\n## Usage\n\ntwo\n\n## Usage\n\nthree\n'
    const state = EditorState.create({ doc, extensions: [createMarkdownSupport()] })

    expect(headingPosition(state, 'usage')).toBe(0)
    expect(headingPosition(state, 'usage-1')).toBe(doc.indexOf('## Usage', 1))
    expect(headingPosition(state, 'usage-2')).toBe(doc.lastIndexOf('## Usage'))
    expect(headingPosition(state, 'usage-3')).toBeNull()
  })

  it('finds a heading inside a quote or a list', () => {
    expect(lineFor('> ## Quoted\n', 'quoted')).toBe('> ## Quoted')
    expect(lineFor('- ## Listed\n', 'listed')).toBe('- ## Listed')
  })

  it.each(['missing', '', 'features/', 'because'])('leads nowhere for #%s', (fragment) => {
    expect(lineFor(DOC, fragment)).toBeNull()
  })

  it('does not take a line of code that looks like a heading for one', () => {
    expect(lineFor('```\n# not a heading\n```\n', 'not-a-heading')).toBeNull()
  })

  it('survives a fragment that is not valid encoding', () => {
    expect(lineFor(DOC, '%E0%A4%A')).toBeNull()
  })
})

describe('telling a link into the document from any other', () => {
  it.each([
    ['#features', 'features'],
    ['  #quick-start ', 'quick-start'],
  ])('%j is one', (href, fragment) => {
    expect(fragmentOf(href)).toBe(fragment)
  })

  it.each(['https://example.com/#features', 'notes.md#features', '#', '', 'features'])(
    '%j is not',
    (href) => {
      expect(fragmentOf(href)).toBeNull()
    },
  )
})
