import { Facet } from '@codemirror/state'
import { WidgetType } from '@codemirror/view'

/**
 * Images, rendered only when they come from the user's own folder.
 *
 * A remote image is left as Markdown source, on purpose. Loading
 * `![](https://tracker.example/x.png)` would tell that server which note is open
 * and when, which is the disclosure this whole app is arranged to prevent. There
 * is no setting for it: `img-src` in the CSP does not allow a remote host either,
 * so it could not work even if this code tried.
 */

/** Resolves a path in the document to an object URL, or `null`. */
export type ImageResolver = (source: string) => Promise<string | null>

/**
 * How the editor reaches the workspace.
 *
 * A facet rather than an import, so the editor layer stays free of the app's
 * composables and a test can provide its own resolver.
 */
export const imageResolver = Facet.define<ImageResolver, ImageResolver | null>({
  combine: (values) => values[0] ?? null,
})

export class ImageWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly alt: string,
    private readonly resolve: ImageResolver,
  ) {
    super()
  }

  override eq(other: ImageWidget): boolean {
    return other.source === this.source && other.alt === this.alt
  }

  override get estimatedHeight(): number {
    // Unknown until it loads; a line's worth keeps the height map from claiming
    // the image takes no space at all.
    return 24
  }

  override toDOM(): HTMLElement {
    const figure = document.createElement('span')
    figure.className = 'cm-md-image'

    const image = document.createElement('img')
    image.alt = this.alt
    image.className = 'cm-md-image__img'
    figure.append(image)

    void this.load(figure, image)
    return figure
  }

  private async load(figure: HTMLElement, image: HTMLImageElement): Promise<void> {
    const url = await this.resolve(this.source)

    if (!figure.isConnected) return

    if (url === null) {
      // Nothing to show, and nothing to fetch: say which file is missing rather
      // than leaving a blank space.
      figure.replaceChildren(missing(this.source))
      return
    }

    image.src = url
  }

  override ignoreEvent(): boolean {
    // A click puts the cursor on the line, which reveals the Markdown — the same
    // behaviour as clicking any other rendered element.
    return false
  }
}

function missing(source: string): HTMLElement {
  const note = document.createElement('span')
  note.className = 'cm-md-image__missing'
  note.textContent = 'Image not found: ' + source
  return note
}
