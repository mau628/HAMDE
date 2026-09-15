<script setup lang="ts">
const { root, busy, refresh } = useWorkspace()
</script>

<template>
  <div v-if="root" class="explorer">
    <div class="explorer__header">
      <span class="explorer__folder" :title="root.name">{{ root.name }}</span>
      <button class="explorer__refresh" :disabled="busy" title="Reload folder" @click="refresh()">
        Reload
      </button>
    </div>

    <ul class="explorer__tree">
      <TreeNode v-for="child of root.children ?? []" :key="child.path" :node="child" :depth="0" />
      <li v-if="(root.children ?? []).length === 0" class="node__empty">No Markdown files</li>
    </ul>
  </div>
</template>
