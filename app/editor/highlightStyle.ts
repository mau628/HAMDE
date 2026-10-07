import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

/**
 * Syntax highlighting for code, and for Markdown punctuation while it is revealed.
 *
 * Markdown presentation itself — heading sizes, bold, italic, links, inline code —
 * belongs to the live preview decorations and their classes in assets/css/markdown.css.
 * Duplicating it here is not merely redundant but wrong: a `fontSize` rule on a
 * heading token nests inside the line's own `fontSize` rule and the two multiply, so
 * a level-one heading rendered at 1.7em twice came out at 2.9em.
 *
 * What is left here is what the syntax tree knows and CSS classes cannot express:
 * the token types inside fenced code blocks (M7), and the colour of Markdown
 * punctuation on the line the cursor has revealed.
 */
export const markdownHighlightStyle = HighlightStyle.define([
  // Markdown punctuation: the asterisks, hashes, backticks and list markers that
  // become visible on the cursor's line. Muted, so revealing a line is not loud.
  { tag: tags.processingInstruction, color: 'var(--color-syntax-mark)' },
  { tag: tags.contentSeparator, color: 'var(--color-syntax-mark)' },
  // The language name on a fence (`CodeInfo`) is syntax too, not content.
  { tag: tags.labelName, color: 'var(--color-text-muted)' },

  // Code tokens, used once fenced blocks get their own parsers (M7).
  { tag: tags.keyword, color: 'var(--color-syntax-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--color-syntax-string)' },
  { tag: tags.comment, color: 'var(--color-text-muted)', fontStyle: 'italic' },
  { tag: tags.number, color: 'var(--color-syntax-number)' },
  { tag: tags.bool, color: 'var(--color-syntax-number)' },
  { tag: tags.null, color: 'var(--color-syntax-number)' },
  { tag: tags.atom, color: 'var(--color-syntax-number)' },
  // A shebang, a doctype, a decorator: about the code rather than part of it.
  { tag: tags.meta, color: 'var(--color-text-muted)' },
  { tag: tags.operator, color: 'var(--color-syntax-mark)' },
  { tag: tags.punctuation, color: 'var(--color-syntax-mark)' },
  {
    // `standard` is a name the language itself provides. In a shell snippet that
    // is the command (`npm`, `git`, `echo`), which is most of what there is to
    // colour: without it a block of shell commands looked like plain text.
    tag: [
      tags.function(tags.variableName),
      tags.definition(tags.variableName),
      tags.standard(tags.variableName),
    ],
    color: 'var(--color-syntax-function)',
  },
  { tag: [tags.typeName, tags.className], color: 'var(--color-syntax-type)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--color-syntax-property)' },
  { tag: tags.tagName, color: 'var(--color-syntax-keyword)' },
])
