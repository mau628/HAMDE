import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import { buildPreviewDecorations } from '../../app/editor/livePreview/decorations'
import { isRevealed, revealedSpans } from '../../app/editor/livePreview/reveal'
import { createMarkdownSupport } from '../../app/editor/markdown'

/**
 * The live preview is tested through its decoration builder rather than through a
 * browser: given a document and a cursor position, it must produce an exact set of
 * hidden ranges and styling. No DOM is involved, so these run in milliseconds and
 * say precisely what went wrong.
 */

/**
 * Every fixture ends with a newline, so a cursor at the end of the document sits on
 * the trailing empty line and reveals nothing. Tests pass a large number to mean
 * "cursor somewhere else entirely"; it is clamped here.
 */
function stateFor(doc: string, cursor = 0): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(Math.min(cursor, doc.length)),
    extensions: [createMarkdownSupport()],
  })
}

/** The document as the user sees it: hidden ranges removed. */
function rendered(doc: string, cursor = 0): string {
  const state = stateFor(doc, cursor)
  const { hidden } = buildPreviewDecorations(state, [{ from: 0, to: doc.length }])

  let output = ''
  let position = 0
  const cursorIterator = hidden.iter()

  while (cursorIterator.value !== null) {
    output += state.doc.sliceString(position, cursorIterator.from)
    // A replacement with a widget shows the widget; mark it so tests can see it.
    if (cursorIterator.value.spec.widget !== undefined) output += '•'
    position = cursorIterator.to
    cursorIterator.next()
  }

  return output + state.doc.sliceString(position)
}

/** Classes applied to the text between `from` and `to`. */
function classesOn(doc: string, from: number, to: number, cursor = 0): string[] {
  const state = stateFor(doc, cursor)
  const { decorations } = buildPreviewDecorations(state, [{ from: 0, to: doc.length }])

  const found: string[] = []
  decorations.between(from, to, (rangeFrom, rangeTo, value) => {
    const className = value.spec.class
    if (typeof className === 'string' && rangeFrom <= from && rangeTo >= to) {
      found.push(...className.split(' '))
    }
  })
  return found
}

/** Every class the decoration set mentions, anywhere. */
function allClasses(doc: string, cursor = 0): string[] {
  const state = stateFor(doc, cursor)
  const { decorations } = buildPreviewDecorations(state, [{ from: 0, to: doc.length }])

  const found = new Set<string>()
  decorations.between(0, doc.length, (_from, _to, value) => {
    const className = value.spec.class
    if (typeof className === 'string') for (const part of className.split(' ')) found.add(part)
  })
  return [...found]
}

describe('reveal rule', () => {
  it('reveals the whole line the cursor sits on', () => {
    const state = stateFor('one\ntwo\nthree\n', 5)
    expect(revealedSpans(state)).toEqual([{ from: 4, to: 7 }])
  })

  it('reveals every line a selection touches', () => {
    const state = EditorState.create({
      doc: 'one\ntwo\nthree\n',
      selection: EditorSelection.range(2, 9),
    })
    expect(revealedSpans(state)).toEqual([{ from: 0, to: 13 }])
  })

  it('merges adjacent cursors into one span', () => {
    const state = EditorState.create({
      doc: 'one\ntwo\n',
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(2)]),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    })
    expect(revealedSpans(state)).toEqual([{ from: 0, to: 3 }])
  })

  it('keeps separate cursors on separate lines apart', () => {
    const state = EditorState.create({
      doc: 'one\ntwo\nthree\n',
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(10)]),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    })
    expect(revealedSpans(state)).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 13 },
    ])
  })

  it('treats a decoration as revealed when it touches a revealed line', () => {
    const spans = [{ from: 4, to: 7 }]
    expect(isRevealed(spans, 4, 6)).toBe(true)
    expect(isRevealed(spans, 0, 3)).toBe(false)
  })
})

describe('headings', () => {
  it('hides the marker and the space after it', () => {
    expect(rendered('## Hello\n', 100)).toBe('Hello\n')
  })

  it('hides markers at every level', () => {
    expect(rendered('# a\n## b\n### c\n#### d\n##### e\n###### f\n', 100)).toBe('a\nb\nc\nd\ne\nf\n')
  })

  it('hides the closing marker of a closed heading, with its space', () => {
    expect(rendered('## Hi ##\n', 100)).toBe('Hi\n')
  })

  it('shows the marker when the cursor is on the line', () => {
    expect(rendered('## Hello\n', 3)).toBe('## Hello\n')
  })

  it('styles the line by level whether revealed or not', () => {
    expect(allClasses('### Hello\n', 100)).toContain('cm-md-h3')
    expect(allClasses('### Hello\n', 2)).toContain('cm-md-h3')
  })

  it('leaves a setext underline visible, because hiding a line is not allowed here', () => {
    expect(rendered('Title\n=====\n', 100)).toBe('Title\n=====\n')
    expect(allClasses('Title\n=====\n', 100)).toContain('cm-md-h1')
  })

  it('does not treat a hash without a space as a heading', () => {
    expect(rendered('#nothashtag\n', 100)).toBe('#nothashtag\n')
  })
})

describe('inline formatting', () => {
  it('hides bold markers', () => {
    expect(rendered('a **b** c\n', 100)).toBe('a b c\n')
  })

  it('hides italic markers', () => {
    expect(rendered('a *b* c\n', 100)).toBe('a b c\n')
  })

  it('hides strikethrough markers', () => {
    expect(rendered('a ~~b~~ c\n', 100)).toBe('a b c\n')
  })

  it('hides inline code backticks', () => {
    expect(rendered('run `npm test` now\n', 100)).toBe('run npm test now\n')
  })

  it('handles bold and italic together', () => {
    expect(rendered('***both***\n', 100)).toBe('both\n')
  })

  it('styles the content', () => {
    expect(classesOn('a **b** c\n', 4, 5, 100)).toContain('cm-md-strong')
    expect(classesOn('a *b* c\n', 3, 4, 100)).toContain('cm-md-emphasis')
  })

  it('reveals the markers on the cursor line only', () => {
    const doc = 'a **b** c\nd **e** f\n'
    expect(rendered(doc, 0)).toBe('a **b** c\nd e f\n')
    expect(rendered(doc, 12)).toBe('a b c\nd **e** f\n')
  })

  it('leaves unbalanced markers alone', () => {
    expect(rendered('a **b c\n', 100)).toBe('a **b c\n')
    expect(rendered('a ** b\n', 100)).toBe('a ** b\n')
  })

  it('leaves formatting inside inline code as literal text', () => {
    expect(rendered('`**not bold**`\n', 100)).toBe('**not bold**\n')
  })

  it('leaves formatting inside a fenced block untouched', () => {
    const doc = '```\n**not bold**\n```\n'
    expect(rendered(doc, 100)).toBe(doc)
  })
})

describe('blockquotes', () => {
  it('hides the marker on every line', () => {
    expect(rendered('> one\n> two\n', 100)).toBe('one\ntwo\n')
  })

  it('reveals only the marker on the cursor line', () => {
    expect(rendered('> one\n> two\n', 2)).toBe('> one\ntwo\n')
  })

  it('styles every line of the quote', () => {
    expect(allClasses('> one\n> two\n', 100)).toContain('cm-md-quote')
  })

  it('handles a nested quote', () => {
    expect(rendered('> > deep\n', 100)).toBe('deep\n')
  })
})

describe('lists', () => {
  it('replaces a bullet marker with a bullet', () => {
    expect(rendered('- one\n', 100)).toBe('• one\n')
  })

  it('accepts the other bullet characters', () => {
    expect(rendered('* one\n', 100)).toBe('• one\n')
    expect(rendered('+ one\n', 100)).toBe('• one\n')
  })

  it('keeps an ordered marker, because the number is content', () => {
    expect(rendered('1. one\n2. two\n', 100)).toBe('1. one\n2. two\n')
  })

  it('shows the raw marker on the cursor line', () => {
    expect(rendered('- one\n- two\n', 2)).toBe('- one\n• two\n')
  })

  it('handles nested bullets', () => {
    expect(rendered('- one\n  - nested\n', 100)).toBe('• one\n  • nested\n')
  })

  it('replaces a task marker with a checkbox', () => {
    // Both the bullet and the checkbox are widgets, which `rendered` marks the same
    // way; what matters here is that the raw `[ ]` is gone.
    expect(rendered('- [ ] todo\n', 100)).toBe('• • todo\n')
  })
})

describe('links', () => {
  it('shows the text and hides the target', () => {
    expect(rendered('see [text](https://example.com)\n', 100)).toBe('see text\n')
  })

  it('hides a link title as well', () => {
    expect(rendered('[text](https://example.com "t")\n', 100)).toBe('text\n')
  })

  it('reveals the whole link on the cursor line', () => {
    const doc = '[text](https://example.com)\n'
    expect(rendered(doc, 3)).toBe(doc)
  })

  it('styles the link text', () => {
    expect(classesOn('[text](https://example.com)\n', 1, 5, 100)).toContain('cm-md-link')
  })

  it('leaves a reference link intact, because its label is meaningful', () => {
    const doc = '[text][ref]\n\n[ref]: https://example.com\n'
    expect(rendered(doc, 100)).toBe(doc)
  })

  it('styles an autolink without hiding anything', () => {
    expect(rendered('see https://example.com now\n', 100)).toBe('see https://example.com now\n')
    expect(allClasses('see https://example.com now\n', 100)).toContain('cm-md-url')
  })

  it('leaves an image as source, since images are rendered later', () => {
    expect(rendered('![alt](cat.png)\n', 100)).toBe('![alt](cat.png)\n')
  })
})

describe('cases that used to render wrong', () => {
  it('keeps the indentation that shows a list is nested inside a quote', () => {
    // Hiding all the whitespace after ">" collapsed the nesting, so a child item
    // rendered flush with its parent. Only one space belongs to the marker.
    expect(rendered('> - a\n>   - b\n', 1000)).toBe('• a\n  • b\n')
  })

  it('hides the indentation of an indented heading along with its marker', () => {
    expect(rendered('   ## indented\n', 1000)).toBe('indented\n')
  })

  it('leaves a link whose destination wraps as plain source', () => {
    // Hiding it would have to cover a line break, which a view plugin may not do.
    expect(rendered('[a](\nhttps://x.com)\n', 1000)).toBe('[a](\nhttps://x.com)\n')
    expect(rendered('[a](https://x.com "ti\ntle")\n', 1000)).toBe('[a](https://x.com "ti\ntle")\n')
  })

  it('leaves a link with no text as source, rather than rendering nothing at all', () => {
    expect(rendered('[](https://x.com)\n', 1000)).toBe('[](https://x.com)\n')
  })

  it('hides the angle brackets of a bracketed autolink', () => {
    expect(rendered('<https://example.com>\n', 1000)).toBe('https://example.com\n')
  })

  it('does not style the line after an unterminated fence', () => {
    const doc = '```\ncode\n'
    const state = stateFor(doc, doc.length)
    const { decorations } = buildPreviewDecorations(state, [{ from: 0, to: doc.length }])

    const codeLines: number[] = []
    decorations.between(0, doc.length, (from, _to, value) => {
      if (value.spec.class === 'cm-md-code-line') codeLines.push(from)
    })

    // Lines 1 and 2 only. The node ends at the start of line 3, which is not part
    // of the block.
    expect(codeLines).toEqual([0, 4])
  })

  it('renders an empty closed heading without overlapping replacements', () => {
    expect(rendered('## ##\n', 1000)).toBe('\n')
  })
})

describe('tables, rules and code blocks', () => {
  it('keeps a table as editable source and styles its lines', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |\n'
    expect(rendered(doc, 100)).toBe(doc)
    expect(allClasses(doc, 100)).toContain('cm-md-table-line')
  })

  it('keeps a horizontal rule visible and styles the line', () => {
    expect(rendered('---\n', 100)).toBe('---\n')
    expect(allClasses('---\n', 100)).toContain('cm-md-rule')
  })

  it('styles every line of a fenced block, fences included', () => {
    expect(allClasses('```\ncode\n```\n', 100)).toContain('cm-md-code-line')
  })
})

describe('invariants', () => {
  const documents = [
    '# Heading\n\nSome **bold** and *italic* text.\n',
    '> quote with **bold**\n> second line\n',
    '- [ ] task with `code`\n- [x] done ~~struck~~\n',
    '| a | b |\n| - | - |\n| 1 | 2 |\n',
    '```ts\nconst a = 1\n```\n',
    'Title\n=====\n\ntext\n',
    '[text](https://example.com) and https://example.com\n',
    '***\n\n- one\n  - two\n    - three\n',
    'unbalanced ** and *** and ~~ and `\n',
    '#\n##\n###\n',
    // Each of the following used to break something.
    // A link whose destination or title wraps: hiding it covered a line break, and
    // CodeMirror throws for that in a view plugin.
    '[a](\nhttps://x.com)\n',
    '[a](https://x.com "ti\ntle")\n',
    // A heading with no content: the opening and closing markers hid overlapping
    // ranges, because each skipped the same whitespace from its own side.
    '## ##\n',
    '#   #\n',
    // A fence still being typed: its node ends at the start of the following line.
    '```\ncode\n',
    '[](https://x.com)\n',
    '   ## indented\n',
    '<https://example.com> and ![alt](cat.png)\n',
    '> - a\n>   - b\n',
  ]

  it.each(documents)('no replacement crosses a line break: %j', (doc) => {
    const state = stateFor(doc, doc.length)
    const { hidden } = buildPreviewDecorations(state, [{ from: 0, to: doc.length }])

    const crossings: string[] = []
    hidden.between(0, doc.length, (from, to) => {
      if (state.doc.sliceString(from, to).includes('\n')) {
        crossings.push(JSON.stringify(state.doc.sliceString(from, to)))
      }
    })

    // A view plugin may not replace a line break, so this must always be empty.
    expect(crossings).toEqual([])
  })

  it.each(documents)('no two hidden ranges overlap: %j', (doc) => {
    const state = stateFor(doc, doc.length)
    const { hidden } = buildPreviewDecorations(state, [{ from: 0, to: doc.length }])

    const overlaps: string[] = []
    let previousTo = -1
    hidden.between(0, doc.length, (from, to) => {
      if (from < previousTo) overlaps.push(from + '-' + to)
      previousTo = Math.max(previousTo, to)
    })

    // Overlapping replacements are never intended, and they are also atomic ranges,
    // so an overlap would make cursor motion unpredictable.
    expect(overlaps).toEqual([])
  })

  it.each(documents)('never loses or reorders visible text: %j', (doc) => {
    // Everything that is not hidden syntax must still be there, in order.
    const withCursorAway = rendered(doc, doc.length)
    const stripped = withCursorAway.replace(/•/g, '')

    let index = 0
    for (const character of stripped) {
      index = doc.indexOf(character, index)
      expect(index).toBeGreaterThanOrEqual(0)
      index += 1
    }
  })

  it.each(documents)('reveals the document in full when everything is selected: %j', (doc) => {
    const state = EditorState.create({
      doc,
      selection: EditorSelection.range(0, doc.length),
      extensions: [createMarkdownSupport()],
    })
    const { hidden } = buildPreviewDecorations(state, [{ from: 0, to: doc.length }])

    let count = 0
    hidden.between(0, doc.length, () => {
      count += 1
    })
    expect(count).toBe(0)
  })

  it('produces no decorations for an empty document', () => {
    const state = stateFor('', 0)
    const { decorations, hidden } = buildPreviewDecorations(state, [{ from: 0, to: 0 }])
    expect(decorations.size).toBe(0)
    expect(hidden.size).toBe(0)
  })

  it('does not decorate, or even walk, past the range it was given', () => {
    // A structure much longer than the viewport must cost the viewport, not the
    // document: this used to emit a line decoration for all 200 quoted lines.
    const doc = '> quoted line\n'.repeat(200)
    const state = stateFor(doc, doc.length)
    const { decorations } = buildPreviewDecorations(state, [{ from: 0, to: 40 }])

    let beyond = 0
    decorations.between(60, doc.length, () => {
      beyond += 1
    })
    expect(beyond).toBe(0)
  })

  it('does not decorate outside the range it was given', () => {
    const doc = '# one\n\n# two\n'
    const state = stateFor(doc, doc.length)
    const { decorations } = buildPreviewDecorations(state, [{ from: 0, to: 5 }])

    let beyond = 0
    decorations.between(7, doc.length, () => {
      beyond += 1
    })
    expect(beyond).toBe(0)
  })
})
