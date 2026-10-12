<script setup lang="ts">
import { Annotation, EditorState } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'

import { createEditorExtensions } from '~/editor/editorConfig'
import { printDocument } from '~/editor/print'
import { loadWorkspaceImage } from '~/services/imageService'
import { MOD_KEY_LABEL } from '~/services/links'

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

/** Prints the document. A saved PDF is named after the file, not after the app. */
function printNow(): void {
  if (!view) return
  const name = activeDocument.value?.file.name.replace(/.(md|markdown)$/i, '')
  void printDocument(view, { title: name })
}

const IS_MAC = MOD_KEY_LABEL === 'Cmd'

function onKeydown(event: KeyboardEvent): void {
  // Ctrl+P on a Mac is "previous line", in the editor as in every other text field.
  const mod = IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (!mod || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'p') return

  // The browser would print the page as it stands: the app, and one screenful of
  // the document.
  event.preventDefault()
  printNow()
}

// On the window, so the key works wherever the focus is, as it does in a browser.
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

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
        ...createEditorExtensions({ resolveImage, toggleWidth }),
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
    <div class="editor__tools">
      <button
        type="button"
        class="editor__tool"
        :title="`Print (${MOD_KEY_LABEL}+P)`"
        aria-label="Print"
        @click="printNow"
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
          <path d="M7 8V3h10v5" />
          <path d="M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <path d="M7 14h10v7H7z" />
        </svg>
      </button>
      <button
        type="button"
        class="editor__tool"
        :title="`${wide ? 'Narrow editor' : 'Wide editor'} (${MOD_KEY_LABEL}+,)`"
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

.editor__tools {
  position: absolute;
  top: 8px;
  right: 20px;
  z-index: 10;
  display: flex;
  gap: 4px;
  background: var(--color-bg);
}

.editor__tool {
  display: flex;
  padding: 4px;
  color: var(--color-text-muted);
  background: none;
  border: 0;
  cursor: pointer;
}

.editor__tool:hover,
.editor__tool:focus-visible {
  color: var(--color-accent);
}

/* The page margins follow the width; the two pages are defined in main.css. */
@media print {
  .editor {
    page: hamde-narrow;
  }

  .editor--wide {
    page: hamde-wide;
  }

  .editor__host {
    height: auto;
  }

  .editor__tools {
    display: none;
  }
}
</style>
