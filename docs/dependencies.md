# Dependency policy

Every dependency is a permanent maintenance and security cost. Before adding one, in
order:

1. Does the browser already do this?
2. Does Nuxt or Vue already do this?
3. Does CodeMirror already do this?
4. Is the library actively maintained, and what does it cost in bundle size?
5. Does it work fully offline?

Versions are pinned exactly (`save-exact=true` in `.npmrc`); `package-lock.json` is
committed; `npm audit` runs in CI.

## Runtime dependencies

| Package | Why it is needed |
| --- | --- |
| `@codemirror/state`, `@codemirror/view` | Editor core. The live preview is built on its decoration model. |
| `@codemirror/language` | `syntaxTree`, `LanguageDescription` (lazy language loading), highlight styles. |
| `@codemirror/lang-markdown` | Markdown parsing plus the list-continuation keymap. |
| `@lezer/markdown` | **Required explicitly.** `markdown()` defaults to `commonmarkLanguage`, which has no GFM. `markdownLanguage` (or `GFM` from this package) provides tables, task lists, strikethrough and autolinks. |
| `@codemirror/commands` | History and default keybindings. |
| `mermaid` | Diagram rendering. Bundled locally, never from a CDN, and imported dynamically: ~1.5 MB that a document without a diagram never downloads. |
| `@codemirror/lang-javascript`, `-json`, `-html`, `-css`, `-sql`, `-xml`, `-yaml` | Grammars for fenced code blocks, each imported dynamically so it costs nothing until a document uses it. |
| `@codemirror/legacy-modes` | bash (`shell`), PowerShell and C# (`clike`), for which no Lezer grammar exists. Wrapped in `StreamLanguage`. |

## Rejected, and why

| Rejected | Reason |
| --- | --- |
| **Shiki** | CodeMirror already highlights fenced code through `codeLanguages`, with lazy loading via `LanguageDescription.of({ load })`. Shiki would add a second tokenizer, a large grammar payload, and (with the Oniguruma engine) WASM that requires `'wasm-unsafe-eval'` in the CSP. If a distinct "rendered" look is ever wanted, the path is `shiki/core` with `createJavaScriptRegexEngine()` from `shiki/engine/javascript`, which avoids WASM. |
| **markdown-it / marked / remark** | A second Markdown parser would become a second source of truth about the document. CodeMirror's syntax tree is what the editor already maintains. |
| **ProseMirror / Tiptap / Milkdown / Lexical** | Their document model is a rich tree, so Markdown is serialised on save. That rewrites the user's file (quote styles, list indentation, spacing) even when nothing was edited, which conflicts with "never modify files accidentally". |
| **Monaco** | A code editor, without a Markdown-aware decoration model or an incremental Markdown parser. Larger bundle. |
| **Pinia** | The state is a directory handle, a tree, and one open document. `useState` and `reactive` are enough. |
| **Vuetify / PrimeVue / Bootstrap / Tailwind** | Two panes and a tree. Hand-written CSS is smaller and has no upgrade treadmill. |
| **DOMPurify** | There is nothing to sanitise: untrusted HTML is never inserted into the DOM. Adding it would imply the opposite. |
| **Icon libraries** | A handful of inline SVGs. |
| **`idb`** | No IndexedDB usage in the MVP. |
| **The `codemirror` meta-package** | Bundles `basicSetup` and pulls in packages we do not use. Individual packages only. |
| **A debounce library** | A dozen lines of code. |

## Transitive weight we cannot avoid

`@codemirror/lang-markdown` imports `@codemirror/lang-html` at module scope (it uses
it to highlight HTML tags that appear in a Markdown document), and `lang-html`
embeds the JavaScript and CSS parsers to handle `<script>` and `<style>` content.
So `@lezer/html`, `@lezer/javascript` and `@lezer/css` are in the bundle whether we
ask for them or not; `markdown({ htmlTagLanguage })` cannot undo the top-level import.

Two consequences:

- Highlighting embedded HTML is free, and consistent with our rule that embedded HTML
  is shown as text rather than rendered.
- In M7, `javascript`, `typescript`, `html` and `css` cost nothing extra, because their
  grammars are already loaded. Lazy loading only matters for json, sql, xml, yaml and
  the `legacy-modes` parsers (bash, powershell, csharp).

## Bundle baseline

Measured on the generated build, as the browser actually downloads it:

| Load | Transferred |
| --- | --- |
| Initial page, any document | 653 kB in 3 files (~196 kB gzip) |
| A document with no code | nothing further |
| A document with one SQL block | +15 kB in 1 file |
| A document using all eleven languages | +74 kB in 7 files |

Seven files rather than eleven because JavaScript and TypeScript share a grammar,
and HTML and CSS are already in the initial bundle whatever we do (see above).

Mermaid stays out of that initial number: it is loaded only when a diagram is
actually drawn.

| Load | Transferred |
| --- | --- |
| A document with no diagram | nothing further |
| A document whose diagram is open as source | nothing further |
| A document with a rendered diagram | +1.5 MB in 12 files |

## Notes on upstream

- **The CodeMirror GitHub repositories are archived** (`codemirror/view`,
  `codemirror/lang-markdown`, `lezer-parser/markdown`, last push 2026-04-15) because
  development moved off GitHub to `code.haverbeke.berlin`. The packages are still
  actively published — `@codemirror/view@6.43.12` shipped on 2026-09-15. Do not read
  "archived" as abandoned, but **do** verify APIs against `codemirror.net/docs` rather
  than the GitHub mirror, which may lag.
- **Mermaid 12.0.0** was published 2026-09-10. Before adopting it, M8 verifies the
  `initialize` / `parse` / `render` contract; if there is friction, we pin the last
  11.x release instead.
