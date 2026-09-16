import type { EditorState } from '@codemirror/state'
import { WidgetType, type EditorView } from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'

import { cachedDiagram, renderDiagram } from '~/services/mermaidService'
import { blockStart, moveCursorTo } from './blockCursor'
import type { BlockRenderer } from './blockPreview'

/**
 * Mermaid diagrams, rendered in place of their source.
 *
 * This is the deliberate exception to "only the cursor's line shows its syntax": a
 * diagram is a multi-line structure, and revealing one line of it inside a drawing
 * would read as broken. The cursor anywhere in the block shows the whole block as
 * code, which is also how it gets edited.
 */

/** The info string of a fenced block, lower-cased. */
function fenceInfo(state: EditorState, node: SyntaxNodeRef): string {
  const info = node.node.getChild('CodeInfo')
  return info === null ? '' : state.doc.sliceString(info.from, info.to).trim().toLowerCase()
}

export const mermaidRenderer: BlockRenderer = {
  matches: (node, state) => node.name === 'FencedCode' && fenceInfo(state, node) === 'mermaid',

  source: (state, node) => {
    const code = node.node.getChild('CodeText')
    return code === null ? '' : state.doc.sliceString(code.from, code.to)
  },

  widget: (source) => new MermaidWidget(source),
}

export class MermaidWidget extends WidgetType {
  constructor(private readonly code: string) {
    super()
  }

  /**
   * Two widgets are the same when their source is, so moving the cursor around the
   * document never re-renders a diagram — CodeMirror keeps the DOM that is there.
   */
  override eq(other: MermaidWidget): boolean {
    return other.code === this.code
  }

  /**
   * Rough height while the diagram is being rendered, so the height map does not
   * have to guess and the page does not jump once the SVG arrives.
   */
  override get estimatedHeight(): number {
    return 40 + this.code.split('\n').length * 18
  }

  override toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div')
    container.className = 'cm-md-diagram'
    container.title = 'Click to edit the diagram'

    // Clicking a rendered block has to put the cursor inside it, which is what
    // reveals the source — that is how a diagram is edited. Leaving it to the
    // editor does not work for a block widget: the click maps to a position
    // outside the replaced range, so the diagram never opens.
    container.addEventListener('mousedown', (event) => {
      event.preventDefault()
      this.placeCursorInside(view, container)
    })

    const cached = cachedDiagram(this.code)
    if (cached !== undefined) {
      container.append(cached.cloneNode(true))
      return container
    }

    // Something has to occupy the space until the render resolves, and the source
    // is the honest placeholder: it is what the block contains.
    const placeholder = document.createElement('pre')
    placeholder.className = 'cm-md-diagram__pending'
    placeholder.textContent = this.code
    container.append(placeholder)

    void this.renderInto(container, view)
    return container
  }

  private async renderInto(container: HTMLElement, view: EditorView): Promise<void> {
    const result = await renderDiagram(this.code)

    // The widget may have been replaced while Mermaid was working.
    if (!container.isConnected) return

    container.replaceChildren(result.ok ? result.svg : errorBox(result.message, this.code))
    container.classList.toggle('cm-md-diagram--failed', !result.ok)

    // The block just changed height; tell the editor so scrolling stays honest.
    view.requestMeasure()
  }

  /** Moves the cursor into the block this widget stands for. */
  private placeCursorInside(view: EditorView, container: HTMLElement): void {
    const start = blockStart(view, container)
    if (start === null) return

    // One past the block's first character, so the cursor lands on a line inside
    // the block rather than on the boundary between it and the paragraph above.
    const line = view.state.doc.lineAt(start)
    moveCursorTo(view, Math.min(line.to, start + 1))
  }
}

/**
 * What a diagram that does not parse looks like.
 *
 * The message and the source, as text — the source stays visible so the user can
 * see what they are fixing without moving the cursor into the block.
 */
function errorBox(message: string, code: string): HTMLElement {
  const box = document.createElement('div')
  box.className = 'cm-md-diagram__error'

  const heading = document.createElement('p')
  heading.className = 'cm-md-diagram__message'
  heading.textContent = message
  box.append(heading)

  const source = document.createElement('pre')
  source.textContent = code
  box.append(source)

  return box
}
