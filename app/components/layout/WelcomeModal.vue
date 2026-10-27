<script setup lang="ts">
const STORAGE_KEY = 'hamde:hide-welcome'
const VISITS_KEY = 'hamde:visits'

const emit = defineEmits<{ 'update:highlight': [value: boolean] }>()

const { coffeeUrl, welcomeMinVisits } = useRuntimeConfig().public

const open = ref(false)
const dontShowAgain = ref(false)
const acceptButton = ref<HTMLButtonElement | null>(null)

function readPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writePreference(hide: boolean) {
  try {
    if (hide) localStorage.setItem(STORAGE_KEY, '1')
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable (private mode, quota): the modal simply shows again.
  }
}

/**
 * Counts this visit and returns the running total. Stops counting at `cap`, which
 * is all the dialog needs to know. Without storage it returns 0: with no way to
 * tell a returning visitor from a new one, the dialog stays closed.
 */
function countVisit(cap: number): number {
  try {
    const previous = Number.parseInt(localStorage.getItem(VISITS_KEY) ?? '0', 10) || 0
    const visits = Math.min(previous + 1, cap)
    localStorage.setItem(VISITS_KEY, String(visits))
    return visits
  } catch {
    return 0
  }
}

onMounted(async () => {
  if (readPreference()) return
  const minVisits = Math.max(1, Number(welcomeMinVisits) || 1)
  if (countVisit(minVisits) < minVisits) return
  open.value = true
  await nextTick()
  acceptButton.value?.focus()
})

// While the "always reachable from the sidebar" hint is visible, the sidebar
// icons are highlighted. Closing the modal stops it.
watch(dontShowAgain, (checked) => {
  writePreference(checked)
  emit('update:highlight', checked)
})

function close() {
  open.value = false
  emit('update:highlight', false)
}
</script>

<template>
  <div v-if="open" class="welcome" @keydown.esc="close">
    <div
      class="welcome__dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <h2 id="welcome-title" class="welcome__title">HAMDE</h2>
      <p><em>Here's Another Markdown Editor.</em></p>

      <p>
        This is a free project that aims to make managing markdown files easy and safe,
        so they never leave your local device and can't leak to the cloud. You can
        buy me a coffee if you like it and find it useful
        <a :href="coffeeUrl" target="_blank" rel="noopener noreferrer">{{ coffeeUrl }}</a>.
      </p>

      <label class="welcome__check">
        <input v-model="dontShowAgain" type="checkbox" />
        Don't show again
      </label>

      <p v-if="dontShowAgain" class="welcome__hint" role="status">
        You can always contribute from the icons at the bottom of the sidebar.
      </p>

      <div class="welcome__actions">
        <button ref="acceptButton" class="welcome__accept" @click="close">Accept</button>
      </div>
    </div>
  </div>
</template>
