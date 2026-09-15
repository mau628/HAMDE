<script setup lang="ts">
const { activeDocument, saveState, saveNow } = useDocument()

const label = computed(() => {
  switch (saveState.value.status) {
    case 'clean':
      return 'Saved'
    case 'dirty':
      return 'Unsaved changes'
    case 'saving':
      return 'Saving...'
    case 'conflict':
      return 'Changed outside the editor'
    case 'error':
      return 'Save failed: ' + saveState.value.message
  }
})

// A conflict is resolved in ConflictBar, not by retrying the same failing write.
const canRetry = computed(() => saveState.value.status === 'error')
</script>

<template>
  <p v-if="activeDocument" class="status" :class="'status--' + saveState.status">
    <span class="status__path">{{ activeDocument.file.path }}</span>
    <span class="status__separator" aria-hidden="true">&middot;</span>
    <!-- aria-live so a save failure is announced, not just coloured. -->
    <span class="status__state" role="status" aria-live="polite">{{ label }}</span>
    <button v-if="canRetry" class="status__retry" @click="saveNow()">Retry</button>
  </p>
</template>
