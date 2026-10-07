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

Both ends of that are enforced rather than remembered:

- `eachLine` and the tree walk are clamped to the range being decorated, so a
  20,000-line blockquote costs the viewport and not the document. Without the
  clamp one long quoted block made every cursor move a whole-document walk (56 ms
  per keystroke, measured).
- `hide()` clamps every range to the end of the line it starts on, so no construct
  can hand CodeMirror a newline. It throws `Decorations that replace line breaks
  may not be specified via plugins` if one does, which takes the editor down —
  an inline link whose destination wrapped onto the next line did exactly that.

The price is that **no replacement here may cover a newline**. Two consequences:

- A setext heading (`Title` over `=====`) keeps its underline visible. Hiding it would
  mean removing a line, which is a vertical layout change.
- A rendered Mermaid diagram or table replaces a whole block, so it comes from a
  state field provided directly (`blockPreview.ts`) rather than from the plugin.

A unit test asserts the invariant directly: for a set of documents including malformed
ones, no hidden range contains a `\n`.

## What renders, and what deliberately does not

| Construct | Preview |
| --- | --- |
| Headings | Marker hidden, line styled by level. Size stays constant when revealed, so text does not jump as the cursor moves. A title and a subtitle (levels 1 and 2) have a rule under them, as a rendered document has |
| Bold, italic, strikethrough, inline code | Markers hidden, content styled |
| Blockquote | `>` hidden per line, line indented with a rule |
| Bullet list | Marker replaced with a bullet widget |
| Ordered list | Number kept — it is content the user chose |
| Any list | Indented by how deeply it is nested, with the marker hanging so that wrapped lines start where the item's text does |
| Link | Text shown, `[`, `](url "title")` hidden; Ctrl/Cmd+click opens it. A link with no text, or one whose destination wraps onto another line, stays as source |
| Autolink | Styled; a bracketed autolink (`<https://…>`) has its brackets hidden |
| Reference link | Left intact: the label matters to the reader |
| Table | Replaced by a rendered grid, with column alignment and the inline Markdown in each cell. Click a cell, or arrow into it, to edit the source. A table inside a blockquote or a list stays as source |
| Horizontal rule | Drawn as a rule. Its characters show only on the line the cursor is on |
| Fenced code | Lines styled as a code block, with the language highlighted. The fences, and the language name with them, show only while the cursor is somewhere in the block |
| HTML block | A safe subset is drawn in place of its source: see [HTML](#html). Click it, or arrow into it, to edit the source |
| Inline HTML | `<kbd>`, `<sub>`, `<sup>`, `<u>`, `<mark>` and the like style their content and have their tags hidden, as `**bold**` does. `<br>` breaks the line, and `<img>` is an image with a size |
| Mermaid | Replaced by the rendered diagram. Click it, or arrow into it, to see the source |
| Image | Rendered when the file is in the workspace, through a `blob:` URL, or when the source is an `https:` address. Any other source (`http:`, `data:`) stays as Markdown, and a path that climbs out of the folder is not resolved at all |
| Task list | `[ ]` becomes a real checkbox; clicking it changes one character in the document |

## Cursor motion

Hidden ranges are also provided to `EditorView.atomicRanges`, so arrow keys step over
invisible syntax in one move. Only the hidden ranges are atomic; styled text stays
navigable character by character, or whole words would become unselectable.

## The document is never modified

This is presentation only: `## Hello **world**` stays exactly that in the editor state
and on disk. Clicking a rendered bullet or heading moves the cursor there, which
reveals the source — the widget's `ignoreEvent` returns `false` so a click behaves
like a click anywhere else.

The one exception is the task checkbox, and it is deliberately the smallest change
the editor can make: a single character between the brackets. The indentation, the
list marker the user chose and the text are left untouched, which
`tests/unit/task.spec.ts` asserts by comparing whole documents.

The checkbox is a real `<input type="checkbox">`, so it is focusable and responds
to Space. CodeMirror renders widgets with `contenteditable="false"` and ignores
events inside them by default, so the browser's own checkbox behaviour works
untouched. Clicking it does not move the cursor, which matters: if it did, the
line would reveal its source and the box the user just clicked would disappear
from under them.

## Rendering decisions that look like bugs

- **A quote marker takes one space, not all of them.** `>` followed by three spaces
  is a marker plus indentation, and inside a blockquote indentation is what
  distinguishes a nested list from a sibling one. Hiding all of it collapsed the
  nesting.
- **An indented heading loses its indentation too.** Markdown allows up to three
  leading spaces; hiding only the `##` left the text indented while its neighbours
  were flush.
- **An empty closed heading (`## ##`) renders as an empty line.** There is nothing
  between the markers to show.
- **A fence still being typed does not style the line below it.** An unterminated
  `FencedCode` node ends at the start of the following line, which is not part of
  the block.

- **A hidden fence leaves its line behind.** Only the text of a fence line is
  hidden; the line stays, as the top or bottom margin of the block. Removing a line
  is a vertical layout change, which this layer may not make, and it would make the
  block jump every time the cursor entered it. As it is, a block is exactly as tall
  drawn as revealed.
- **The fences are hidden as a pair, by block.** The cursor anywhere in the block
  shows both, which is the rule every multi-line structure follows. Showing them
  only while the cursor sat on a fence line would leave no way to see which
  language a block is in while editing its code.
- **A rule is an element as tall as its line**, with the stroke drawn across its
  middle. A hairline element left most of the line as empty space, and a browser
  asked what is at a point in empty space answers with the nearest text, which may
  be on another line. The arrow keys then stepped over the rule instead of onto
  it — but only in documents whose first line was a setext heading, because that
  line is what CodeMirror measured to decide how far an arrow key moves.
- **List indentation is by depth, not by the spaces in the source.** A few spaces
  in a proportional font are almost nothing, so a nested list sat all but flush
  with its parent. Each line of an item carries a class for its depth, and the
  source indentation is left where it is, so nothing moves when a line is revealed.
- **The `-` of a revealed list line is as wide as its bullet.** Otherwise the text
  of every item would step sideways as the cursor passed over it.

## The block layer

A second layer exists for structures replaced as a whole — a Mermaid diagram, a
table and a block of HTML. It is a state field, provided directly, because that is the only way to
introduce a block widget.

What that costs and how it is paid:

- **It cannot see the viewport**, so the scan walks the document. It only descends
  into nodes that can contain a block, and only re-runs when the document or the
  parse tree changes — a cursor move rebuilds the decorations from the blocks
  already found, with no tree walk.
- **The parse tree can be incomplete** in a state field. The parser reports its
  progress to the view as a transaction, so comparing the trees inside `update` is
  what catches a diagram in a part of a large document the parser had not reached.

Two decisions that came out of trying the obvious thing first:

- **Replaced blocks are not atomic.** Atomic ranges are right for hidden inline
  syntax, where the caret should not stall on invisible characters. For a block
  they are wrong: making the diagram atomic made it unreachable — arrow keys
  jumped over it and a click landed outside it, so the source could never be
  opened.
- **Entering a block is handled explicitly.** Clicking the widget dispatches a
  cursor into the block, and ArrowUp/ArrowDown are bound above the default keymap
  so a vertical move that would jump a whole block lands inside it instead.
  Neither works by default for a block that occupies no lines in the layout.

## Mermaid

Mermaid is the largest dependency in the project — around 1.5 MB, a third of that
after compression — so it is imported dynamically and only when a diagram is
actually drawn. A document with no diagram downloads none of it, and neither does
a document whose diagram is open as source.

Rendered diagrams are cached by their source, so moving the cursor around a
document never re-renders one. An invalid diagram shows the parse error with the
source underneath, and becomes a drawing again as soon as it parses.

The SVG is the only markup this app gives to a browser parser, and it does not go
in through `innerHTML`: it is parsed with `DOMParser` and scrubbed of script
elements, event-handler attributes and unsafe link targets first. See
docs/security.md.

### Known limitation

The diagram theme is the app's theme (the one chosen with the theme button, or the
system colour scheme if none was chosen) at the moment the first diagram renders.
Switching the theme afterwards, in the app or in the system, needs a reload for
diagrams to follow.

## Tables

Until M10 a table was styled source in a monospace font, on the grounds that it
stayed editable. It did — and it also meant the one construct whose whole purpose is
to line data up was the one construct the reader had to line up in their head. A
table is now a table.

Editing survives, and not by accident:

- **The cursor anywhere in the table shows the source**, in the same monospace
  styling as before. That comes free from the reveal rule: a block replacement is
  suppressed for any line the selection touches.
- **A click lands in the cell that was clicked.** The block's own start is not
  enough: every correction would begin by hunting for the right pipe. Each cell
  carries its offset from the start of the block, and the click adds that to the
  position the DOM reports. An *offset*, not a position, because CodeMirror reuses a
  widget wherever an equal one is needed — a position captured when the widget was
  built can belong to another part of the document by the time it is clicked.
- **Arrowing into it works** through the same `ArrowUp`/`ArrowDown` handling every
  replaced block uses.

### Cells are rebuilt, not decorated

Everywhere else the preview hides and styles the characters that are already on
screen. Inside a widget there is nothing to decorate, so a cell's content is built:
`inlineModel.ts` turns the cell's subtree into plain data, and `inlineToDom.ts`
turns that data into elements — with `createElement` and text nodes, never
`innerHTML`, which is the same rule every other widget here follows. The classes are
the ones the inline layer already applies, so bold in a cell looks like bold in a
paragraph.

The split is not decoration: the data depends only on the block's own text, which is
what lets the widget compare equal to another built from the same source and keep
its DOM. It is also testable without a browser.

Two things in a cell are deliberately left as literal Markdown. An **image**, because
rendering one is an async read through the directory handle that would change the
row's height after the fact; and a **reference link**, because there is no URL to
resolve and the label is what the reader needs. A link's target still goes through
the same `isSafeHref` as the rest of the editor, so a `javascript:` destination
never reaches the DOM.

### What the parser decides, and what that costs

Three behaviours come from the parser rather than from a choice here, and the shapes
are pinned in `tests/unit/treeShape.spec.ts`:

- **An empty cell produces no node at all**, so columns are counted from the
  separators. Counting cells moved every value after an empty one a column to the
  left.
- **A separator row that does not match the header** is not a table, so alignment
  always has one entry per column.
- **A pipe inside inline code still splits the cell.** `` `a | b` `` is two cells.
  Nothing here can fix that without a second Markdown parser.

### Known limitations

- **A table inside a blockquote or a list item stays as source.** A block
  replacement covers whole lines, so the rendered grid would swallow the `>` or the
  indentation that puts it there and read as a top-level table.
- **Cells wrap before the table scrolls.** A table that cannot fit the editor's
  measure gets a horizontal scrollbar of its own; one that can fit by wrapping its
  cells does that instead, which is what reading wants. Either way the document
  itself never widens.
- **A paragraph line straight after the last row is another row**, per GFM. That is
  the parser's reading of the document and the rendered table shows it honestly —
  which can be surprising while typing a table at the end of a file.

## HTML

A Markdown document can contain HTML, and for a long time this editor showed it as
text. A safe subset is now drawn. What "safe" means and how it is enforced is in
[security.md](security.md#rendered-html); this is about how it behaves.

**Blocks are replaced, like a table.** An `HTMLBlock` that is a whole, visible thing
is replaced by its rendering. The cursor anywhere inside shows the source, a click
puts the cursor there, and the arrow keys go into it. Two gestures are left to the
browser: Ctrl/Cmd+click on a link, and a click on a `<summary>`, because a
`<details>` that cannot be opened is only a picture of one.

**Inline tags are decorated, like emphasis.** Markdown hands inline HTML over one
tag at a time, with the text between an opening and a closing tag left as ordinary
Markdown. So `<kbd>Ctrl</kbd>` works the way `**bold**` does: the content is styled
where it stands and the two tags are hidden as syntax, together, until the cursor
is on the line. A tag with no partner, or one this editor does not draw, stays as
the text it is.

**Markdown inside an HTML block is not Markdown.** That is CommonMark, not a choice
made here: the content of an HTML block is HTML until a blank line ends it.

### Known limitations

- **An element split by a blank line is left as source.** CommonMark ends an HTML
  block at a blank line, so the usual way of writing a `<details>` around several
  paragraphs is three things: an opening block, Markdown, a closing block. Neither
  half can be drawn. Written without blank lines inside, it is one block and it is.
- **A block inside a list or a quote stays as source**, like a table there.
- **Entities are a short list.** The common named ones and every numeric one are
  decoded; an unknown name is shown as written.

## Links to a heading

`[Features](#features)` goes to the heading of that name, on Ctrl/Cmd+click like any
other link, whether it is written as Markdown or as an `<a>`. A table of contents at
the top of a README is made of these. The name of a heading is derived the way
GitHub derives it (`headings.ts`), since that is where such links are written to
work: lower case, punctuation dropped, spaces to hyphens, and `-1`, `-2` for
repeats. The cursor goes with the view.

A link to a file (`other.md#section`) is still not followed.

## Images

An image comes from one of two places. A relative path is read from the folder the
user opened, through the directory handle they granted, and handed to the browser
as a `blob:` URL. An `https:` address is loaded from where it says it is. What that
second kind costs in privacy is in [security.md](security.md#remote-images).

An image that is a link (`[![build](badge.svg)](https://ci.example)`, or `<a>`
around an `<img>`) opens the link, never its own address. An image that cannot be
loaded — offline, or gone — is replaced by its description.

Three cases are refused, each for its own reason:

- **Any other scheme** (`http:`, `data:`, `file:`) is not loaded. The image stays
  as Markdown source, so the reader can see what it is — reporting it as "not
  found" would be a lie, since nothing was looked for.
- **A path that climbs out of the folder** (`../secret.png`) is not resolved. The
  user granted access to one directory and the editor stays inside it.
- **A file that is not an image** is not turned into a `blob:` URL at all; the
  type is checked before anything reaches the browser. SVG is allowed because an
  SVG loaded through `<img>` is inert: it cannot run script or reach the page.

Object URLs are cached by path, capped, and released when another folder is
opened.
