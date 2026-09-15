import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { LanguageSupport } from '@codemirror/language'

/**
 * Markdown language support for the editor.
 *
 * `markdown()` defaults to `commonmarkLanguage`, which has NO GFM: no tables, no
 * task lists, no strikethrough, no autolinks. `markdownLanguage` is the GFM-enabled
 * parser (plus subscript, superscript and emoji, which are harmless extras).
 * Passing `base` explicitly is therefore not optional — see
 * tests/unit/markdown-language.spec.ts, which fails if this regresses.
 *
 * Code block languages are wired up in M7; until then fenced code is parsed as
 * an opaque block, which is what the live preview needs anyway.
 */
export function createMarkdownSupport(): LanguageSupport {
  return markdown({
    base: markdownLanguage,
    // Enter continues lists and Backspace deletes list markup — behaviour users
    // expect from a Markdown editor, and already implemented upstream.
    addKeymap: true,
    // We never complete HTML tags: embedded HTML is displayed as text, not authored.
    completeHTMLTags: false,
  })
}
