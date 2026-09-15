<script setup lang="ts">
import { welcomeDocument } from '~/editor/welcomeDocument'

const { root, activeDocument, error, busy, isSupported, openFolder } = useWorkspace()

/** Scratch text, used only while no file is open. Never written to disk. */
const scratch = ref(welcomeDocument)

const documentText = computed(() => activeDocument.value?.text ?? scratch.value)

// A file on disk is read-only until autosave exists (M3). Until then the app cannot
// hold unsaved changes to a real file, so it cannot lose them either.
const isReadOnly = computed(() => activeDocument.value !== null)

function onChange(text: string) {
  if (activeDocument.value === null) scratch.value = text
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
      <MarkdownEditor :doc="documentText" :readonly="isReadOnly" @change="onChange" />
      <p v-if="isReadOnly" class="shell__readonly">
        {{ activeDocument?.file.path }} &middot; read-only until autosave lands
      </p>
    </main>
  </div>
</template>
