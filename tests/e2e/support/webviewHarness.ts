import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

import type { Page } from '@playwright/test'

import type { FromWebview, ToWebview } from '../../../vscode/src/protocol'
import { webviewHtml } from '../../../vscode/src/webviewHtml'

/**
 * Loads the extension's webview in a plain browser page, with a stand-in for VS Code.
 *
 * The page is the one the extension builds (`webviewHtml`), with its real Content
 * Security Policy, and the script is the built bundle from vscode/dist. Only the two
 * things VS Code itself provides are faked: the origin the files are served from,
 * and `acquireVsCodeApi`, which here records what the webview posts.
 */

/** Never resolved: every request to it is answered from disk by the route below. */
export const ORIGIN = 'http://webview.test'

const DIST = 'vscode/dist/webview'

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
}

/** A one-pixel PNG, standing in for an image: in the user's workspace, or on the web. */
export const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

export interface Harness {
  /** Delivers a message as the extension would. */
  send(message: ToWebview): Promise<void>
  /** Everything the webview has posted so far. */
  sent(): Promise<FromWebview[]>
  /** The messages of one type. */
  sentOf<Type extends FromWebview['type']>(
    type: Type,
  ): Promise<Extract<FromWebview, { type: Type }>[]>
  /** The editor's document, as CodeMirror holds it. */
  text(): Promise<string>
}

export async function openWebview(page: Page, savedState?: unknown): Promise<Harness> {
  const html = webviewHtml({
    cspSource: ORIGIN,
    scriptUri: ORIGIN + '/main.js',
    styleUri: ORIGIN + '/webview.css',
  })

  await page.route(ORIGIN + '/**', async (route) => {
    const { pathname } = new URL(route.request().url())

    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
    if (pathname.startsWith('/workspace/')) {
      return route.fulfill({ contentType: 'image/png', body: PIXEL })
    }

    const body = await readFile(join(DIST, pathname)).catch(() => null)
    if (body === null) return route.fulfill({ status: 404, body: 'Not found' })

    return route.fulfill({ contentType: CONTENT_TYPES[extname(pathname)], body })
  })

  await page.addInitScript((initialState) => {
    const sent: unknown[] = []
    let state = initialState ?? undefined

    Object.assign(window, {
      __sent: sent,
      acquireVsCodeApi: () => ({
        postMessage: (message: unknown) => sent.push(message),
        getState: () => state,
        setState: (next: unknown) => {
          state = next
        },
      }),
    })
  }, savedState ?? null)

  await page.goto(ORIGIN + '/')

  const sent = () =>
    page.evaluate(() => (window as unknown as { __sent: FromWebview[] }).__sent)

  return {
    send: (message) => page.evaluate((data) => window.postMessage(data, '*'), message),
    sent,
    sentOf: async (type) =>
      (await sent()).filter(
        (message): message is Extract<FromWebview, { type: typeof type }> => message.type === type,
      ),
    text: () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.cm-line')].map((line) => line.textContent).join('\n'),
      ),
  }
}
