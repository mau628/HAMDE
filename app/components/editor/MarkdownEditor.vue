<script setup lang="ts">
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { createEditorExtensions } from '~/editor/editorConfig'

const props = defineProps<{
  /** The document's Markdown source. */
  doc: string
  /** Blocks edits. Used for files on disk until autosave exists (M3). */
  readonly?: boolean
}>()

const emit = defineEmits<{
  /** Fired whenever the user changes the document. Carries the full Markdown. */
  change: [doc: string]
}>()

const host = ref<HTMLElement>()
let view: EditorView | undefined

// A compartment lets the read-only flag change without rebuilding the editor.
const readOnlyCompartment = new Compartment()

onMounted(() => {
  view = new EditorView({
    state: EditorState.create({
      doc: props.doc,
      extensions: [
        ...createEditorExtensions(),
        readOnlyCompartment.of(EditorState.readOnly.of(Boolean(props.readonly))),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) emit('change', update.state.doc.toString())
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

// Read-only blocks user input only: the app can still replace the document below.
watch(
  () => props.readonly,
  (next) => {
    view?.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(Boolean(next))),
    })
  },
)

/**
 * Replaces the whole document when a different file is opened.
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
    })
  },
)
</script>

<template>
  <div ref="host" class="editor" />
</template>

<style scoped>
.editor {
  height: 100%;
}
</style>
