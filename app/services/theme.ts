/**
 * Which theme is in effect, and remembering the user's choice.
 *
 * Kept free of Vue and Nuxt: the editor core asks for the theme when it renders a
 * diagram, and that core also runs outside this app, in the VS Code extension's
 * webview. The reactive wrapper for the app's own UI is `useTheme`.
 */

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'hamde-theme'

/** The theme in effect: the user's choice, or else the system preference. */
export function currentTheme(): Theme {
  const chosen = document.documentElement.dataset.theme
  if (chosen === 'light' || chosen === 'dark') return chosen
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Applies the saved choice, if any. Called once at startup. */
export function restoreTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved
  } catch {
    // Storage unavailable: fall back to the system preference.
  }
}

/** Applies a choice and remembers it. */
export function chooseTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // The choice still applies for this session.
  }
}
