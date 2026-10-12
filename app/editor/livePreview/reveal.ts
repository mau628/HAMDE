import { StateEffect, StateField, type EditorState } from '@codemirror/state'

export interface Span {
  from: number
  to: number
}

/** Turns printing on or off. Dispatched by `print.ts`, around the print itself. */
export const setPrinting = StateEffect.define<boolean>()

/**
 * Whether the document is being drawn for paper.
 *
 * Paper has no cursor, so nothing is revealed while this is set: the selection is
 * left where it is and simply stops counting.
 */
export const printingField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setPrinting)) value = effect.value
    }
    return value
  },
})

/** False for a state without the field, so the layers also work on their own. */
export function isPrinting(state: EditorState): boolean {
  return state.field(printingField, false) ?? false
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

  if (isPrinting(state)) return spans

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
