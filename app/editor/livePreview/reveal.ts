import type { EditorState } from '@codemirror/state'

export interface Span {
  from: number
  to: number
}

/**
 * The regions the editor shows as Markdown source instead of preview.
 *
 * The rule is one sentence, and every construct follows it: **every line touched by
 * the selection reveals its syntax**. For a paragraph that means the line the cursor
 * is on, which is what the user asked for; for a multi-line structure such as a
 * fenced block or a table, any decoration covering those lines is suppressed as a
 * unit, because a single revealed line inside a rendered structure reads as broken.
 *
 * Returned as document positions (whole lines) rather than line numbers, so callers
 * can test a decoration range against them without another lookup per node.
 */
export function revealedSpans(state: EditorState): Span[] {
  const spans: Span[] = []

  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(range.from).from
    const to = state.doc.lineAt(range.to).to

    // Selections are sorted, so an overlapping or adjacent span extends the last one.
    const last = spans.at(-1)
    if (last !== undefined && from <= last.to) {
      last.to = Math.max(last.to, to)
    } else {
      spans.push({ from, to })
    }
  }

  return spans
}

/** Whether a decoration covering [from, to) falls on a revealed line. */
export function isRevealed(spans: readonly Span[], from: number, to: number): boolean {
  return spans.some((span) => from <= span.to && to >= span.from)
}
