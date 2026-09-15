<script setup lang="ts">
import { sampleDocument } from '~/editor/sampleDocument'

// M2 replaces this with the document opened from the user's folder.
const doc = ref(sampleDocument)
</script>

<template>
  <div class="shell">
    <aside class="shell__explorer" aria-label="Files">
      <h1 class="shell__title">YAMDE</h1>
      <!-- FileExplorer mounts here in M2 -->
      <p class="shell__privacy">Files never leave your device.</p>
    </aside>
    <main class="shell__editor">
      <MarkdownEditor :doc="doc" @change="doc = $event" />
    </main>
  </div>
</template>
