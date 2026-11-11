<script setup lang="ts">
/**
 * Says that the open document cannot be typed into, and offers to change that.
 *
 * A dropped file arrives with read access only. Writing to it needs the browser's
 * permission, and the browser asks for it only from a click: hence the button,
 * rather than prompting on drop.
 */
const { activeDocument, enableEditing } = useDocument()

const busy = ref(false)
const denied = ref(false)

// A new document gets a fresh chance to be allowed.
watch(
  () => activeDocument.value?.file,
  () => {
    denied.value = false
  },
)

async function allow(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    denied.value = !(await enableEditing())
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="activeDocument?.readOnly" class="readonly" role="region" aria-label="Read-only document">
    <p class="readonly__message">
      <strong>{{ activeDocument.file.name }}</strong> is open read-only.
      <template v-if="denied">The browser did not allow writing to it.</template>
      <template v-else>Allow editing to change it and save to the file.</template>
    </p>
    <button class="readonly__action" type="button" :disabled="busy" @click="allow()">
      Allow editing
    </button>
  </div>
</template>
