import { chooseTheme, currentTheme, type Theme } from '~/services/theme'

export function useTheme() {
  const theme = useState<Theme>('theme', () => 'light')

  onMounted(() => {
    theme.value = currentTheme()
  })

  function toggle() {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark'
    chooseTheme(next)
    theme.value = next
  }

  return { theme, toggle }
}
