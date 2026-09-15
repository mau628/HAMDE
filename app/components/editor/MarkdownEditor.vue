<script setup lang="ts">
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { createEditorExtensions } from '~/editor/editorConfig'

const props = defineProps<{
  /** The document's Markdown source. */
  doc: string
}>()

const emit = defineEmits<{
  /** Fired whenever the user changes the document. Carries the full Markdown. */
  change: [doc: string]
}>()

const host = ref<HTMLElement>()
let view: EditorView | undefined

onMounted(() => {
  view = new EditorView({
    state: EditorState.create({
      doc: props.doc,
      extensions: [
        ...createEditorExtensions(),
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

/**
 * Replaces the whole document when a different file is opened (M2).
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
