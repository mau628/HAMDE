import type { Page } from '@playwright/test'

/**
 * Installs an in-page stand-in for `window.showDirectoryPicker`.
 *
 * The real picker is a native dialog that Playwright cannot drive, and granting a
 * browser permission to a real folder is not something a test should do to the
 * machine it runs on. The fake exercises the app's own code path — service,
 * composable, explorer, editor — against an in-memory folder.
 *
 * `folder` maps names to file contents; a nested object is a subdirectory.
 */
export type FakeFolder = { [name: string]: string | FakeFolder }

export async function installFakePicker(page: Page, folder: FakeFolder): Promise<void> {
  await page.addInitScript((tree: FakeFolder) => {
    // Files written through the app land here, so a test can read them back.
    const written = new Map<string, string>()
    ;(window as unknown as { __writtenFiles: Map<string, string> }).__writtenFiles = written

    let clock = 1_000_000
    const nextTimestamp = () => (clock += 1000)

    const makeFileHandle = (name: string, path: string, initial: string) => {
      const state = { contents: initial, lastModified: nextTimestamp() }

      return {
        kind: 'file' as const,
        name,
        async getFile() {
          const bytes = new TextEncoder().encode(state.contents)
          return {
            name,
            size: bytes.byteLength,
            lastModified: state.lastModified,
            text: async () => state.contents,
          }
        },
        async createWritable() {
          let buffer = ''
          return {
            async write(command: { data: Uint8Array | string }) {
              buffer = typeof command.data === 'string'
                ? command.data
                : new TextDecoder().decode(command.data)
            },
            async truncate() {
              // The fake stores text, so the explicit truncate is a no-op here.
            },
            async close() {
              state.contents = buffer
              state.lastModified = nextTimestamp()
              written.set(path, buffer)
            },
            async abort() {},
          }
        },
        async queryPermission() {
          return 'granted' as const
        },
        async requestPermission() {
          return 'granted' as const
        },
      }
    }

    const makeDirectoryHandle = (name: string, path: string, contents: FakeFolder) => ({
      kind: 'directory' as const,
      name,
      async *entries() {
        for (const [childName, value] of Object.entries(contents)) {
          const childPath = path === '' ? childName : path + '/' + childName
          yield [
            childName,
            typeof value === 'string'
              ? makeFileHandle(childName, childPath, value)
              : makeDirectoryHandle(childName, childPath, value),
          ]
        }
      },
      async queryPermission() {
        return 'granted' as const
      },
      async requestPermission() {
        return 'granted' as const
      },
    })

    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => makeDirectoryHandle('notes', '', tree),
    })
  }, folder)
}

/** Simulates the user dismissing the picker. */
export async function installCancellingPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        throw new DOMException('The user aborted a request.', 'AbortError')
      },
    })
  })
}

/** Simulates a browser without the File System Access API. */
export async function removePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'showDirectoryPicker')
  })
}
