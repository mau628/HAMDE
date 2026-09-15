# YAMDE

A local-first Markdown editor with Obsidian-style live preview. It runs entirely in
the browser: no backend, no accounts, no network access after the page loads.

## Requirements

- A Chromium-based browser. The editor is built on the
  [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker),
  which Firefox and Safari do not implement. This is a deliberate scope decision.
- Node.js >= 24.11.0 for development.

## How it works

You pick a local folder. The app keeps file handles, reads a document only when you
open it, and writes changes straight back to disk. Notes are never uploaded anywhere
— `connect-src 'none'` in the Content Security Policy makes that a technical
guarantee rather than a promise.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run generate` | Static build into `.output/public`, then applies CSP script hashes |
| `npm run serve:static` | Serves `.output/public` exactly as a static host would |
| `npm run typecheck` | `vue-tsc --noEmit` |
| `npm run test` | Unit tests (Vitest) |
| `npm run test:e2e` | Builds, then runs browser tests (Playwright/Chromium) |
| `npm run check:offline` | Fails if the build references any remote origin |
| `npm run verify` | typecheck + unit tests + build + offline check |

## Documentation

- [docs/live-preview.md](docs/live-preview.md) — how the rendering works and what it deliberately does not render
- [docs/security.md](docs/security.md) — threat model and every security decision
- [docs/dependencies.md](docs/dependencies.md) — why each dependency exists, and what was rejected

## Status

M5 complete: the live preview. Markdown renders in place and the line the cursor
is on shows its syntax; the document itself is never transformed. Links open on
Ctrl/Cmd+click, and only after their protocol is checked.

Next: interactive task checkboxes (M6), fenced code highlighting (M7), Mermaid (M8).
