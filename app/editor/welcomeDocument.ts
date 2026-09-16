/**
 * The document shown before a folder is opened.
 *
 * It is a scratch buffer: editable, backed by no file, and discarded on reload —
 * so there is nothing to lose. It also doubles as a manual smoke test, because
 * every Markdown construct in scope appears at least once.
 */
export const welcomeDocument = `# HAMDE

A local Markdown editor. Open a folder on the left to edit your own notes; this
page is a scratch buffer and is not saved anywhere.

## Inline formatting

Text can be **bold**, *italic*, ~~struck through~~ or \`inline code\`.
A [link](https://example.com) and an autolink: https://example.com

> A blockquote, for quoting things.

## Lists

- Apple
- Orange
  - Nested
- [ ] Unchecked task
- [x] Checked task

1. First
2. Second

## Table

| Language   | Kind     |
| ---------- | -------- |
| TypeScript | compiled |
| Markdown   | markup   |

## Code

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}\`
}
\`\`\`

## Diagram

\`\`\`mermaid
graph TD
    A[Open folder] --> B[Edit note]
    B --> C[Autosave]
\`\`\`
`
