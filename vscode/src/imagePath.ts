import { isLocalPath } from '~/services/imagePath'

/**
 * Where an image named in a document is on disk, or `null` if it may not be shown.
 *
 * Pure path logic on the `/`-separated path of a URI, so it can be tested without
 * VS Code. The rules are the web app's, with one difference: a path may climb with
 * `..`, because here the boundary is the workspace folder rather than the folder
 * the document sits in. `docs/guide.md` pointing at `../assets/diagram.png` is the
 * ordinary layout of a repository.
 *
 * What is never handed over: anything with a scheme, an absolute path, a file that
 * is not an image, and anything that resolves outside `rootPath`. An `https:` image
 * is among them only because it is not a file: the webview loads those itself, and
 * the extension is never asked about one.
 */
export function resolveImagePath(
  documentPath: string,
  rootPath: string,
  source: string,
  ignoreCase = false,
): string | null {
  if (!isLocalPath(source)) return null

  // The document's directory. A URI path starts with `/`, so the first segment is
  // empty and stands for the root, which `..` may not climb past.
  const segments = documentPath.split('/').slice(0, -1)

  // A backslash is a separator on Windows whatever the URI says, so it is treated
  // as one here: `..\..\secret.png` must not slip through as a single odd segment.
  for (const segment of source.trim().replaceAll('\\', '/').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length <= 1) return null
      segments.pop()
      continue
    }
    segments.push(segment)
  }

  const path = segments.join('/')
  if (!isImageFile(path) || !isInside(rootPath, path, ignoreCase)) return null

  return path
}

/** The formats the web app accepts, by extension: there is no MIME type on disk. */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']

export function isImageFile(path: string): boolean {
  const lower = path.toLowerCase()
  return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/** Whether `path` is somewhere under the directory `root`. */
export function isInside(root: string, path: string, ignoreCase = false): boolean {
  const prefix = root.endsWith('/') ? root : root + '/'

  return ignoreCase
    ? path.toLowerCase().startsWith(prefix.toLowerCase())
    : path.startsWith(prefix)
}
