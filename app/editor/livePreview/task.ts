import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

/**
 * Toggling a task list item.
 *
 * This is the only place in the app where a widget changes the document, so it is
 * kept small, pure and directly testable: given a state and a position, it returns
 * the single-character change to make, or `null` when there is no task there.
 *
 * One character is the whole point. Rewriting the line — or the marker — would risk
 * losing indentation, the list marker the user chose, or the text itself.
 */

/** `[ ]`, `[x]` or `[X]`. */
const MARKER = /^\[[ xX]\]$/

export interface TaskToggle {
  /** Position of the state character, between the brackets. */
  position: number
  /** What to write there: `x` to complete the task, a space to reopen it. */
  insert: string
  /** What the task will become, for the caller that wants to report it. */
  checked: boolean
}

export function isTaskChecked(markerText: string): boolean {
  return markerText === '[x]' || markerText === '[X]'
}

/**
 * The change that toggles the task at `position`, if there is one.
 *
 * Resolving from the position rather than from a remembered range means a widget
 * that CodeMirror reused at a different place in the document still toggles the
 * task it is actually sitting on.
 */
export function taskToggleAt(state: EditorState, position: number): TaskToggle | null {
  const marker = findTaskMarker(state, position)
  if (marker === null) return null

  const text = state.doc.sliceString(marker.from, marker.to)
  if (!MARKER.test(text)) return null

  const checked = isTaskChecked(text)
  return {
    position: marker.from + 1,
    insert: checked ? ' ' : 'x',
    checked: !checked,
  }
}

function findTaskMarker(state: EditorState, position: number): { from: number; to: number } | null {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, 1);
    node !== null;
    node = node.parent
  ) {
    if (node.name === 'TaskMarker') return { from: node.from, to: node.to }

    if (node.name === 'Task') {
      const marker = node.getChild('TaskMarker')
      return marker === null ? null : { from: marker.from, to: marker.to }
    }
  }

  return null
}
