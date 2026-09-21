#!/usr/bin/env node
/**
 * Serves .output/public exactly as a static host would.
 *
 * `nuxt preview` renders HTML through Nitro, which bypasses the post-processed
 * files (and therefore the hashed CSP). End-to-end tests must exercise the real
 * artifact, so this serves the directory verbatim, with a 404.html SPA fallback.
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'

const ROOT = '.output/public'
const PORT = Number(process.env.PORT ?? 3000)

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

async function resolveFile(pathname) {
  // Reject traversal by dropping any segment that is not a plain name.
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // Malformed percent-encoding (e.g. `%E0%A4%A`) is a bad request, not a crash.
    return undefined
  }
  const segments = decoded
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  const relative = segments.join("/")
  const candidates = [join(ROOT, relative)]

  if (relative === '' || extname(relative) === '') {
    candidates.push(join(ROOT, relative, 'index.html'))
  }
  candidates.push(join(ROOT, '404.html'))

  for (const candidate of candidates) {
    const info = await stat(candidate).catch(() => null)
    if (info?.isFile()) return candidate
  }
  return null
}

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', `http://localhost:${PORT}`)
  const file = await resolveFile(pathname)

  if (file === undefined) {
    response.writeHead(400, { 'content-type': 'text/plain' })
    response.end('Bad request')
    return
  }

  if (file === null) {
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('Not found')
    return
  }

  response.writeHead(file.endsWith('404.html') && pathname !== '/404.html' ? 404 : 200, {
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  })
  createReadStream(file).pipe(response)
})

server.listen(PORT, () => console.log(`Serving ${ROOT} on http://localhost:${PORT}`))
