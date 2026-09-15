<script setup lang="ts">
const { activeDocument, saveState, overwriteOnDisk, reloadFromDisk } = useDocument()

const conflicted = computed(() => saveState.value.status === 'conflict')

const busy = ref(false)

/** Both choices are destructive in one direction, so neither runs twice. */
async function choose(resolve: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  try {
    await resolve()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="conflicted && activeDocument" class="conflict" role="alertdialog" aria-labelledby="conflict-title">
    <p id="conflict-title" class="conflict__message">
      <strong>{{ activeDocument.file.name }}</strong> changed outside the editor.
      Nothing has been saved.
    </p>

    <div class="conflict__actions">
      <button class="conflict__action" :disabled="busy" @click="choose(reloadFromDisk)">
        Reload
        <span class="conflict__hint">use the file on disk</span>
      </button>
      <button class="conflict__action" :disabled="busy" @click="choose(overwriteOnDisk)">
        Overwrite
        <span class="conflict__hint">keep what is in the editor</span>
      </button>
    </div>
  </div>
</template>
