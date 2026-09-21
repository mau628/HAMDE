import { syntaxTree } from '@codemirror/language'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/**
 * Typing the third backtick of a fence at the start of a line closes it too:
 * the cursor lands on an empty line between the two fences.
 *
 * Skipped inside an existing fenced block, where a typed fence is the *closing* one
 * and adding another would swallow the rest of the document.
 */
export const codeFenceCompletion = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '`' || from !== to) return false

  const state = view.state
  if (state.selection.ranges.length !== 1) return false

  const line = state.doc.lineAt(from)
  const before = state.doc.sliceString(line.from, from)
  if (!/^ {0,3}``$/.test(before)) return false
  if (state.doc.sliceString(from, line.to).trim() !== '') return false

  for (let node = syntaxTree(state).resolveInner(from, -1).parent; node; node = node.parent) {
    if (node.name === 'FencedCode') return false
  }

  const insert = '`\n\n' + before.slice(0, before.length - 2) + '```'
  view.dispatch({
    changes: { from, to: line.to, insert },
    selection: EditorSelection.cursor(from + 2),
    userEvent: 'input.type',
  })
  return true
})
