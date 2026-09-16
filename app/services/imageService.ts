import { fileSystemService } from '~/services/fileSystemService'
import type { DirectoryNode } from '~/types/fileSystem'

/**
 * Images from the user's folder.
 *
 * A remote image is never loaded. Fetching `![](https://tracker.example/x.png)`
 * would tell that server which note is open and when — the exact disclosure this
 * app exists to avoid — so a remote source is shown as text instead.
 *
 * A local image is read through the directory handle the user granted and handed
 * to the browser as a `blob:` URL, which is why `img-src` allows `blob:` and no
 * remote host at all.
 */

const CACHE_LIMIT = 50

/** Object URLs by path, so scrolling past an image does not re-read it. */
const cache = new Map<string, string>()

/** Whether the source names a scheme — http, data, anything. */
export function hasScheme(source: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(source.trim())
}

/**
 * Whether this is a path we can resolve inside the workspace.
 *
 * Anything with a scheme is refused: a remote one would leak, and a `data:` one is
 * not worth the surface. So is a path that climbs out of the folder with `..`, or
 * an absolute one — the user granted access to one directory, and the editor stays
 * inside it.
 */
export function isWorkspacePath(source: string): boolean {
  const path = source.trim()
  if (path === '' || hasScheme(path)) return false
  if (path.startsWith('/') || path.startsWith('\\')) return false

  return path.split('/').every((segment) => segment !== '..')
}

/**
 * Reads an image from the workspace and returns an object URL for it.
 *
 * Returns `null` when the path is outside the workspace, missing, or not an image.
 */
export async function loadWorkspaceImage(
  root: DirectoryNode | null,
  documentPath: string,
  source: string,
): Promise<string | null> {
  if (root === null || !isWorkspacePath(source)) return null

  const path = resolvePath(documentPath, source)
  const cached = cache.get(path)
  if (cached !== undefined) return cached

  const file = await readImage(root, path)
  if (file === null) return null

  const url = URL.createObjectURL(file)
  remember(path, url)
  return url
}

/** Resolves an image path relative to the document that references it. */
export function resolvePath(documentPath: string, source: string): string {
  const base = documentPath.split('/').slice(0, -1)
  const segments = source.trim().split('/').filter((segment) => segment !== '' && segment !== '.')

  return [...base, ...segments].join('/')
}

/** Frees the object URLs held for a workspace that is being left. */
export function releaseImages(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url)
  cache.clear()
}

function remember(path: string, url: string): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (!oldest.done) {
      URL.revokeObjectURL(cache.get(oldest.value)!)
      cache.delete(oldest.value)
    }
  }
  cache.set(path, url)
}

const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
])

/**
 * Reads the file and checks it really is an image.
 *
 * Handing the browser a `blob:` URL for an arbitrary file and rendering it as an
 * image is not something to do blindly. SVG is on the list because an SVG loaded
 * through `<img>` is inert: it cannot run script or reach the page around it.
 */
async function readImage(root: DirectoryNode, path: string): Promise<File | null> {
  const file = await fileSystemService.readFileAtPath(root, path)
  if (file === null) return null

  return IMAGE_TYPES.has(file.type) ? file : null
}
