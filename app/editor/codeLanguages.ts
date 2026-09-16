import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'
import type { StreamParser } from '@codemirror/language'

/**
 * Languages available inside fenced code blocks.
 *
 * Every one is loaded on demand. `lang-markdown` resolves a fence's info string
 * against this list and, when the language is not loaded yet, parses the block as
 * plain text and re-parses it once the import resolves
 * (`ParseContext.getSkippingParser`). So a document with one SQL block downloads the
 * SQL grammar and nothing else.
 *
 * Adding a language here is adding a chunk to the build, not to the initial load —
 * with one exception: JavaScript, HTML and CSS are already in the main bundle
 * whatever we do, because `lang-markdown` imports `lang-html` to highlight HTML tags
 * in Markdown, and `lang-html` embeds the JavaScript and CSS parsers for `<script>`
 * and `<style>`. See docs/dependencies.md.
 */

/** Wraps a CodeMirror 5 stream parser, for languages with no Lezer grammar. */
async function legacy(parser: Promise<StreamParser<unknown>>): Promise<LanguageSupport> {
  return new LanguageSupport(StreamLanguage.define(await parser))
}

export const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({
    name: 'javascript',
    alias: ['js', 'jsx', 'node'],
    async load() {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript({ jsx: true })
    },
  }),
  LanguageDescription.of({
    name: 'typescript',
    alias: ['ts', 'tsx'],
    async load() {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript({ typescript: true, jsx: true })
    },
  }),
  LanguageDescription.of({
    name: 'json',
    alias: ['jsonc'],
    async load() {
      const { json } = await import('@codemirror/lang-json')
      return json()
    },
  }),
  LanguageDescription.of({
    name: 'html',
    alias: ['htm', 'vue'],
    async load() {
      const { html } = await import('@codemirror/lang-html')
      // Matching closing tags is for authoring HTML, not for reading a snippet.
      return html({ matchClosingTags: false, autoCloseTags: false })
    },
  }),
  LanguageDescription.of({
    name: 'css',
    alias: ['scss', 'less'],
    async load() {
      const { css } = await import('@codemirror/lang-css')
      return css()
    },
  }),
  LanguageDescription.of({
    name: 'sql',
    alias: ['postgres', 'postgresql', 'mysql', 'tsql'],
    async load() {
      const { sql } = await import('@codemirror/lang-sql')
      return sql()
    },
  }),
  LanguageDescription.of({
    name: 'xml',
    alias: ['xsl', 'xsd', 'svg'],
    async load() {
      const { xml } = await import('@codemirror/lang-xml')
      return xml()
    },
  }),
  LanguageDescription.of({
    name: 'yaml',
    alias: ['yml'],
    async load() {
      const { yaml } = await import('@codemirror/lang-yaml')
      return yaml()
    },
  }),
  LanguageDescription.of({
    name: 'bash',
    alias: ['sh', 'shell', 'zsh', 'console'],
    load: () => legacy(import('@codemirror/legacy-modes/mode/shell').then((m) => m.shell)),
  }),
  LanguageDescription.of({
    name: 'powershell',
    alias: ['ps', 'ps1', 'pwsh'],
    // The export is `powerShell`, not `powershell`.
    load: () =>
      legacy(import('@codemirror/legacy-modes/mode/powershell').then((m) => m.powerShell)),
  }),
  LanguageDescription.of({
    name: 'csharp',
    alias: ['cs', 'c#', 'dotnet'],
    load: () => legacy(import('@codemirror/legacy-modes/mode/clike').then((m) => m.csharp)),
  }),
]
