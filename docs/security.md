# Security model

Security and privacy are the top priority of this project, ahead of features and
ahead of convenience. This document records the decisions and the reasoning, so a
future change can be judged against the original intent.

## Threat model

**Assumption: Markdown content is untrusted, even when it comes from the local disk.**
A user can download a `.md` file and open it later. So the content of a document is
treated the way a browser treats a remote page: it may try to execute script, exfiltrate
data, or trick the user into clicking something harmful.

What we defend against:

| Threat | Defence |
| --- | --- |
| Script embedded in a document (`<script>`, `onclick`, …) | Embedded HTML is never handed to the browser as HTML. The editor reads it and builds only the elements and attributes on an allowlist; see [Rendered HTML](#rendered-html). |
| `javascript:` / `data:` links | `isSafeHref` parses the target with `URL` and allows only https, http and mailto. Anything else is inert text. |
| Exfiltration of note content | No script from a document ever runs, so nothing can read a note in order to send it; and `connect-src 'none'` means no script could send it if one did. A build-time check keeps remote origins out of the app itself. |
| Tracking via remote images | **Accepted, not defended against.** An `https:` image a document points to is loaded, which tells its server that it was asked for. See [Remote images](#remote-images) for exactly what that discloses and what it does not. |
| Accidental data loss | Conflict detection before every write; changes are never discarded silently. |
| Supply-chain drift | Exact pinned versions, committed lockfile, `npm audit` in CI. |

What is explicitly out of scope: a malicious browser extension, a compromised OS, and
a user who chooses to grant write access to a folder they do not control.

## Content Security Policy

The policy lives in [`security/csp.ts`](../security/csp.ts) and is delivered as a
`<meta http-equiv>` tag, because GitHub Pages cannot set HTTP headers (a custom
domain does not change that).

```
default-src 'none'; script-src 'self' 'sha256-…'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:; font-src 'self'; connect-src 'none';
base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none';
worker-src 'self'; manifest-src 'self'
```

Decisions worth knowing about:

- **`default-src 'none'`** rather than `'self'`. Anything not named is denied, so
  forgetting a directive fails closed.
- **`connect-src 'none'`** is the technical backstop for "notes never leave the device":
  no script on the page can fetch, post or open a socket, whatever it is and however
  it got there. Development relaxes it to `'self' ws: wss:` for Vite's HMR socket and
  the probes browser DevTools makes on its own.
- **Development also allows inline scripts**, because the dev server renders HTML on
  the fly and the build step that hashes Nuxt's inline config script has not run.
  Without it the app does not mount at all. These two are the only directives that
  differ between environments, and a unit test asserts that nothing else does.
- **`script-src` uses hashes, not `'unsafe-inline'`.** Nuxt emits its runtime config as
  an inline `<script>`. Instead of weakening the policy, `npm run generate` hashes each
  inline script and adds the hash to the policy
  ([`scripts/apply-csp-hashes.mjs`](../scripts/apply-csp-hashes.mjs)). Tampering with
  those scripts invalidates the hash.
- **`experimental.entryImportMap: false`.** Nuxt would otherwise emit an inline
  `<script type="importmap">`, whose interaction with hash-based CSP is not something we
  want to depend on. Disabling it costs some chunk-hash stability between builds.
- **`style-src` requires `'unsafe-inline'`.** CodeMirror's style engine (`style-mod`)
  creates a `<style>` element and assigns `textContent`. It accepts a nonce, and
  CodeMirror exposes the `EditorView.cspNonce` facet, but a static site cannot mint a
  nonce per request. Mermaid also inlines styles inside its SVG output. This is a real
  weakening and is recorded here rather than glossed over; the mitigation is that no
  untrusted HTML is ever inserted into the DOM, so there is no injection point.
- **`frame-ancestors`, `sandbox` and `report-uri` are absent** because browsers ignore
  them in the meta form. There is therefore no CSP-based framing protection on GitHub
  Pages.
- **`img-src` allows `blob:` and `https:`.** `blob:` is how a file from the opened
  folder is shown. `https:` is for an image a document points to on the web, and it
  is the one directive that lets a document cause a request. It names a scheme and
  not a list of hosts, because the hosts are whatever the user's documents mention.
  Plain `http:` is not allowed.

## Remote images

Until this was changed, a remote image was never loaded: it stayed as Markdown
source, and the policy would have refused it anyway. The reason was that fetching
it tells a server something. That reason has not gone away. It was weighed against
the fact that a README is written to be read with its logo and its badges, and the
decision was to load them. It is recorded here as the trade it is.

**What loading a remote image discloses.** To the server that hosts it, and to
anything on the path: that this image was requested, from the user's IP address,
at that moment, by this browser. An image address can be unique to one document,
so its author can learn when that document is opened. This is what a tracking
pixel in an e-mail does, and opening a document from someone else now has that
property.

**What it does not disclose.**

- *Which page asked.* No referrer is sent: the app's page sets `no-referrer`, and
  so does every image element it creates.
- *Anything the document says.* The address is requested exactly as written. There
  is no script in a document to read the document with, so nothing of a note can be
  put into an address, and no other note can be reached at all.
- *Anything through another channel.* An image is the only thing fetched. Style
  sheets, frames, media, forms, prefetches and pings are never created, and the
  policy would refuse each of them.

**What limits it.**

- Only `https:`. Not `http:`, not `data:`, not a protocol-relative address.
- An image is fetched when it is drawn. While the cursor is on its line the source
  shows instead, so an address still being typed is not requested piece by piece.
- An image that fails to load — offline, or gone — is replaced by its description.
  The editor works without a connection exactly as before.

The end-to-end suite pins each of these: a remote image produces one request, of
type image, with no `Referer` and no cookie; a document that tries every other way
of naming an address produces no request for any of them; and `http:` is not
loaded.

## Enforced, not promised

- `npm run check:offline` walks the build output and fails on any remote URL. The only
  permitted entries are inert strings (XML namespaces, documentation links inside error
  messages), each justified in
  [`scripts/allowed-origins.mjs`](../scripts/allowed-origins.mjs).
- The end-to-end suite asserts that loading the app produces no console errors (a CSP
  violation shows up as one) and issues no request to any host; and that a document
  can cause a request for an image and for nothing else.
- Unit tests assert the shape of the policy, including that it never contains
  `'unsafe-inline'` in `script-src`.

## What stays in the browser

Nothing from a note is ever stored. Three things are, all local to the browser
profile and none sent anywhere:

| What | Where | Why |
| --- | --- | --- |
| The last folder's `FileSystemDirectoryHandle` | IndexedDB (`hamde` / `handles`) | To reopen the folder on the next visit. A handle is an opaque reference; Chrome still asks for permission again, and "Close folder" deletes it. |
| Theme, editor width | `localStorage` (`hamde-theme`, `hamde.editorWide`) | Per-viewer preferences. |
| Whether the welcome dialog is hidden | `localStorage` (`hamde:hide-welcome`) | So it is not shown every visit. |

Every read and write is wrapped so that blocked or unavailable storage (private
mode, quota) degrades to the defaults instead of an error.

## Search metadata

The page's SEO metadata (canonical, Open Graph, JSON-LD, `sitemap.xml`) contains
URLs, but none is fetched by the page: the JSON-LD is an inert `application/ld+json`
data block, which the CSP does not treat as script and the build's inline-script
hashing skips. The origins involved are listed in
[`scripts/allowed-origins.mjs`](../scripts/allowed-origins.mjs) with their reasons.

## The file system boundary

Only `app/services/fileSystemService.ts` names the File System Access API. Every
other module works with the plain node types in `app/types/fileSystem.ts`, which
keeps handles, writable streams and permission prompts in one auditable place.
`tests/unit/architecture.spec.ts` fails if any other module reaches for the API,
so the boundary is enforced rather than documented.

Two properties of the write path matter for data safety:

- Writes open the stream with `keepExistingData: true` and truncate explicitly, so
  a crash mid-write leaves the old tail rather than an empty file.
- `writeFile` compares the file's current stamp against the one it was read with and
  refuses to overwrite a file that changed underneath. Conflict handling has been
  part of the contract since the function existed; M4 adds the resolution UI.

## Autosave and data loss

Autosave is an explicit state machine in `app/services/autoSave.ts`, kept free of
Vue so it can be tested with fake timers rather than through the UI. Four rules are
load-bearing, and each has tests that fail if they are broken:

1. **Pending text is never dropped** — not on a failed write, not on a conflict, and
   not when the document is closed. `close()` returns `false` when it could not
   save, and the caller then refuses to switch documents or folders.
2. **A conflict never retries by itself.** Further typing is recorded but not
   written, because a retry would overwrite whatever the other program saved. The
   conflict bar asks the user to choose: **Reload** takes the file on disk (through
   an undoable transaction, so Ctrl+Z still recovers the discarded text) and
   **Overwrite** writes the editor version with no stamp check. Overwrite is the
   only path in the app that deliberately discards another program's changes, and
   it exists only behind that button.
3. **Loading a document is not an edit.** The transaction that replaces the editor
   contents is annotated, and the change listener ignores it. Without that, opening
   a file looked like typing and autosave wrote it straight back, changing the
   timestamp of a file the user never edited.
4. **A file keeps its own line endings.** CodeMirror normalises a document to LF
   when it loads it, so writing the editor text straight back rewrote every line
   of a CRLF file the moment the user typed one character. The document remembers
   what the file used, and the write path restores it.

Writes happen 500 ms after the last keystroke, and immediately on Ctrl+S, on window
blur, when the tab is hidden, and before switching documents. `beforeunload` warns
while anything is unsaved.

## The hostile document

An end-to-end suite opens a document containing a script tag, an `onerror`
image, an iframe, inline event handlers, an `onload` SVG, `javascript:` and
`data:` links, a remote image, a style tag, a raw anchor with a `javascript:`
target, and a Mermaid diagram carrying markup in its labels. It then walks the
cursor through every line, so each one is rendered and decorated, and asserts:

- no dialog appeared and no global was set — nothing executed;
- the content element contains no script, iframe, style, `javascript:` anchor or
  `on*` attribute — none of it became an element;
- the only request to another origin was for the remote image, as an image;
- the file on disk was not written, because opening and reading a document is
  not an edit;
- what could be drawn safely was, with nothing of its handlers, and what could not
  is still there as text the user can read and edit.

## No telemetry

No analytics, no error reporting, no remote logging, no CDN assets, no remote fonts or
icons. Nuxt DevTools is disabled because it makes its own network requests. Fonts are
`system-ui` and `ui-monospace`.

## Mermaid

Mermaid is initialised with `startOnLoad: false` and `securityLevel: 'strict'`,
which encodes HTML in diagram labels and disables click directives. Labels are
rendered as SVG text rather than embedded HTML (`htmlLabels: false`), so diagram
content has one less way to become markup.

The rendered SVG is the only markup the app gives to a browser parser, and it is **not**
inserted with `innerHTML`. It is parsed with `DOMParser` as `image/svg+xml`,
which executes nothing, and then scrubbed: script elements are removed, every
attribute whose name starts with `on` is dropped, and any `href` that is not
http, https, mailto or a fragment is dropped. That is defence in depth — strict
mode should already have neutralised all of it.

A rendered table is built the other way round, and is the shape every other widget
in this app takes: elements from `createElement`, text from text nodes, and a link's
destination refused by `isSafeHref` before an `href` is ever set. A cell containing
`<img src=x onerror=…>` is therefore text that says so, which an end-to-end test
asserts along with the absence of any `on*` attribute or `javascript:` href inside
the grid. No string in this codebase is interpreted as HTML.

An end-to-end test feeds a diagram containing `<img onerror>`, `<script>` and a
`click … "javascript:"` directive, and asserts that the rendered result contains
no script element, no event-handler attribute and no javascript: target, and
that no dialog appeared.

Mermaid is bundled, never loaded from a CDN, and diagram source is never sent
anywhere.

## Rendered HTML

HTML in a document used to be shown as text and nothing else. That kept it from
ever being executed, and it made the commonest uses of HTML in Markdown unreadable:
a centred logo at the top of a README, a `<details>`, a table with a merged cell,
a `<kbd>`. A safe subset is now drawn. This is the largest change to the security
model since it was written, so it is recorded in full.

**The document's HTML is never given to the browser as HTML.** Not through
`innerHTML`, and not through `DOMParser` either. It is parsed by the HTML grammar
the editor already ships for highlighting, into a small model of plain data
([`htmlModel.ts`](../app/editor/livePreview/htmlModel.ts)), and elements are built
from that model with `createElement` and text nodes
([`htmlToDom.ts`](../app/editor/livePreview/htmlToDom.ts)). The sentence above still
holds: no string in this codebase is interpreted as HTML.

That makes the rule an **allowlist enforced by construction**. A sanitiser takes
markup and removes what is dangerous, and is as good as its list of dangers. Here
there is no markup to clean: an element or an attribute exists in the page only if
this code created it, and it only creates what is named. A parser trick that
confuses the grammar can change which text is shown, and nothing else.

| What | Rule |
| --- | --- |
| Elements | A fixed list of structural and text-level elements: `p`, `div`, headings, lists, tables, `details`, `a`, `img`, `kbd`, `sub`, and the like. |
| Elements that are not text for the reader (`script`, `style`, `iframe`, `object`, `svg`, `math`, form controls, `meta`, `link`, `base`) | Dropped with everything inside them. |
| Any other element | Unwrapped: the tag goes, its content stays, so an unknown tag does not take the text with it. |
| Attributes | `title`, `align`, and a few per element (`href`, `src`, `alt`, `width`, `height`, `colspan`, `rowspan`, `start`, `type`, `open`), each with its value checked. |
| `style`, `class`, `id`, `name`, every `on…`, `srcset`, `data-*` | Never kept. A document does not get to restyle the editor, shadow a property of `document`, or name more URLs than `src` does. |
| `<a href>` | The same `isSafeHref` as a Markdown link: http, https or mailto, or it is not a link. Opened on Ctrl/Cmd+click only, with `noopener noreferrer`. |
| `<img src>` | Loaded exactly as a Markdown image is: a relative path through the host, an `https:` address from the web, and nothing else. See [Remote images](#remote-images). |

Three kinds of block are left as source instead of being drawn, each because
drawing it would mislead:

- One that is not balanced on its own. CommonMark ends an HTML block at a blank
  line, so a `<details>` around several paragraphs arrives as an opening half, some
  Markdown and a closing half.
- One with nothing visible left once it is made safe — a comment, a `<script>`.
  Replacing it would make it vanish from the page, and what the user cannot see
  they cannot remove.
- One inside a list or a quote, for the reason a table there is left alone.

What still stands behind all of this is the Content Security Policy: no inline
script, no request from script, no frame, no form, no style sheet from elsewhere.
The allowlist is the first line; the policy does not depend on it.

Tested at both levels. `tests/unit/htmlModel.spec.ts` checks the model against a
list of hostile inputs and asserts the invariant directly: no element and no
attribute outside the lists, and no link target that is not http, https or mailto.
`tests/e2e/html.spec.ts` then looks at the page: for a block carrying a script, a
style sheet, a frame, a form, inline SVG, a remote image and handlers on
everything, the only elements present are the allowed ones, and of the document's
own attributes the only one that survived is the address of the image.

## The VS Code extension

The extension in `vscode/` shows the same editor in a VS Code webview. The threat
model does not change — a Markdown file is untrusted, wherever it is opened — and
the editor that enforces it is the same code, so everything above about embedded
HTML, links, remote images and Mermaid holds there unchanged. What differs is the
surroundings, and each difference is a decision recorded here.
[vscode-extension.md](vscode-extension.md) describes how the extension works.

**The webview has the web app's policy, with its own origin in place of `'self'`.**
It is built in [`vscode/src/webviewHtml.ts`](../vscode/src/webviewHtml.ts), and a
unit test asserts that no directive allows anything the site's policy does not.

```
default-src 'none'; script-src <webview origin>; style-src <webview origin> 'unsafe-inline';
img-src <webview origin> https:; font-src <webview origin>; connect-src 'none';
base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'
```

- `connect-src 'none'`: no script in the webview can make a request. Nothing in a
  document and no bug in the editor can send a note anywhere.
- `script-src` names only the extension's own files. There is no inline script, so
  no nonce and no hash is needed, and no `'unsafe-eval'`.
- `img-src` names the webview origin, which serves nothing but the files VS Code
  was told it may serve, and `https:` for [remote images](#remote-images), which
  the webview loads itself. `data:` and `blob:` are not needed and not allowed.
- `style-src 'unsafe-inline'` remains, for the reason it does on the site.

**The webview is the less trusted side.** It is where untrusted Markdown is
rendered, so the extension does not act on what it says without checking:

- Every message is checked against the exact shape expected
  ([`parseWebviewMessage`](../vscode/src/protocol.ts)) and dropped otherwise.
- A link is checked with `isSafeHref` in the webview and **again** in the extension
  before `vscode.env.openExternal` is called. The side that acts does not take the
  other side's word for what is safe.
- Anchors never navigate. A rendered table contains real anchors, and VS Code opens
  any anchor clicked in a webview; the webview intercepts every anchor click so
  that the editor's two rules hold — a plain click edits, and a target is checked
  before it is opened.
- An edit names the document it was made against and the shape it should produce.
  If either does not hold, the webview's copy is replaced by the document as VS
  Code has it.

**Images: the boundary is the workspace folder.** The web app refuses a path that
climbs with `..`, because the folder the user granted is all it may read. Here the
workspace folder is the boundary, so a path may climb as long as it stays inside it
([`resolveImagePath`](../vscode/src/imagePath.ts)). A file opened outside any
workspace folder reads only from its own directory. An `https:` image is not the
extension's business: the webview loads it, and the extension is never asked. What
the extension itself will never hand over:

| Source | Why |
| --- | --- |
| Anything with a scheme (`data:`, `file:`, `C:`, and `https:` too) | The extension reads files. An address is not a file. |
| An absolute path, or one that resolves outside the folder | The boundary. A backslash counts as a separator, so `..\..\x.png` does not slip through as one odd segment. |
| A file that is not an image, by extension | The webview must not become a way to read arbitrary files. |
| A symbolic link | The folder check only sees the link's name, and a link can point anywhere. |

There are two layers. The extension resolves and checks the path, and separately
VS Code is given `localResourceRoots` — the extension's own bundle and that one
folder — which it enforces itself, underneath whatever the extension decides.

**Enforced the same way as the site.**

- `npm run check:offline:vscode` scans the extension's bundle for remote URLs, with
  the same script and the same allow-list as the site's build.
- An end-to-end suite loads the built webview with its real policy and runs the
  hostile document through it: nothing executes, nothing becomes an element, the
  only request that leaves is for the remote image, and the only thing asked of the
  extension is where a relative image is.
- One test is there for a case worth knowing about. While rendering, Mermaid makes
  the browser load an `<img>` written inside a diagram label, before the app's own
  scrubbing sees the result. It is an image like any other the document names, and
  the test asserts that this is all it is: the handler written beside it never
  becomes an attribute, and nothing but images is requested. The same is true on
  the site.

**Workspace trust.** The extension declares support for untrusted workspaces. It
runs nothing from the workspace and treats every document as hostile already, so a
restricted mode would have nothing to restrict.

**What is stored.** One setting, `hamde.editor.wide`, in VS Code's own settings.
The cursor and scroll position of each open editor are kept in VS Code's webview
state, so the editor comes back where it was after its tab was hidden. No note
content is stored by the extension, and there is no telemetry.
