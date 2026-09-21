<script setup lang="ts">
const { root, busy, refresh, createFile } = useWorkspace()

async function onNewFile(): Promise<void> {
  const name = window.prompt('New file name', 'untitled.md')
  if (name === null) return
  await createFile(name)
}
</script>

<template>
  <div v-if="root" class="explorer">
    <div class="explorer__header">
      <span class="explorer__folder" :title="root.name">{{ root.name }}</span>
      <span class="explorer__actions">
        <button
          class="explorer__action"
          :disabled="busy"
          title="New file"
          aria-label="New file"
          @click="onNewFile()"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 1.75H4.5a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5.25z" />
            <path d="M9 1.75v3.5h3.5" />
            <path d="M8 8v4M6 10h4" />
          </svg>
        </button>
        <button
          class="explorer__action"
          :disabled="busy"
          title="Refresh"
          aria-label="Refresh"
          @click="refresh()"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
            <path d="M13.5 2.5v3h-3" />
          </svg>
        </button>
      </span>
    </div>

    <ul class="explorer__tree">
      <TreeNode v-for="child of root.children ?? []" :key="child.path" :node="child" :depth="0" />
      <li v-if="(root.children ?? []).length === 0" class="node__empty">No Markdown files</li>
    </ul>
  </div>
</template>
