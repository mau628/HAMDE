import { syntaxTree } from '@codemirror/language'
import { Facet, Prec, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, keymap, type DecorationSet, type WidgetType } from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'

import { isRevealed, revealedSpans, type Span } from './reveal'

/**
 * Block-level preview: structures that are replaced as a whole.
 *
 * This is the second decoration layer, and it exists because of a hard rule the
 * inline layer lives under. CodeMirror:
 *
 * > Only decoration sets provided directly are allowed to influence the editor's
 * > vertical layout structure. The ones provided as functions are called after the
 * > new viewport has been computed, and thus must not introduce block widgets or
 * > replacing decorations that cover line breaks.
 *
 * A rendered Mermaid diagram replaces several lines with one drawing, which is
 * exactly such a layout change, so it cannot come from the view plugin. A state
 * field can do it, at the cost of not knowing the viewport: the scan below walks
 * the whole document, which is why it only descends into nodes that can contain a
 * block, and why it only re-runs when the document or the parse tree changes.
 *
 * The contract is deliberately "block replacements", not "Mermaid". A renderer is a
 * predicate plus a widget factory, so a rendered table would be one more entry in
 * the registry rather than another layer.
 */

export interface BlockRenderer {
  /** Identifies the blocks this renderer owns. */
  matches: (node: SyntaxNodeRef, state: EditorState) => boolean
  /** The content that decides whether two renders are the same. */
  source: (state: EditorState, node: SyntaxNodeRef) => string
  /** Builds the widget. Called on every rescan, so it must be cheap. */
  widget: (source: string) => WidgetType
}

interface Block {
  from: number
  to: number
  widget: WidgetType
}

interface BlockPreviewState {
  /** Every block in the document, whether or not it is currently replaced. */
  blocks: readonly Block[]
  decorations: DecorationSet
}

/** Node types that can contain a block. Everything else is not descended into. */
const CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem'])

/**
 * The renderers in use, as a facet.
 *
 * Configuration travels with the extension rather than through a module-level
 * registry, so a test can compose the layer with exactly the renderers it wants
 * and importing a module never has a side effect.
 */
export const blockRenderers = Facet.define<BlockRenderer, readonly BlockRenderer[]>({
  combine: (values) => values,
})

export const blockPreviewField = StateField.define<BlockPreviewState>({
  create(state) {
    const blocks = scan(state)
    return { blocks, decorations: decorate(state, blocks) }
  },

  update(previous, transaction) {
    // The parser reports its progress to the view as a transaction, so comparing
    // the trees here is what catches a diagram in a part of a large document that
    // the parser had not reached yet.
    const reparsed = syntaxTree(transaction.startState) !== syntaxTree(transaction.state)

    if (transaction.docChanged || reparsed) {
      const blocks = scan(transaction.state)
      return { blocks, decorations: decorate(transaction.state, blocks) }
    }

    // A cursor move changes what is revealed but not what the blocks are, so the
    // decorations are rebuilt from the blocks already found — no tree walk.
    if (transaction.selection) {
      return { blocks: previous.blocks, decorations: decorate(transaction.state, previous.blocks) }
    }

    return previous
  },

  provide: (self) => EditorView.decorations.from(self, (value) => value.decorations),
})

export function blockPreview(renderers: readonly BlockRenderer[]): Extension {
  return [
    renderers.map((renderer) => blockRenderers.of(renderer)),
    blockPreviewField,
    // Above the default keymap, whose ArrowUp/ArrowDown would otherwise handle
    // the key first and step straight over the block.
    Prec.high(
      keymap.of([
        { key: 'ArrowUp', run: (view) => stepIntoBlock(view, false) },
        { key: 'ArrowDown', run: (view) => stepIntoBlock(view, true) },
      ]),
    ),
  ]
}

/**
 * Lets an arrow key move *into* a replaced block instead of over it.
 *
 * A replaced block occupies no lines in the layout, so vertical motion steps
 * straight past it and the source can only be reached with the mouse. Here the
 * move is computed first; if it would jump a whole block, the cursor is put inside
 * that block instead, which reveals it.
 */
function stepIntoBlock(view: EditorView, forward: boolean): boolean {
  const blocks = replacedBlockRanges(view.state)
  if (blocks.length === 0) return false

  const cursor = view.state.selection.main
  const target = view.moveVertically(cursor, forward).head
  const [from, to] = forward ? [cursor.head, target] : [target, cursor.head]

  const jumped = blocks.find((block) => block.from >= from && block.to <= to)
  if (jumped === undefined) return false

  view.dispatch({
    selection: { anchor: forward ? jumped.from : jumped.to },
    scrollIntoView: true,
  })
  return true
}

/**
 * A note on what is deliberately missing here: these ranges are **not** atomic.
 *
 * Hidden inline syntax is atomic so the caret does not stall on invisible
 * characters. A replaced block is the opposite case: the user has to be able to get
 * into it, because that is how a diagram is edited. Making it atomic made the block
 * unreachable — arrow keys jumped over it and a click landed outside it, so the
 * source could never be revealed.
 */

/**
 * The ranges a block has taken over.
 *
 * The inline layer skips them: without that, both layers would decorate the same
 * lines and their atomic ranges would overlap.
 */
export function replacedBlockRanges(state: EditorState): readonly Span[] {
  const value = state.field(blockPreviewField, false)
  if (value === undefined) return []

  const ranges: Span[] = []
  value.decorations.between(0, state.doc.length, (from, to) => {
    ranges.push({ from, to })
  })
  return ranges
}

function scan(state: EditorState): Block[] {
  const renderers = state.facet(blockRenderers)
  if (renderers.length === 0) return []

  const blocks: Block[] = []

  syntaxTree(state).iterate({
    enter: (node) => {
      for (const renderer of renderers) {
        if (!renderer.matches(node, state)) continue

        blocks.push({
          // A block replacement covers whole lines, so the range is widened to the
          // line boundaries even when the node itself starts indented.
          from: state.doc.lineAt(node.from).from,
          to: state.doc.lineAt(node.to).to,
          widget: renderer.widget(renderer.source(state, node)),
        })
        return false
      }

      return CONTAINERS.has(node.name)
    },
  })

  return blocks
}

function decorate(state: EditorState, blocks: readonly Block[]): DecorationSet {
  const spans = revealedSpans(state)
  const ranges: Range<Decoration>[] = []

  for (const block of blocks) {
    // The cursor anywhere inside shows the source. A diagram cannot usefully reveal
    // one line of itself, so the whole structure is the unit.
    if (isRevealed(spans, block.from, block.to)) continue

    ranges.push(
      Decoration.replace({ widget: block.widget, block: true }).range(block.from, block.to),
    )
  }

  return Decoration.set(ranges, true)
}
