import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import { isTaskChecked, taskToggleAt } from '../../app/editor/livePreview/task'
import { createMarkdownSupport } from '../../app/editor/markdown'

/**
 * Toggling a task is the one place a widget changes the document, so it is tested
 * the way the document deserves: by applying the change and comparing the whole
 * text, character for character.
 */

function stateFor(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [createMarkdownSupport()] })
}

/** Applies the toggle at `position` and returns the resulting document. */
function toggled(doc: string, position: number): string {
  const state = stateFor(doc)
  const toggle = taskToggleAt(state, position)
  if (toggle === null) return doc

  return state
    .update({ changes: { from: toggle.position, to: toggle.position + 1, insert: toggle.insert } })
    .state.doc.toString()
}

/** A position inside the task marker of the first line containing `needle`. */
function markerIn(doc: string, needle: string): number {
  const index = doc.indexOf(needle)
  if (index === -1) throw new Error('fixture does not contain ' + needle)
  return index + 1
}

describe('isTaskChecked', () => {
  it.each([
    ['[x]', true],
    ['[X]', true],
    ['[ ]', false],
  ])('reads %s as %s', (marker, expected) => {
    expect(isTaskChecked(marker)).toBe(expected)
  })
})

describe('toggling', () => {
  it('completes an open task', () => {
    expect(toggled('- [ ] todo\n', markerIn('- [ ] todo\n', '[ ]'))).toBe('- [x] todo\n')
  })

  it('reopens a completed task', () => {
    expect(toggled('- [x] done\n', markerIn('- [x] done\n', '[x]'))).toBe('- [ ] done\n')
  })

  it('reopens a task marked with a capital X', () => {
    expect(toggled('- [X] done\n', markerIn('- [X] done\n', '[X]'))).toBe('- [ ] done\n')
  })

  it('changes exactly one character', () => {
    const doc = '- [ ] todo\n'
    const state = stateFor(doc)
    const toggle = taskToggleAt(state, markerIn(doc, '[ ]'))!

    expect(toggle.position).toBe(3)
    expect(toggle.insert).toHaveLength(1)
  })

  it('reports what the task becomes', () => {
    const doc = '- [ ] todo\n'
    expect(taskToggleAt(stateFor(doc), markerIn(doc, '[ ]'))?.checked).toBe(true)
    expect(taskToggleAt(stateFor('- [x] a\n'), markerIn('- [x] a\n', '[x]'))?.checked).toBe(false)
  })
})

describe('the rest of the line survives', () => {
  it.each([
    ['a dash marker', '- [ ] todo\n', '- [x] todo\n'],
    ['an asterisk marker', '* [ ] todo\n', '* [x] todo\n'],
    ['a plus marker', '+ [ ] todo\n', '+ [x] todo\n'],
    ['an ordered marker', '1. [ ] todo\n', '1. [x] todo\n'],
    ['space indentation', '  - [ ] todo\n', '  - [x] todo\n'],
    ['deep nesting', '- a\n  - b\n    - [ ] deep\n', '- a\n  - b\n    - [x] deep\n'],
    ['inline formatting', '- [ ] **bold** and `code`\n', '- [x] **bold** and `code`\n'],
    ['a trailing link', '- [ ] see [docs](https://example.com)\n', '- [x] see [docs](https://example.com)\n'],
    ['brackets in the text', '- [ ] an [array] of things\n', '- [x] an [array] of things\n'],
  ])('preserves %s', (_label, doc, expected) => {
    expect(toggled(doc, markerIn(doc, '[ ]'))).toBe(expected)
  })

  it('touches only the task that was clicked', () => {
    const doc = '- [ ] first\n- [ ] second\n- [ ] third\n'
    const secondMarker = doc.indexOf('[ ]', doc.indexOf('second') - 10) + 1

    expect(toggled(doc, secondMarker)).toBe('- [ ] first\n- [x] second\n- [ ] third\n')
  })

  it('toggles a nested task without touching its parent', () => {
    const doc = '- [ ] parent\n  - [ ] child\n'
    const childMarker = doc.lastIndexOf('[ ]') + 1

    expect(toggled(doc, childMarker)).toBe('- [ ] parent\n  - [x] child\n')
  })

  it('toggles a task inside a blockquote', () => {
    const doc = '> - [ ] quoted task\n'
    expect(toggled(doc, markerIn(doc, '[ ]'))).toBe('> - [x] quoted task\n')
  })
})

describe('positions that are not a task', () => {
  it.each([
    ['plain text', 'just a paragraph\n'],
    ['a list item that is not a task', '- an item\n'],
    ['an empty document', ''],
    ['brackets that are not a marker', '- [] todo\n'],
    ['a link at the start of an item', '- [text](https://example.com)\n'],
  ])('returns nothing for %s', (_label, doc) => {
    expect(taskToggleAt(stateFor(doc), Math.min(3, doc.length))).toBeNull()
  })

  it('returns nothing for a tab-indented line, which CommonMark reads as code', () => {
    // A tab or four spaces at the top level is an indented code block, so there is
    // no Task node to toggle. Indented *inside* a list it is a nested task, which
    // the nesting test above covers.
    const doc = '\t- [ ] todo\n'
    expect(taskToggleAt(stateFor(doc), doc.indexOf('[ ]') + 1)).toBeNull()
  })

  it('returns nothing for a task marker inside a fenced code block', () => {
    // The parser does not produce a Task node there, so nothing is clickable and
    // nothing can be toggled.
    const doc = '```\n- [ ] not a task\n```\n'
    expect(taskToggleAt(stateFor(doc), doc.indexOf('[ ]') + 1)).toBeNull()
  })

  it('returns nothing for text that merely looks like a marker', () => {
    const doc = 'a sentence with [ ] in it\n'
    expect(taskToggleAt(stateFor(doc), doc.indexOf('[ ]') + 1)).toBeNull()
  })
})

describe('positions around the marker', () => {
  const doc = '- [ ] todo\n'

  it.each([
    ['at its start', 2],
    ['inside it', 3],
    ['at its end', 4],
    ['in the task text', 7],
  ])('finds the task from a position %s', (_label, position) => {
    expect(taskToggleAt(stateFor(doc), position)).not.toBeNull()
  })

  it('does not find a task from the list marker before it', () => {
    // Position 0 is the "-", which belongs to the ListItem, not to the Task.
    expect(taskToggleAt(stateFor(doc), 0)).toBeNull()
  })
})
