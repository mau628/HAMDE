import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { LanguageSupport } from '@codemirror/language'

import { codeLanguages } from './codeLanguages'

/**
 * Markdown language support for the editor.
 *
 * `markdown()` defaults to `commonmarkLanguage`, which has NO GFM: no tables, no
 * task lists, no strikethrough, no autolinks. `markdownLanguage` is the GFM-enabled
 * parser (plus subscript, superscript and emoji, which are harmless extras).
 * Passing `base` explicitly is therefore not optional — see
 * tests/unit/markdown-language.spec.ts, which fails if this regresses.
 *
 * Fenced code blocks are parsed by the language named in their info string, loaded
 * on demand. See codeLanguages.ts.
 */
export function createMarkdownSupport(): LanguageSupport {
  return markdown({
    base: markdownLanguage,
    codeLanguages,
    // Enter continues lists and Backspace deletes list markup — behaviour users
    // expect from a Markdown editor, and already implemented upstream.
    addKeymap: true,
    // We never complete HTML tags: embedded HTML is displayed as text, not authored.
    completeHTMLTags: false,
  })
}
