import { Facet, type EditorState } from '@codemirror/state'
import { WidgetType } from '@codemirror/view'

import { isRemoteImage, isWorkspacePath } from '~/services/imagePath'

/**
 * Images, from the user's own folder and from the web.
 *
 * A file in the folder is read through the host, which is the part that knows
 * where the files are. An `https:` image is loaded from where it says it is, the
 * way a README is written to be read: a logo, a row of badges.
 *
 * That second kind is the one request this app makes that leaves the machine, and
 * it is worth being exact about what it is. Opening a document that names a remote
 * image tells that image's server that someone, at this address, at this moment,
 * asked for it. It sends no referrer and nothing from the document: there is no
 * script in a document to read the document with. See docs/security.md.
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

/** Decides whether a source is one the resolver should be asked about. */
export type ImageSourceFilter = (source: string) => boolean

/**
 * Which sources are rendered at all; the rest stay as Markdown.
 *
 * The browser app can read only inside the folder it was granted, so the default
 * refuses anything that leaves it. A host that enforces a boundary of its own
 * supplies its own rule.
 */
export const imageSourceFilter = Facet.define<ImageSourceFilter, ImageSourceFilter>({
  combine: (values) => values[0] ?? isWorkspacePath,
})

/** Says how a source is loaded, or `null` if it is one the editor does not show. */
export type ImageLoader = (source: string) => ImageResolver | null

/** A remote image is already an address the browser can load. */
const loadRemote: ImageResolver = async (source) => source.trim()

/**
 * How the images of a document are loaded, decided once for a given state.
 *
 * The facets are read here rather than at each image, so a widget can keep the
 * result without keeping the state it came from.
 */
export function imageLoader(state: EditorState): ImageLoader {
  const resolve = state.facet(imageResolver)
  const accepts = state.facet(imageSourceFilter)

  return (source) => {
    if (isRemoteImage(source)) return loadRemote
    return resolve !== null && accepts(source) ? resolve : null
  }
}

/** A size written on an `<img>`: a number of pixels, or a percentage. */
export interface ImageSize {
  width?: string
  height?: string
}

export class ImageWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly alt: string,
    private readonly resolve: ImageResolver,
    private readonly size: ImageSize = {},
  ) {
    super()
  }

  override eq(other: ImageWidget): boolean {
    return (
      other.source === this.source &&
      other.alt === this.alt &&
      other.size.width === this.size.width &&
      other.size.height === this.size.height
    )
  }

  override get estimatedHeight(): number {
    // Unknown until it loads; a line's worth keeps the height map from claiming
    // the image takes no space at all.
    return 24
  }

  override toDOM(): HTMLElement {
    return imageFigure(this.source, this.alt, this.resolve, this.size)
  }

  override ignoreEvent(): boolean {
    // A click puts the cursor on the line, which reveals the Markdown — the same
    // behaviour as clicking any other rendered element.
    return false
  }
}

/**
 * An image from the workspace, as an element that fills itself in.
 *
 * Shared by the Markdown image widget and by `<img>` in rendered HTML, so both go
 * through the same resolver and say the same thing when there is nothing to show.
 * `onSettled` is for a caller whose height depends on the image.
 */
export function imageFigure(
  source: string,
  alt: string,
  resolve: ImageResolver,
  size: ImageSize = {},
  onSettled?: () => void,
): HTMLElement {
  const figure = document.createElement('span')
  figure.className = 'cm-md-image'

  const image = document.createElement('img')
  image.alt = alt
  image.className = 'cm-md-image__img'
  // A remote server is told that the image was asked for, and nothing about by what.
  image.referrerPolicy = 'no-referrer'
  setLength(image, 'width', size.width)
  setLength(image, 'height', size.height)
  if (onSettled !== undefined) image.addEventListener('load', onSettled, { once: true })
  figure.append(image)

  /** Says so in words, rather than leaving a blank space or a broken-image icon. */
  const fail = (note: string) => {
    figure.replaceChildren(imageNote(note))
    onSettled?.()
  }

  // Offline, or a server that no longer has it: the description is what is left.
  image.addEventListener('error', () => fail(alt.trim() || 'Image not loaded: ' + source), {
    once: true,
  })

  void resolve(source).then((url) => {
    if (!figure.isConnected) return
    if (url === null) return fail('Image not found: ' + source)

    image.src = url
  })

  return figure
}

/** What stands where an image would be, when there is none to show. */
export function imageNote(text: string): HTMLElement {
  const note = document.createElement('span')
  note.className = 'cm-md-image__missing'
  note.textContent = text
  return note
}

function setLength(image: HTMLImageElement, side: 'width' | 'height', value?: string): void {
  if (value === undefined) return

  // A percentage is relative to the text column, which only CSS can express.
  if (value.endsWith('%')) image.style[side] = value
  else image[side] = Number(value)
}