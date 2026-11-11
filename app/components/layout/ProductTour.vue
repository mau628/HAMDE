<script setup lang="ts">
/**
 * A short tour on the first visit: four steps, each pointing at one part of the
 * page. Skipped or finished, it never shows again.
 *
 * Without storage there is no way to tell a first visit from a later one, so the
 * tour stays closed rather than greeting every visit.
 */

const STORAGE_KEY = 'hamde:tour-done'

interface Step {
  /** What the step points at; `null` for a step about the whole page. */
  target: string | null
  title: string
  text: string
}

const steps: Step[] = [
  {
    target: '.shell__open',
    title: 'Open a folder',
    text: 'Pick a folder of Markdown notes. HAMDE edits the files in place, on your device. Nothing is uploaded.',
  },
  {
    target: '.shell__editor',
    title: 'Write with live preview',
    text: 'Markdown renders as you type, and the line with the cursor shows its syntax. Every change saves automatically.',
  },
  {
    target: null,
    title: 'Or drop a file in',
    text: 'Drag a .md file anywhere onto the page to open it, even one from outside the folder.',
  },
  {
    target: '.editor__tools',
    title: 'Print and widen',
    text: 'Print the document or switch to a wider editor here. The button at the top of the sidebar hides it.',
  },
]

const index = ref<number | null>(null)
const step = computed(() => (index.value === null ? null : steps[index.value]!))

const card = ref<HTMLElement | null>(null)
const nextButton = ref<HTMLButtonElement | null>(null)

/** The highlighted area and where the card sits, in viewport pixels. */
const spot = ref<{ top: number; left: number; width: number; height: number } | null>(null)
const position = ref<{ top: number; left: number }>({ top: 0, left: 0 })

const GAP = 12
const MARGIN = 16

/** Places the highlight on the step's target, and the card beside it. */
async function place(): Promise<void> {
  if (step.value === null) return

  const element = step.value.target === null ? null : document.querySelector(step.value.target)
  const rect = element?.getBoundingClientRect()
  // A target that is not on screen (a collapsed sidebar) leaves the card centred.
  spot.value =
    rect && rect.width > 0 && rect.height > 0
      ? { top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }
      : null

  await nextTick()
  const size = card.value?.getBoundingClientRect()
  if (!size) return
  const width = window.innerWidth
  const height = window.innerHeight
  const clampLeft = (left: number) => Math.min(Math.max(left, MARGIN), width - size.width - MARGIN)

  if (spot.value === null) {
    position.value = { top: (height - size.height) / 2, left: (width - size.width) / 2 }
    return
  }

  const target = spot.value
  const centred = clampLeft(target.left + target.width / 2 - size.width / 2)
  if (target.top + target.height + GAP + size.height <= height - MARGIN) {
    position.value = { top: target.top + target.height + GAP, left: centred }
  } else if (target.top - GAP - size.height >= MARGIN) {
    position.value = { top: target.top - GAP - size.height, left: centred }
  } else {
    // A target as tall as the window, like the editor: the card goes inside it.
    position.value = { top: target.top + (target.height - size.height) / 2, left: centred }
  }
}

function finish(): void {
  index.value = null
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // ignore: without storage the tour would not have opened in the first place
  }
}

async function go(next: number): Promise<void> {
  if (next >= steps.length) return finish()
  index.value = next
  await place()
  nextButton.value?.focus()
}

function onResize(): void {
  void place()
}

onMounted(() => {
  let done = true
  try {
    done = localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    // ignore
  }
  if (done) return

  window.addEventListener('resize', onResize)
  void go(0)
})

onBeforeUnmount(() => window.removeEventListener('resize', onResize))
</script>

<template>
  <div v-if="step" class="tour" @keydown.esc="finish">
    <div v-if="spot" class="tour__spot" :style="{ top: `${spot.top}px`, left: `${spot.left}px`, width: `${spot.width}px`, height: `${spot.height}px` }" />
    <div v-else class="tour__backdrop" />

    <div
      ref="card"
      class="tour__card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      :style="{ top: `${position.top}px`, left: `${position.left}px` }"
    >
      <h2 id="tour-title" class="tour__title">{{ step.title }}</h2>
      <p class="tour__text">{{ step.text }}</p>

      <div class="tour__footer">
        <span class="tour__count">{{ index! + 1 }} / {{ steps.length }}</span>
        <button class="tour__skip" type="button" @click="finish">Skip</button>
        <button ref="nextButton" class="tour__next" type="button" @click="go(index! + 1)">
          {{ index === steps.length - 1 ? 'Done' : 'Next' }}
        </button>
      </div>
    </div>
  </div>
</template>
