import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

/**
 * Syntax highlighting for the source view.
 *
 * Colours come from CSS custom properties so light and dark themes are handled in
 * one place (assets/css/editor.css). Structural sizing (heading scale, monospace
 * code) lives here because it has to follow the syntax tree.
 *
 * From M5 on, the live preview hides most of the punctuation these rules style;
 * what remains visible is the text on the line the cursor is on.
 */
export const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.7em', fontWeight: '600', lineHeight: '1.3' },
  { tag: tags.heading2, fontSize: '1.45em', fontWeight: '600', lineHeight: '1.3' },
  { tag: tags.heading3, fontSize: '1.25em', fontWeight: '600' },
  { tag: tags.heading4, fontSize: '1.1em', fontWeight: '600' },
  { tag: tags.heading5, fontWeight: '600' },
  { tag: tags.heading6, fontWeight: '600', color: 'var(--color-text-muted)' },

  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },

  { tag: tags.link, color: 'var(--color-accent)' },
  { tag: tags.url, color: 'var(--color-accent)', textDecoration: 'underline' },

  { tag: tags.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.92em' },
  { tag: tags.quote, color: 'var(--color-text-muted)' },

  // Markdown punctuation: the asterisks, hashes, backticks and list bullets.
  // Muted here, hidden by the live preview when the cursor is elsewhere.
  { tag: tags.processingInstruction, color: 'var(--color-syntax-mark)' },
  { tag: tags.contentSeparator, color: 'var(--color-syntax-mark)' },

  // Tags used once fenced code blocks get their own parsers (M7).
  { tag: tags.keyword, color: 'var(--color-syntax-keyword)' },
  { tag: tags.string, color: 'var(--color-syntax-string)' },
  { tag: tags.comment, color: 'var(--color-text-muted)', fontStyle: 'italic' },
  { tag: tags.number, color: 'var(--color-syntax-number)' },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: 'var(--color-syntax-function)' },
  { tag: [tags.typeName, tags.className], color: 'var(--color-syntax-type)' },
])
