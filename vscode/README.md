# HAMDE — Markdown Live Preview

*Here's Another Markdown Editor*, inside VS Code.

Markdown renders as you write it, in place. The line your cursor is on shows its
syntax; everything else reads as the finished document. There is no preview pane to
keep beside the editor, because the editor is the preview.

It is the editor from [hamde.mau628.com](https://hamde.mau628.com), with VS Code in
charge of the files.

## What it does

- **Live preview while you edit.** Headings, bold, italic, strikethrough, inline
  code, blockquotes, lists, links and images render in place. The file is never
  transformed: it stays exactly the Markdown you wrote.
- **Task lists you can click.** A checkbox changes one character of the file.
- **Tables rendered as tables**, with column alignment and the inline Markdown
  inside each cell. Click a cell to edit its source.
- **Fenced code, highlighted** in JavaScript, TypeScript, JSON, HTML, CSS, SQL, XML,
  YAML, bash, INI, PowerShell and C#.
- **HTML, rendered** when it is the safe kind: a centred image, `<details>`, a table
  with merged cells, `<kbd>`, `<sub>`, `<br>`.
- **Mermaid diagrams**, rendered in place. Click one to edit its source.
- **Images from your workspace**, including ones in a sibling folder
  (`../assets/diagram.png`), **and from the web** over https: the logo and the
  badges at the top of a README.
- **Links to a heading** (`[Features](#features)`) go to that heading.
- **Follows your VS Code theme.**
- **Narrow or wide text**, from the button in the editor title bar, the
  *HAMDE: Toggle Editor Width* command, or the `hamde.editor.wide` setting.

Saving, undo and redo, the modified marker, hot exit, line endings and "the file
changed on disk" are all VS Code's own, exactly as for a file in its text editor.

## Opening a file as plain text

HAMDE becomes the default editor for `.md` and `.markdown` files. To open one in the
text editor instead, right-click its tab and choose **Reopen Editor With… → Text
Editor**. To make the text editor the default again while keeping HAMDE available:

```json
"workbench.editorAssociations": {
  "*.md": "default",
  "*.markdown": "default"
}
```

Source Control diffs keep using VS Code's text diff editor.

## What it deliberately does not do

- **Send your notes anywhere.** Nothing in the editor can make a request with your
  text in it. An image on the web is the one thing a document can ask for: its
  server learns that the image was asked for, from your address, and nothing about
  the note.
- **Trust HTML embedded in a document.** It is never handed to the browser as HTML.
  The editor builds only the elements and attributes on a short list; scripts,
  styles, frames and event handlers never become part of the page.
- **Follow a link whose protocol is not http, https or mailto.** Links open in your
  browser with Ctrl/Cmd+click; a plain click edits the text.
- **Read images outside your workspace folder.**
- **Collect anything.** No telemetry, no account.

A Markdown file is treated as untrusted content, so the extension works the same in
an untrusted workspace.

## Known limits

- Mermaid picks its light or dark colours when the first diagram is drawn. After
  switching the VS Code theme, reopen the file to redraw them.
- Relative links to other files are not followed yet.
- The first time VS Code starts after the extension is installed, a Markdown file
  it opens during startup may appear in the text editor. Close and reopen it; from
  then on it opens in HAMDE.

## Source and support

The extension is open source, under the MIT licence, and lives in the same
repository as the web app: [github.com/Mau628/hamde](https://github.com/Mau628/hamde).
Bugs and ideas are welcome in the
[issue tracker](https://github.com/Mau628/hamde/issues).

If it is useful to you, you can
[buy me a coffee](https://buymeacoffee.com/mau628).
