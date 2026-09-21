<script setup lang="ts">
const STORAGE_KEY = 'hamde:hide-welcome'

const emit = defineEmits<{ 'update:highlight': [value: boolean] }>()

const { repoUrl, coffeeUrl } = useRuntimeConfig().public

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

onMounted(async () => {
  if (readPreference()) return
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

      <p>
        This is a free project that aims to make managing markdown files easy and safe,
        so they never leave your local device and can't leak to the cloud. You can
        contribute on the repo
        <a :href="repoUrl" target="_blank" rel="noopener noreferrer">{{ repoUrl }}</a>
        and you can also buy me a coffee if you like it and find it useful
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
