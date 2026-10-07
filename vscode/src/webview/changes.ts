import type { ChangeSet, Text } from '@codemirror/state'

import type { Position, Shape, TextChange } from '../protocol'

/**
 * Translates between CodeMirror's offsets and the protocol's positions.
 *
 * Only CodeMirror's document model is used here, no DOM, so this is unit-tested.
 */

export function positionAt(doc: Text, offset: number): Position {
  const line = doc.lineAt(offset)
  return { line: line.number - 1, character: offset - line.from }
}

/**
 * The offset of a position, clamped into the document.
 *
 * Clamped rather than trusted: if the copies have drifted a position may not exist
 * here, and the shape check that follows is what reports it. Throwing would stop
 * the editor instead.
 */
export function offsetAt(doc: Text, position: Position): number {
  if (position.line >= doc.lines) return doc.length

  const line = doc.line(position.line + 1)
  return Math.min(line.from + position.character, line.to)
}

/** A user edit, with every position referring to the document before it. */
export function toTextChanges(changes: ChangeSet, before: Text): TextChange[] {
  const result: TextChange[] = []

  changes.iterChanges((from, to, _fromAfter, _toAfter, inserted) => {
    result.push({
      start: positionAt(before, from),
      end: positionAt(before, to),
      // Line breaks go out as `\n`; VS Code writes them as the file's own.
      text: inserted.toString(),
    })
  })

  return result
}

export function shapeOf(doc: Text): Shape {
  return { length: doc.length, lines: doc.lines }
}
