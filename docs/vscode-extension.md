# The VS Code extension

The extension in [`vscode/`](../vscode) opens Markdown files in the same editor the web
app uses. It is not a port and holds no copy of the editor: its webview bundles
`app/editor` straight from this repository, so a change to the live preview reaches
both in the same commit.

## What is shared, and what is not

| | Web app | Extension |
| --- | --- | --- |
| The editor (`app/editor`, and the four services it uses) | ✓ | ✓, the same files |
| Tokens and live-preview CSS (`tokens.css`, `markdown.css`) | ✓ | ✓, the same files |
| File explorer, open/close folder, autosave, conflict bar, welcome dialog | ✓ | — VS Code does all of it |
| Reading files | File System Access API | VS Code's document and `workspace.fs` |

The editor asks its surroundings for three things, through `EditorOptions`
(`app/editor/editorConfig.ts`): where an image is, how to open a link, and whether
it should keep its own undo history. Each host answers in its own way; nothing in
`app/editor` knows which host it is in.

Two things keep that true rather than hoped for:

- `tests/unit/architecture.spec.ts` fails if `app/editor` reaches anything but
  itself and the listed services, or imports Vue or Nuxt.
- `vscode/tsconfig.json` compiles the same files with no Nuxt globals in scope, so
  a Nuxt auto-import used inside the core is a type error there.

## Layout

```
vscode/
  package.json          the extension manifest; also an npm workspace of the root
  build.mjs             esbuild: one bundle for the extension host, one for the webview
  src/
    extension.ts        activation: registers the editor and one command
    editorProvider.ts   one session per open editor; relays edits both ways
    protocol.ts         the messages, and the check applied to what the webview sends
    imagePath.ts        which images may be shown (pure path logic)
    webviewHtml.ts      the webview's page and its Content Security Policy
    webview/            what runs in the webview: the editor and its styles
  test/                 tests that run in, and drive, a real VS Code
```

The extension is an npm workspace, so there is one `package-lock.json` and one
`npm ci`. It has no runtime dependencies: CodeMirror and Mermaid are the root's, and
esbuild bundles them.

## A custom *text* editor

The extension registers a `CustomTextEditorProvider`. That choice is why so little
of the web app's file handling exists here: VS Code owns the document, and with it
saving, the modified marker, hot exit, undo and redo, line endings, encoding and
noticing that the file changed on disk. The webview shows a copy and relays edits.

### Keeping the two copies equal

Changes travel in both directions as changes, never as the whole text, so typing in
a large document costs what was typed (`vscode/src/protocol.ts`).

- **Positions are a line and a character, not an offset.** CodeMirror stores every
  line break as one character; VS Code keeps a CRLF file's as two. An offset means
  different things on each side. A line and a character mean the same, and VS Code
  writes inserted line breaks as the file's own.
- **An edit from the webview says what it had seen.** Each message about the
  document carries a sequence number, and each edit names the last one the webview
  had applied. An edit made against a document that has since changed is not
  applied; the webview is sent the document instead.
- **Both sides check the result.** Every change comes with the length and line
  count the document should have afterwards. A mismatch on either side means the
  copies drifted, and the answer is always the same: the document in VS Code is
  sent whole and replaces the webview's.
- **An edit is not echoed.** Applying a webview edit makes VS Code announce a
  change. The session recognises it by the shape it expected and does not send it
  back; anything else that arrives in that window is treated as drift.

The one case that loses input is by design: if the user types in the webview in the
same instant something else changes the document, the document wins and that
keystroke is dropped rather than applied to the wrong place.

### Undo

The webview keeps no history (`history: false`). Ctrl+Z is VS Code's undo on the
document, and the result comes back to the webview as an ordinary change, with the
cursor moved to it. A second history in the webview would undo the same edit twice.
The undo keys are still claimed inside the editor, so the browser does not apply its
own undo to the editable content behind VS Code's back.

### When the tab is hidden

VS Code discards a hidden webview's page. The webview sends `ready` every time it
starts, the session answers with the whole document, and the cursor and scroll
position come back from the state VS Code keeps for the webview.

## Differences from the web app, on purpose

- **Images may use `..`.** In the browser the folder the user granted is the only
  boundary, so a path that climbs is refused. Here the boundary is the workspace
  folder, and `docs/guide.md` pointing at `../assets/diagram.png` is the ordinary
  layout of a repository. A file opened on its own, outside any workspace folder,
  reads only from its own directory. See [security.md](security.md).
- **The chrome follows the VS Code theme**, through VS Code's CSS variables. The
  syntax palette stays HAMDE's own, light or dark to match.
- **Width is a setting** (`hamde.editor.wide`) with a command and a title-bar
  button. Ctrl/Cmd+, is not bound: in VS Code it opens Settings.
- **Only `file` and `vscode-remote` documents** open in HAMDE. The selector names
  the scheme, so the read-only side of a Git diff stays in the text editor.

## Working on it

| Command | What it does |
| --- | --- |
| `npm run build -w vscode` | Development build into `vscode/dist`, with source maps |
| `npm run watch -w vscode` | The same, rebuilding on save |
| `npm run typecheck -w vscode` | `tsc` over the extension and the shared core |
| `npm run package -w vscode` | Production build, then `vscode/hamde-vscode-<version>.vsix` |
| `npm run test:smoke -w vscode` | Smoke tests inside a real VS Code (downloads it once) |
| `npm run test:editing -w vscode` | Types, saves and undoes in a real VS Code window |
| `npm run build:vscode` | Production build, from the repository root |
| `npm run check:offline:vscode` | Fails if the bundle references any remote origin |

Press Ctrl+F5 in this repository to open a second VS Code window with the extension
loaded; F5 does the same with the debugger attached, for breakpoints in the
extension host. After a rebuild, reload that window with Ctrl+R. The webview's
console is under *Developer: Open Webview Developer Tools*.

To try a packaged build: `code --install-extension vscode/hamde-vscode-<version>.vsix`.

## How it is tested

- **Unit tests** (`tests/unit/vscode/`): the message check, the image boundary, the
  policy, the offset/position translation, and the decisions in the manifest.
- **The webview as a page** (`tests/e2e/vscodeWebview.spec.ts`): the built bundle
  and the real page, with its real policy, in Chromium. VS Code is replaced by a
  stand-in that records what the webview posts. This covers the webview's whole
  side of the protocol, and the hostile-document checks.
- **Smoke tests in VS Code** (`vscode/test/smoke`): what only VS Code can answer —
  that the manifest opens the right files in HAMDE and leaves other schemes and
  diffs alone, that the webview's script really loads there, and that undo reaches
  the document.
- **Editing in VS Code** (`vscode/test/runEditing.mjs`): the one test in which both
  halves run together. Playwright drives a real VS Code window: it opens files from
  the Explorer, types in the editor, saves, undoes and redoes with the keyboard, and
  reads the result from disk. It checks that a CRLF file keeps its line endings,
  that one Ctrl+Z undoes one edit, that an image in a sibling folder is shown and
  one outside the workspace is not, and that a change on disk reaches the editor.

Both VS Code suites run in the oldest VS Code the manifest supports, downloaded once
into `vscode/.vscode-test/`, with a throwaway profile and no other extensions. Set
`VSCODE_VERSION=stable` to run them in the current release instead.

One thing these tests found is VS Code's behaviour rather than the extension's, and
worth knowing: VS Code chooses the editor for a file from the extensions it knows
at that moment. The very first time it starts after HAMDE is installed, a Markdown
file opened during startup appears in the text editor. From the next start on, and
for any file opened once the window is up, it is HAMDE.

## Releasing

1. Set `version` in `vscode/package.json`.
2. Push a tag named `vscode-v<version>`.

The [release workflow](../.github/workflows/release-vscode.yml) checks the tag
against the manifest, runs every test above, attaches the `.vsix` to a GitHub
release, and publishes to the Marketplace if the `VSCE_PAT` secret is set. The
`publisher` in the manifest has to be a Marketplace publisher that token can
publish to.
