<script setup lang="ts">
import type { FileNode, FileTreeNode } from '~/types/fileSystem'

const props = defineProps<{
  node: FileTreeNode
  depth: number
}>()

const { busy, isExpanded, toggleDirectory, openFile, renameFile, deleteFile } = useWorkspace()
const { activeDocument } = useDocument()

const isActive = computed(
  () => props.node.kind === 'file' && activeDocument.value?.file.path === props.node.path,
)

// Both actions change the disk, so neither happens without the user confirming it.
async function onRename(file: FileNode): Promise<void> {
  const name = window.prompt(`Rename "${file.name}" to`, file.name)
  if (name === null) return
  await renameFile(file, name, (fileName) =>
    window.confirm(`Rename "${file.name}" to "${fileName}"?`),
  )
}

async function onDelete(file: FileNode): Promise<void> {
  if (!window.confirm(`Delete "${file.name}"? This cannot be undone.`)) return
  await deleteFile(file)
}

// Indentation is a style, not a nesting of elements: a deep tree stays flat in the DOM.
const indent = computed(() => `${props.depth * 14}px`)
</script>

<template>
  <li class="node">
    <button
      v-if="node.kind === 'directory'"
      class="node__row"
      :style="{ paddingLeft: indent }"
      :aria-expanded="isExpanded(node.path)"
      @click="toggleDirectory(node)"
    >
      <svg
        class="node__chevron"
        :class="{ 'node__chevron--open': isExpanded(node.path) }"
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
        <path d="m9 6 6 6-6 6" />
      </svg>
      <span class="node__name">{{ node.name }}</span>
    </button>

    <button
      v-else
      class="node__row"
      :class="{ 'node__row--active': isActive }"
      :style="{ paddingLeft: indent }"
      :aria-current="isActive ? 'true' : undefined"
      @click="openFile(node)"
    >
      <!-- The Markdown mark: an "M" and a down arrow in a box. -->
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
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M6 15V9l3 3 3-3v6M17 9v6m-2-2 2 2 2-2" />
      </svg>
      <span class="node__name">{{ node.name }}</span>
    </button>

    <span v-if="node.kind === 'file'" class="node__actions">
      <button
        class="node__action"
        type="button"
        :disabled="busy"
        aria-label="Rename"
        :title="`Rename ${node.name}`"
        @click="onRename(node)"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M11 2.5 13.5 5 6 12.5H3.5V10Z" />
          <path d="M9.5 4 12 6.5" />
        </svg>
      </button>
      <button
        class="node__action node__action--danger"
        type="button"
        :disabled="busy"
        aria-label="Delete"
        :title="`Delete ${node.name}`"
        @click="onDelete(node)"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" />
          <path d="M6.75 6.5v4.5M9.25 6.5v4.5" />
        </svg>
      </button>
    </span>

    <ul v-if="node.kind === 'directory' && isExpanded(node.path) && node.children" class="node__children">
      <TreeNode
        v-for="child of node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
      />
      <li v-if="node.children.length === 0" class="node__empty" :style="{ paddingLeft: `${(depth + 1) * 14}px` }">
        Empty
      </li>
    </ul>
  </li>
</template>
