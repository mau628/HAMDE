/**
 * Which image sources the editor will consider, as plain path logic.
 *
 * Separate from `imageService` so the editor core can ask these questions without
 * pulling in the file system service, which exists only in the browser app.
 */

/** Whether the source names a scheme — http, data, anything. */
export function hasScheme(source: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(source.trim())
}

/**
 * Whether this is a relative path on disk at all.
 *
 * Anything with a scheme is refused: a remote one would leak, and a `data:` one is
 * not worth the surface. So is an absolute path. Whether a relative path may climb
 * with `..` is a separate question, because the answer depends on where the boundary
 * is: see `isWorkspacePath`.
 */
export function isLocalPath(source: string): boolean {
  const path = source.trim()
  if (path === '' || hasScheme(path)) return false

  return !(path.startsWith('/') || path.startsWith('\\'))
}

/**
 * Whether this is a path we can resolve inside the workspace.
 *
 * On top of `isLocalPath`, a path that climbs out of the folder with `..` is
 * refused — the user granted access to one directory, and the editor stays inside
 * it.
 */
export function isWorkspacePath(source: string): boolean {
  if (!isLocalPath(source)) return false

  return source
    .trim()
    .split('/')
    .every((segment) => segment !== '..')
}

/** Resolves an image path relative to the document that references it. */
export function resolvePath(documentPath: string, source: string): string {
  const base = documentPath.split('/').slice(0, -1)
  const segments = source.trim().split('/').filter((segment) => segment !== '' && segment !== '.')

  return [...base, ...segments].join('/')
}
