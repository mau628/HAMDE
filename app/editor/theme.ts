import { EditorView } from '@codemirror/view'

/**
 * Editor chrome. Every colour is a CSS custom property, so the light/dark palette
 * stays in one place (assets/css/main.css).
 *
 * Note: CodeMirror injects these rules through a <style> element at runtime, which
 * is why the CSP allows 'unsafe-inline' for styles. See docs/security.md.
 */
export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '16px',
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-ui)',
    lineHeight: '1.7',
    // Comfortable reading measure, centred, like a document rather than a code file.
    padding: '32px 0 45vh',
    overflow: 'auto',
  },
  '.cm-content': {
    maxWidth: '46rem',
    margin: '0 auto',
    padding: '0 24px',
    caretColor: 'var(--color-text)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--color-selection)',
  },
})
