<script setup lang="ts">
import { welcomeDocument } from '~/editor/welcomeDocument'

const { theme, toggle: toggleTheme } = useTheme()
const { root, error, busy, isSupported, openFolder, restoreLastFolder } = useWorkspace()
const { activeDocument, edit } = useDocument()

const config = useRuntimeConfig()
const logoSrc = `${config.app.baseURL}logo.svg`
const { repoUrl, coffeeUrl } = config.public

/** Set by the welcome modal while it points at the sidebar links. */
const highlightLinks = ref(false)

// Reopen the last folder; every failure is silent and leaves the default document.
onMounted(() => {
  void restoreLastFolder()
})

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
      <h1 class="shell__title" title="Here's Another Markdown Editor">
        <img class="shell__logo" :src="logoSrc" alt="" width="96" height="96" />
        HAMDE
      </h1>

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

      <nav
        class="shell__links"
        :class="{ 'shell__links--highlight': highlightLinks }"
        aria-label="Project links"
      >
        <a
          class="shell__link"
          :href="repoUrl"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub repository"
          title="GitHub repository"
        >
          <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
        </a>
        <a
          class="shell__link"
          :href="coffeeUrl"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Buy me a coffee"
          title="Buy me a coffee"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M17 8h1a4 4 0 0 1 0 8h-1" />
            <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
            <path d="M6 2v3M10 2v3M14 2v3" />
          </svg>
        </a>
        <button
          class="shell__link shell__theme"
          type="button"
          :aria-label="theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
          :title="theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
          @click="toggleTheme()"
        >
          <svg v-if="theme === 'light'" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
          </svg>
        </button>
      </nav>
    </aside>

    <main class="shell__editor">
      <ConflictBar />
      <MarkdownEditor :doc="documentText" @change="onChange" />
      <SaveStatus />
    </main>

    <WelcomeModal @update:highlight="highlightLinks = $event" />
  </div>
</template>
