<script setup lang="ts">
import type { FileTreeNode } from '~/types/fileSystem'

const props = defineProps<{
  node: FileTreeNode
  depth: number
}>()

const { activeDocument, isExpanded, toggleDirectory, openFile } = useWorkspace()

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
      <span class="node__chevron" :class="{ 'node__chevron--open': isExpanded(node.path) }" aria-hidden="true">
        &#9656;
      </span>
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
