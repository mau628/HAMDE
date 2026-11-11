import type { Page } from '@playwright/test'

/**
 * Drops files onto the page the way Chromium hands them over.
 *
 * Playwright cannot drag from the desktop, so the drop is dispatched by hand: a real
 * `DataTransfer` with real `File`s in it, and `getAsFileSystemHandle` answering with
 * an in-memory handle for each. The app's own drop path — the listeners, the
 * service, the composables — runs exactly as it does for a real drop.
 *
 * Exposes `__droppedWrites` on `window`: what the app has written, by file name.
 */

export interface DroppedFile {
  name: string
  contents: string
  /** What `queryPermission` reports for writing. Defaults to `'prompt'`, as for a real drop. */
  permission?: PermissionState
  /** Whether `requestPermission` grants writing. Defaults to `true`. */
  grantOnRequest?: boolean
}

/** Installs the handle stand-in. Call before `page.goto`. */
export async function installDropSupport(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const handles = new Map<string, unknown>()
    const written = new Map<string, string>()
    let clock = 5_000_000

    Object.assign(window, {
      __droppedWrites: written,
      __registerDropped: (file: {
        name: string
        contents: string
        permission?: PermissionState
        grantOnRequest?: boolean
      }) => {
        const state = { contents: file.contents, lastModified: (clock += 1000) }
        let permission: PermissionState = file.permission ?? 'prompt'

        const handle = {
          kind: 'file' as const,
          name: file.name,
          async getFile() {
            const bytes = new TextEncoder().encode(state.contents)
            return {
              name: file.name,
              size: bytes.byteLength,
              lastModified: state.lastModified,
              text: async () => state.contents,
              arrayBuffer: async () => bytes.buffer,
            }
          },
          async createWritable() {
            if (permission !== 'granted') throw new DOMException('Not allowed', 'NotAllowedError')
            let buffer = ''
            return {
              async write(command: { data: Uint8Array }) {
                buffer = new TextDecoder().decode(command.data)
              },
              async truncate() {},
              async close() {
                state.contents = buffer
                state.lastModified = clock += 1000
                written.set(file.name, buffer)
              },
              async abort() {},
            }
          },
          async queryPermission(descriptor?: { mode?: string }) {
            return descriptor?.mode === 'readwrite' ? permission : 'granted'
          },
          async requestPermission() {
            if (file.grantOnRequest !== false) permission = 'granted'
            return permission
          },
          async isSameEntry(other: unknown) {
            return other === handle
          },
        }
        handles.set(file.name, handle)
      },
    })

    Object.defineProperty(DataTransferItem.prototype, 'getAsFileSystemHandle', {
      configurable: true,
      value(this: DataTransferItem) {
        const file = this.getAsFile()
        return Promise.resolve(file === null ? null : (handles.get(file.name) ?? null))
      },
    })
  })
}

/** Drops `files` onto `selector`, through dragenter, dragover and drop. */
export async function dropFiles(page: Page, files: DroppedFile[], selector = '.cm-content'): Promise<void> {
  await page.evaluate(
    ({ files, selector }) => {
      const register = (window as unknown as { __registerDropped: (file: unknown) => void })
        .__registerDropped
      const transfer = new DataTransfer()
      for (const file of files) {
        register(file)
        transfer.items.add(new File([file.contents], file.name, { type: 'text/markdown' }))
      }

      const target = document.querySelector(selector)
      if (target === null) throw new Error('No drop target: ' + selector)
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
        )
      }
    },
    { files, selector },
  )
}

/** What the app has written to dropped files, by name. */
export async function droppedWrites(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries((window as unknown as { __droppedWrites: Map<string, string> }).__droppedWrites),
  )
}
