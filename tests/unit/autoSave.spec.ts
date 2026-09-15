import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAutoSave, type SaveState } from '../../app/services/autoSave'
import type { FileNode, FileStamp, WriteResult } from '../../app/types/fileSystem'

const FILE = { kind: 'file', name: 'note.md', path: 'note.md', handle: {} } as unknown as FileNode
const STAMP: FileStamp = { lastModified: 1000, size: 10 }

/**
 * A recording writer that behaves like the real service: every successful write
 * advances the stamp, so a following write with the returned stamp is not a conflict.
 */
function createWriter() {
  const writes: string[] = []
  let clock = STAMP.lastModified
  let behaviour: (text: string) => WriteResult | Promise<WriteResult> = (text) => {
    clock += 1000
    return { ok: true, stamp: { lastModified: clock, size: text.length } }
  }

  return {
    writes,
    /** Replaces what the next writes do. */
    set(next: typeof behaviour) {
      behaviour = next
    },
    write: vi.fn(async (_file: FileNode, text: string) => {
      writes.push(text)
      return behaviour(text)
    }),
  }
}

function setup(options: { delayMs?: number } = {}) {
  const writer = createWriter()
  const states: SaveState[] = []
  const permission = vi.fn(async () => true)

  const controller = createAutoSave({
    write: writer.write,
    ensurePermission: permission,
    onState: (state) => states.push(state),
    delayMs: options.delayMs ?? 500,
  })

  controller.attach(FILE, STAMP)
  states.length = 0 // drop the transition from attach()

  return { controller, writer, states, permission, statuses: () => states.map((s) => s.status) }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('debounce', () => {
  it('does not write before the quiet period has elapsed', async () => {
    const { controller, writer } = setup()

    controller.edit('one')
    await vi.advanceTimersByTimeAsync(499)

    expect(writer.writes).toEqual([])
  })

  it('writes once the quiet period elapses', async () => {
    const { controller, writer } = setup()

    controller.edit('one')
    await vi.advanceTimersByTimeAsync(500)

    expect(writer.writes).toEqual(['one'])
  })

  it('coalesces a burst of edits into a single write of the final text', async () => {
    const { controller, writer } = setup()

    controller.edit('a')
    await vi.advanceTimersByTimeAsync(200)
    controller.edit('ab')
    await vi.advanceTimersByTimeAsync(200)
    controller.edit('abc')
    await vi.advanceTimersByTimeAsync(500)

    expect(writer.writes).toEqual(['abc'])
  })

  it('reports dirty immediately and clean after the write', async () => {
    const { controller, statuses } = setup()

    controller.edit('one')
    expect(statuses()).toEqual(['dirty'])

    await vi.advanceTimersByTimeAsync(500)
    expect(statuses()).toEqual(['dirty', 'saving', 'clean'])
  })

  it('ignores edits when no document is attached', async () => {
    const { controller, writer } = setup()

    expect(await controller.close()).toBe(true)
    controller.edit('orphan')
    await vi.advanceTimersByTimeAsync(1000)

    expect(writer.writes).toEqual([])
  })
})

describe('flush', () => {
  it('writes immediately instead of waiting for the timer', async () => {
    const { controller, writer } = setup()

    controller.edit('one')
    await controller.flush()

    expect(writer.writes).toEqual(['one'])
  })

  it('does nothing when there is nothing pending', async () => {
    const { controller, writer } = setup()

    await controller.flush()

    expect(writer.writes).toEqual([])
  })

  it('does not write the same text twice', async () => {
    const { controller, writer } = setup()

    controller.edit('one')
    await controller.flush()
    await controller.flush()
    await vi.advanceTimersByTimeAsync(1000)

    expect(writer.writes).toEqual(['one'])
  })

  it('writes the newest text even when an edit lands mid-write', async () => {
    const { controller, writer } = setup()
    let release = () => {}
    writer.set((text) => {
      // Hold the first write open so the next edit arrives while it is in flight.
      if (text !== 'first') return { ok: true, stamp: { lastModified: 9000, size: text.length } }
      return new Promise<WriteResult>((resolve) => {
        release = () => resolve({ ok: true, stamp: { lastModified: 5000, size: text.length } })
      })
    })

    controller.edit('first')
    const flushed = controller.flush()
    await vi.advanceTimersByTimeAsync(0)

    controller.edit('second')
    release()
    await flushed

    expect(writer.writes).toEqual(['first', 'second'])
    expect(controller.getState().status).toBe('clean')
    expect(controller.hasPendingText()).toBe(false)
  })
})

describe('conflicts', () => {
  const conflicted: WriteResult = {
    ok: false,
    reason: 'conflict',
    current: { lastModified: 7777, size: 3 },
  }

  it('reports a conflict and keeps the text', async () => {
    const { controller, writer } = setup()
    writer.set(() => conflicted)

    controller.edit('mine')
    await vi.advanceTimersByTimeAsync(500)

    expect(controller.getState()).toEqual({ status: 'conflict', current: conflicted.current })
    expect(controller.hasPendingText()).toBe(true)
  })

  it('never retries a conflict on its own, however much the user types', async () => {
    const { controller, writer } = setup()
    writer.set(() => conflicted)

    controller.edit('mine')
    await vi.advanceTimersByTimeAsync(500)
    expect(writer.writes).toEqual(['mine'])

    controller.edit('mine again')
    controller.edit('and again')
    await vi.advanceTimersByTimeAsync(5000)

    // Retrying would overwrite whatever the other program wrote.
    expect(writer.writes).toEqual(['mine'])
    expect(controller.getState().status).toBe('conflict')
  })

  it('refuses to close, so the caller cannot switch away and lose the text', async () => {
    const { controller, writer } = setup()
    writer.set(() => conflicted)

    controller.edit('mine')
    await vi.advanceTimersByTimeAsync(500)

    expect(await controller.close()).toBe(false)
    expect(controller.hasPendingText()).toBe(true)
    expect(controller.getState().status).toBe('conflict')
  })
})

describe('failures', () => {
  it('surfaces the write error and keeps the text', async () => {
    const { controller, writer } = setup()
    writer.set(() => {
      throw new Error('disk is on fire')
    })

    controller.edit('one')
    await vi.advanceTimersByTimeAsync(500)

    expect(controller.getState()).toEqual({ status: 'error', message: 'disk is on fire' })
    expect(controller.hasPendingText()).toBe(true)
  })

  it('retries on an explicit flush after a failure', async () => {
    const { controller, writer } = setup()
    let failing = true
    writer.set((text) => {
      if (failing) throw new Error('nope')
      return { ok: true, stamp: { lastModified: 4000, size: text.length } }
    })

    controller.edit('one')
    await vi.advanceTimersByTimeAsync(500)
    expect(controller.getState().status).toBe('error')

    failing = false
    await controller.flush()

    expect(writer.writes).toEqual(['one', 'one'])
    expect(controller.getState().status).toBe('clean')
  })

  it('refuses to close while the text is unsaved', async () => {
    const { controller, writer } = setup()
    writer.set(() => {
      throw new Error('nope')
    })

    controller.edit('one')
    await vi.advanceTimersByTimeAsync(500)

    expect(await controller.close()).toBe(false)
  })

  it('does not write when write permission is refused', async () => {
    const writer = createWriter()
    const controller = createAutoSave({
      write: writer.write,
      ensurePermission: async () => false,
      onState: () => {},
    })
    controller.attach(FILE, STAMP)

    controller.edit('one')
    await vi.advanceTimersByTimeAsync(500)

    expect(writer.writes).toEqual([])
    expect(controller.getState()).toMatchObject({ status: 'error' })
    expect(controller.hasPendingText()).toBe(true)
  })
})

describe('consecutive saves', () => {
  it('uses the stamp from the previous write, so the second save is not a conflict', async () => {
    const { controller, writer } = setup()

    controller.edit('one')
    await vi.advanceTimersByTimeAsync(500)
    controller.edit('two')
    await vi.advanceTimersByTimeAsync(500)

    expect(writer.writes).toEqual(['one', 'two'])
    expect(controller.getState().status).toBe('clean')
  })

  it('detaches cleanly when everything is saved', async () => {
    const { controller } = setup()

    controller.edit('one')
    await vi.advanceTimersByTimeAsync(500)

    expect(await controller.close()).toBe(true)
    expect(controller.getState().status).toBe('clean')
  })

  it('flushes pending text when closing', async () => {
    const { controller, writer } = setup()

    controller.edit('unsaved')
    expect(await controller.close()).toBe(true)

    expect(writer.writes).toEqual(['unsaved'])
  })

  it('cancels a scheduled save when disposed', async () => {
    const { controller, writer } = setup()

    controller.edit('one')
    controller.dispose()
    await vi.advanceTimersByTimeAsync(5000)

    expect(writer.writes).toEqual([])
  })
})
