/**
 * Placeholder document shown until the file system lands in M2.
 *
 * It doubles as a manual smoke test of the constructs the editor has to handle,
 * so every Markdown feature in scope appears at least once.
 */
export const sampleDocument = `# YAMDE

A local Markdown editor. This document is a placeholder: opening a folder arrives
in the next milestone.

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
