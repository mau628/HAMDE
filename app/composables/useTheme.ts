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

export function useTheme() {
  const theme = useState<Theme>('theme', () => 'light')

  onMounted(() => {
    theme.value = currentTheme()
  })

  function toggle() {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    theme.value = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // The choice still applies for this session.
    }
  }

  return { theme, toggle }
}
