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
  <div ref="host" class="editor" />
</template>

<style scoped>
.editor {
  /* Fills what the conflict bar leaves; min-height lets it shrink and scroll. */
  flex: 1;
  min-height: 0;
}
</style>
