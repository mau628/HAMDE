<script setup lang="ts">
import { welcomeDocument } from '~/editor/welcomeDocument'

const { root, error, busy, isSupported, openFolder } = useWorkspace()
const { activeDocument, edit } = useDocument()

// Ctrl+S, save on blur, save before the page closes.
useAutoSave()

/** Scratch text, used only while no file is open. Never written to disk. */
const scratch = ref(welcomeDocument)

const documentText = computed(() => activeDocument.value?.text ?? scratch.value)

function onChange(text: string) {
  if (activeDocument.value === null) {
    scratch.value = text
    return
  }
  edit(text)
}
</script>

<template>
  <div class="shell">
    <aside class="shell__explorer" aria-label="Files">
      <h1 class="shell__title">YAMDE</h1>

      <button class="shell__open" :disabled="busy || !isSupported" @click="openFolder()">
        {{ root ? 'Open another folder' : 'Open Folder' }}
      </button>

      <p v-if="!isSupported" class="shell__notice">
        This editor needs the File System Access API, available in Chromium-based
        browsers.
      </p>

      <p v-else-if="error?.kind === 'permission-denied'" class="shell__notice">
        Permission to read that folder was denied.
      </p>

      <p v-else-if="error?.kind === 'read-failed'" class="shell__notice">
        Could not read {{ error.path || 'the folder' }}: {{ error.message }}
      </p>

      <FileExplorer />

      <p class="shell__privacy">Files never leave your device.</p>
    </aside>

    <main class="shell__editor">
      <MarkdownEditor :doc="documentText" @change="onChange" />
      <SaveStatus />
    </main>
  </div>
</template>
