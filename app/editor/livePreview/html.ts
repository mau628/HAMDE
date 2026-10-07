import { WidgetType, type EditorView } from '@codemirror/view'

import { blockStart, moveCursorTo } from './blockCursor'
import type { BlockRenderer } from './blockPreview'
import { isRenderableHtml, parseHtml } from './htmlModel'
import { htmlToDom } from './htmlToDom'
import { imageLoader, type ImageLoader } from './images'
import { followLink } from './linkFollow'

/**
 * HTML blocks, rendered.
 *
 * Until now embedded HTML was shown as text, which kept it from ever being
 * executed but also made the commonest uses of it unreadable: a centred logo at
 * the top of a README, a `<details>`, a table with a merged cell. A safe subset is
 * now drawn in place. What "safe" means, and how it is enforced, is in
 * `htmlModel.ts` and docs/security.md.
 *
 * It behaves like the other replaced blocks. The cursor anywhere inside shows the
 * source, a click on it puts the cursor there, and arrowing into it works.
 *
 * Three kinds of block stay as source, each because drawing it would mislead:
 *
 * - One that is not balanced on its own. CommonMark ends an HTML block at a blank
 *   line, so `<details>` around several paragraphs is an opening half, some
 *   Markdown, and a closing half. Neither half is a thing that can be drawn.
 * - One with nothing visible left once it is made safe, such as a comment or a
 *   `<script>`. Replacing it would make it vanish from the page.
 * - One inside a list or a quote. A block replacement covers whole lines and would
 *   swallow the indentation or the `>` that puts it there.
 */
export const htmlRenderer: BlockRenderer = {
  matches: (node, state) =>
    node.name === 'HTMLBlock' &&
    node.node.parent?.name === 'Document' &&
    isRenderableHtml(parseHtml(state.doc.sliceString(node.from, node.to))),

  source: (state, node) => state.doc.sliceString(node.from, node.to),

  widget: (source, state) => new HtmlWidget(source, imageLoader(state)),
}

export class HtmlWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly loadImage: ImageLoader,
  ) {
    super()
  }

  /** The same source draws the same thing, so the DOM is kept as the cursor moves. */
  override eq(other: HtmlWidget): boolean {
    return other.source === this.source
  }

  override get estimatedHeight(): number {
    return this.source.split('\n').length * 24
  }

  override toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div')
    container.className = 'cm-md-html'
    container.append(
      htmlToDom(parseHtml(this.source).nodes, {
        loadImage: this.loadImage,
        onResize: () => view.requestMeasure(),
      }),
    )

    this.handleClicks(container, view)
    return container
  }

  /**
   * A click puts the cursor in the block, which reveals its source.
   *
   * Two gestures are not that. Ctrl/Cmd+click on a link follows it, which is how
   * every link in this editor opens. And a click on a `<summary>` is left to the
   * browser, because a `<details>` that cannot be opened is not rendered, only drawn.
   */
  private handleClicks(container: HTMLElement, view: EditorView): void {
    container.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      if (closest(event, 'summary') !== null) return
      if ((event.ctrlKey || event.metaKey) && closest(event, 'a') !== null) return

      event.preventDefault()

      const start = blockStart(view, container)
      if (start === null) return

      // One past the block's first character, so the cursor lands inside the block
      // rather than on the boundary with the paragraph above.
      const line = view.state.doc.lineAt(start)
      moveCursorTo(view, Math.min(line.to, start + 1))
    })

    // The anchor never navigates on its own. A plain click was a click on editable
    // text, and a Ctrl/Cmd+click goes where every other link in the editor goes:
    // to a heading of this document, or to the host with its target checked again.
    container.addEventListener('click', (event) => {
      const anchor = closest(event, 'a')
      if (anchor === null) return

      event.preventDefault()
      if (event.ctrlKey || event.metaKey) followLink(view, anchor.getAttribute('href') ?? '')
    })

    // Opening a <details> changes the block's height, and `toggle` does not bubble.
    container.addEventListener('toggle', () => view.requestMeasure(), true)
  }
}

function closest(event: MouseEvent, selector: string): Element | null {
  return event.target instanceof Element ? event.target.closest(selector) : null
}
