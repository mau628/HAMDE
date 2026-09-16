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
| Script embedded in a document (`<script>`, `onclick`, …) | Embedded HTML is never inserted into the DOM. It is displayed as highlighted text. |
| `javascript:` / `data:` links | `isSafeHref` parses the target with `URL` and allows only https, http and mailto. Anything else is inert text. |
| Exfiltration of note content | `connect-src 'none'`, plus a build-time check that no remote origin appears in the output. |
| Tracking via remote images | A remote image is never fetched; it stays as Markdown source. Only files inside the opened folder are rendered, through `blob:` URLs, and only after their type is checked. |
| Accidental data loss | Conflict detection before every write; changes are never discarded silently. |
| Supply-chain drift | Exact pinned versions, committed lockfile, `npm audit` in CI. |

What is explicitly out of scope: a malicious browser extension, a compromised OS, and
a user who chooses to grant write access to a folder they do not control.

## Content Security Policy

The policy lives in [`security/csp.ts`](../security/csp.ts) and is delivered as a
`<meta http-equiv>` tag, because GitHub Pages cannot set HTTP headers.

```
default-src 'none'; script-src 'self' 'sha256-…'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self'; connect-src 'none';
base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none';
worker-src 'self'; manifest-src 'self'
```

Decisions worth knowing about:

- **`default-src 'none'`** rather than `'self'`. Anything not named is denied, so
  forgetting a directive fails closed.
- **`connect-src 'none'`** is the technical backstop for "notes never leave the device".
  Development relaxes it to `'self' ws: wss:` for Vite's HMR socket and the probes
  browser DevTools makes on its own.
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
- **`img-src` allows `blob:` but no remote hosts.** Loading a remote image would tell
  that server which note is open.

## Enforced, not promised

- `npm run check:offline` walks the build output and fails on any remote URL. The only
  permitted entries are inert strings (XML namespaces, documentation links inside error
  messages), each justified in
  [`scripts/allowed-origins.mjs`](../scripts/allowed-origins.mjs).
- The end-to-end suite asserts that loading the app produces no console errors (a CSP
  violation shows up as one) and issues no request to any host.
- Unit tests assert the shape of the policy, including that it never contains
  `'unsafe-inline'` in `script-src`.

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
- no request went to any origin but the app’s own;
- the file on disk was not written, because opening and reading a document is
  not an edit;
- all of it is still there as text the user can edit.

## No telemetry

No analytics, no error reporting, no remote logging, no CDN assets, no remote fonts or
icons. Nuxt DevTools is disabled because it makes its own network requests. Fonts are
`system-ui` and `ui-monospace`.

## Mermaid

Mermaid is initialised with `startOnLoad: false` and `securityLevel: 'strict'`,
which encodes HTML in diagram labels and disables click directives. Labels are
rendered as SVG text rather than embedded HTML (`htmlLabels: false`), so diagram
content has one less way to become markup.

The rendered SVG is the only markup the app parses from a string, and it is **not**
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
