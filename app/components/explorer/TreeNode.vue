<script setup lang="ts">
import type { FileTreeNode } from '~/types/fileSystem'

const props = defineProps<{
  node: FileTreeNode
  depth: number
}>()

const { isExpanded, toggleDirectory, openFile } = useWorkspace()
const { activeDocument } = useDocument()

const isActive = computed(
  () => props.node.kind === 'file' && activeDocument.value?.file.path === props.node.path,
)

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
