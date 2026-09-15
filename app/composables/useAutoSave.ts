/**
 * Ties autosave to the places a user expects a save to happen.
 *
 * Autosave already writes after a quiet period; these bindings cover the moments
 * where waiting would be wrong: an explicit Ctrl+S, the window losing focus, the tab
 * being hidden, and the page closing with text still unsaved.
 *
 * Call once, from the app shell.
 */
export function useAutoSave() {
  const { saveNow, hasUnsavedChanges } = useDocument()

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 's' || !(event.ctrlKey || event.metaKey) || event.altKey) return

    // Ctrl+S must not open the browser's save dialog, autosave or no autosave.
    event.preventDefault()
    void saveNow()
  }

  function onVisibilityChange() {
    // Hiding a tab is a common precursor to it being discarded, so write now rather
    // than trusting the debounce to get its turn.
    if (document.visibilityState === 'hidden') void saveNow()
  }

  function onBlur() {
    void saveNow()
  }

  function onBeforeUnload(event: BeforeUnloadEvent) {
    if (!hasUnsavedChanges.value) return

    // Best effort: the browser decides whether to show the prompt, and an async
    // write cannot be awaited here. The flush attempt above is what usually saves.
    void saveNow()
    event.preventDefault()
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('blur', onBlur)
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('visibilitychange', onVisibilityChange)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('beforeunload', onBeforeUnload)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })
}
