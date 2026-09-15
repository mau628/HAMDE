# Live preview

Markdown renders in place, and the line the cursor is on shows its syntax. There is
one editor, one document, and no preview pane.

## The rule

> Every line touched by the selection shows its raw syntax. Any decoration that
> intersects one of those lines is suppressed.

That single predicate produces the behaviour for every construct. On a paragraph it
means the line under the cursor, which is what a writer expects. On a structure that
spans lines — a fenced block, a table, a Mermaid diagram (M8) — it means the whole
structure, because one revealed line inside a rendered structure reads as broken.

There is no per-construct special case, and `revealedSpans` is the only place the
rule is expressed.

## Parsing is never per line

Although the rule talks about lines, nothing is parsed line by line. Decorations come
from the whole-document syntax tree that CodeMirror already maintains, so multi-line
structures are understood as structures: `tests/unit/treeShape.spec.ts` pins the exact
tree shapes the decoration code relies on, and fails if the parser changes them.

## Why a view plugin, and what that forbids

Decorations can be provided directly or through a plugin, and CodeMirror is explicit
about the difference:

> Only decoration sets provided directly are allowed to influence the editor's
> vertical layout structure. The ones provided as functions are called after the new
> viewport has been computed, and thus **must not** introduce block widgets or
> replacing decorations that cover line breaks.

The inline layer is a plugin, which means it only ever sees the viewport. Measured on
a 20,000-line, 1.3 MB document: 159 ms to open, 40 line elements in the DOM, and one
frame (~17 ms) per cursor move. An end-to-end test asserts the DOM stays bounded, so
a future change that walks the whole document fails loudly instead of quietly making
large files slow.

The price is that **no replacement here may cover a newline**. Two consequences:

- A setext heading (`Title` over `=====`) keeps its underline visible. Hiding it would
  mean removing a line, which is a vertical layout change.
- The rendered Mermaid diagram (M8) replaces a whole block, so it has to come from a
  state field provided directly, not from this plugin.

A unit test asserts the invariant directly: for a set of documents including malformed
ones, no hidden range contains a `\n`.

## What renders, and what deliberately does not

| Construct | Preview |
| --- | --- |
| Headings | Marker hidden, line styled by level. Size stays constant when revealed, so text does not jump as the cursor moves |
| Bold, italic, strikethrough, inline code | Markers hidden, content styled |
| Blockquote | `>` hidden per line, line indented with a rule |
| Bullet list | Marker replaced with a bullet widget |
| Ordered list | Number kept — it is content the user chose |
| Link | Text shown, `[`, `](url "title")` hidden; Ctrl/Cmd+click opens it |
| Autolink | Styled, nothing hidden |
| Reference link | Left intact: the label matters to the reader |
| Table | Styled as monospace source, never replaced — it stays editable |
| Horizontal rule | Line styled with a border, dashes kept |
| Fenced code | Lines styled as a code block; highlighting arrives in M7 |
| Image | Left as source until M9 renders local images |
| Task list | `[ ]` left as text until M6 makes it a checkbox |

## Cursor motion

Hidden ranges are also provided to `EditorView.atomicRanges`, so arrow keys step over
invisible syntax in one move. Only the hidden ranges are atomic; styled text stays
navigable character by character, or whole words would become unselectable.

## The document is never modified

This is presentation only: `## Hello **world**` stays exactly that in the editor state
and on disk. Clicking a rendered bullet or heading moves the cursor there, which
reveals the source — the widget's `ignoreEvent` returns `false` so a click behaves
like a click anywhere else.

The only place a widget will ever change the document is the task checkbox in M6, and
it changes exactly one character.
