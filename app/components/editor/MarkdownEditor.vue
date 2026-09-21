<script setup lang="ts">
import { Annotation, EditorState } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'

import { createEditorExtensions } from '~/editor/editorConfig'
import { loadWorkspaceImage } from '~/services/imageService'

const props = defineProps<{
  /** The document's Markdown source. */
  doc: string
}>()

const emit = defineEmits<{
  /** Fired when the *user* changes the document. Carries the full Markdown. */
  change: [doc: string]
}>()

/**
 * Marks a transaction as the app replacing the document rather than the user typing.
 *
 * Without this, loading a document looks exactly like an edit: the replacement
 * dispatch reports `docChanged`, the app marks the document dirty, and autosave
 * writes the file straight back — changing its timestamp although nothing was
 * edited.
 */
const ProgrammaticChange = Annotation.define<boolean>()

const { root } = useWorkspace()
const { activeDocument } = useDocument()

const host = ref<HTMLElement>()

const WIDTH_KEY = 'hamde.editorWide'

/** Narrow is the reading measure; wide fills the space the parent gives the editor. */
const wide = ref(false)

// A convenience only: storage can be blocked or empty, and narrow is a fine default.
onMounted(() => {
  try {
    wide.value = localStorage.getItem(WIDTH_KEY) === '1'
  } catch {
    // ignore
  }
})

function toggleWidth(): void {
  wide.value = !wide.value
  try {
    localStorage.setItem(WIDTH_KEY, wide.value ? '1' : '0')
  } catch {
    // ignore
  }
}
let view: EditorView | undefined

/**
 * Images resolve against the open folder and the document that references them.
 * Read at call time, so the editor does not need rebuilding when either changes.
 */
function resolveImage(source: string) {
  return loadWorkspaceImage(root.value, activeDocument.value?.file.path ?? '', source)
}

function isProgrammatic(update: ViewUpdate): boolean {
  return update.transactions.some((transaction) => transaction.annotation(ProgrammaticChange))
}

onMounted(() => {
  view = new EditorView({
    state: EditorState.create({
      doc: props.doc,
      extensions: [
        ...createEditorExtensions({ resolveImage }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isProgrammatic(update)) {
            emit('change', update.state.doc.toString())
          }
        }),
      ],
    }),
    parent: host.value!,
  })
})

onBeforeUnmount(() => {
  view?.destroy()
  view = undefined
})

/**
 * Replaces the whole document when another file is opened, or when the open one is
 * reloaded from disk.
 *
 * Guarded against the echo of our own `change` event: replacing the document with
 * identical text would reset the cursor and pollute the undo history.
 */
watch(
  () => props.doc,
  (next) => {
    if (!view || view.state.doc.toString() === next) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
      selection: { anchor: 0 },
      annotations: ProgrammaticChange.of(true),
    })
  },
)
</script>

<template>
  <div class="editor" :class="{ 'editor--wide': wide }">
    <div ref="host" class="editor__host" />
    <button
      type="button"
      class="editor__width"
      :title="wide ? 'Narrow editor' : 'Wide editor'"
      :aria-label="wide ? 'Narrow editor' : 'Wide editor'"
      :aria-pressed="wide"
      @click="toggleWidth"
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <template v-if="wide">
          <!-- |-><-| : shrink -->
          <path d="M3 4v16M21 4v16" />
          <path d="M7 12h4M9 10l2 2-2 2" />
          <path d="M17 12h-4M15 10l-2 2 2 2" />
        </template>
        <path v-else d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.editor {
  /* Fills what the conflict bar leaves; min-height lets it shrink and scroll. */
  flex: 1;
  min-height: 0;
  position: relative;
}

.editor__host {
  height: 100%;
}

.editor--wide .editor__host :deep(.cm-content) {
  max-width: none;
}

.editor__width {
  position: absolute;
  top: 8px;
  right: 20px;
  z-index: 10;
  display: flex;
  padding: 4px;
  color: var(--color-text-muted);
  background: var(--color-bg);
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
}

.editor__width:hover,
.editor__width:focus-visible {
  color: var(--color-text);
  border-color: var(--color-text-muted);
}
</style>
