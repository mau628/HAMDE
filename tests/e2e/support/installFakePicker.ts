import type { Page } from '@playwright/test'

/**
 * Installs an in-page stand-in for `window.showDirectoryPicker`.
 *
 * The real picker is a native dialog Playwright cannot drive, and granting a browser
 * permission to a real folder is not something a test should do to the machine it
 * runs on. The fake exercises the app's own code path — service, composables,
 * explorer, editor — against an in-memory folder.
 *
 * It exposes these hooks on `window`:
 *
 * - `__writtenFiles`: what the app has written, by path.
 * - `__touchFile(path)`: advances a file's timestamp as another program would,
 *   so conflict detection can be tested.
 * - `__editFileOnDisk(path, contents)`: rewrites a file behind the app's back.
 */
export type FakeFolder = { [name: string]: string | FakeFolder }

export async function installFakePicker(page: Page, folder: FakeFolder): Promise<void> {
  await page.addInitScript((tree: FakeFolder) => {
    interface FileState {
      contents: string
      lastModified: number
    }

    const written = new Map<string, string>()
    // File state is keyed by path so handles stay consistent across re-listings,
    // the way a real file does.
    const states = new Map<string, FileState>()

    let clock = 1_000_000
    const nextTimestamp = () => (clock += 1000)

    const stateFor = (path: string, initial: string): FileState => {
      let state = states.get(path)
      if (state === undefined) {
        state = { contents: initial, lastModified: nextTimestamp() }
        states.set(path, state)
      }
      return state
    }

    const makeFileHandle = (name: string, path: string, initial: string) => {
      const state = stateFor(path, initial)

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
              buffer =
                typeof command.data === 'string'
                  ? command.data
                  : new TextDecoder().decode(command.data)
            },
            async truncate() {
              // The fake stores text, so the explicit truncate has nothing to do.
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

    Object.assign(window, {
      __writtenFiles: written,
      __touchFile: (path: string) => {
        const state = states.get(path)
        if (state === undefined) throw new Error('No such fake file: ' + path)
        state.lastModified = nextTimestamp()
      },
      __editFileOnDisk: (path: string, contents: string) => {
        const state = states.get(path)
        if (state === undefined) throw new Error('No such fake file: ' + path)
        state.contents = contents
        state.lastModified = nextTimestamp()
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
