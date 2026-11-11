<script setup lang="ts">
import { isSameFile, type FileNode } from '~/types/fileSystem'

/**
 * Files dropped onto the app from outside the open folder.
 *
 * Kept apart from the tree, under their own heading, so a file that is not part of
 * the folder never looks as if it were. They can be opened and closed here, but not
 * renamed or deleted: the app holds the file, not the folder it sits in.
 */

const { root, busy, externalFiles, openFile, closeExternalFile } = useWorkspace()
const { activeDocument } = useDocument()

function isActive(file: FileNode): boolean {
  const open = activeDocument.value
  return open !== null && isSameFile(open.file, file)
}

const hint = computed(() =>
  root.value === null ? 'Dropped onto HAMDE' : `Dropped onto HAMDE, not part of ${root.value.name}`,
)
</script>

<template>
  <section v-if="externalFiles.length > 0" class="explorer explorer--external" aria-labelledby="external-files-title">
    <div class="explorer__header">
      <span id="external-files-title" class="explorer__folder" :title="hint">
        {{ root ? 'Outside the folder' : 'Dropped files' }}
      </span>
    </div>

    <ul class="explorer__tree">
      <li v-for="file of externalFiles" :key="file.externalId" class="node">
        <button
          class="node__row"
          :class="{ 'node__row--active': isActive(file) }"
          :aria-current="isActive(file) ? 'true' : undefined"
          :title="`${file.name} — ${hint}`"
          @click="openFile(file)"
        >
          <!-- A page with a corner folded over: a single file, not a folder's. -->
          <svg
            class="node__icon"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <path d="M14 3v6h6" />
          </svg>
          <span class="node__name">{{ file.name }}</span>
          <svg
            v-if="isActive(file) && activeDocument?.readOnly"
            class="node__badge"
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            role="img"
            aria-label="Read-only"
          >
            <title>Read-only</title>
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </button>

        <span class="node__actions">
          <button
            class="node__action"
            type="button"
            :disabled="busy"
            aria-label="Close"
            :title="`Close ${file.name}`"
            @click="closeExternalFile(file)"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 4 4 12M4 4l8 8" />
            </svg>
          </button>
        </span>
      </li>
    </ul>
  </section>
</template>
