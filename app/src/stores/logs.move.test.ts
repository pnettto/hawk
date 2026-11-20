import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { Task } from '../types/models'

// A small in-memory server: per-day task lists, patched and moved the way the
// real endpoints do it.
const server = vi.hoisted(() => ({
  days: {} as Record<string, Task[]>,
  failMove: false,
  calls: [] as string[],
}))
const toasts = vi.hoisted(() => [] as { message: string; onAction?: () => void }[])

vi.mock('./toast', () => ({
  showToast: (message: string, opts: { onAction?: () => void } = {}) => {
    toasts.push({ message, onAction: opts.onAction })
    return () => {}
  },
  showError: (message: string) => {
    toasts.push({ message })
    return () => {}
  },
}))

vi.mock('../api/logs', async () => {
  const { moveTasksBetween } = await import('../lib/daily/moveTasks')
  const clone = <T,>(v: T): T => structuredClone(v)
  return {
    getDayLog: vi.fn(async (d: string) => ({ tasks: clone(server.days[d] ?? []) })),
    getRangeLog: vi.fn(async () => ({})),
    patchTasks: vi.fn(async (d: string, body: { upsert?: Task[]; remove?: string[] }) => {
      server.calls.push(`patch:${d}`)
      const byId = new Map((server.days[d] ?? []).map((t) => [t.id, t]))
      for (const id of body.remove ?? []) byId.delete(id)
      for (const t of body.upsert ?? []) byId.set(t.id, clone(t))
      server.days[d] = [...byId.values()]
      return { tasks: clone(server.days[d]) }
    }),
    moveTasks: vi.fn(async (from: string, to: string, ids: string[], orders?: Record<string, number>) => {
      server.calls.push(`move:${from}>${to}`)
      if (server.failMove) throw new Error('offline')
      const r = moveTasksBetween(server.days[from] ?? [], server.days[to] ?? [], ids, { orders })
      server.days[from] = r.from
      server.days[to] = r.to
      return { from: { tasks: clone(r.from) }, to: { tasks: clone(r.to) }, moved: r.moved }
    }),
    listDayVersions: vi.fn(async () => []),
    getDayVersion: vi.fn(async () => ({ savedAt: 0, content: {} })),
    restoreDayVersion: vi.fn(async () => ({ success: true })),
  }
})

import { logsStore } from './logs'

const t = (id: string, order: number, extra: Partial<Task> = {}): Task => ({ id, text: id, done: false, order, ...extra })
const day = (d: string) => get(logsStore).byDate[d]?.tasks ?? []
const strip = (tasks: Task[]) =>
  tasks.map(({ updatedAt: _u, ...rest }) => rest).sort((a, b) => a.id.localeCompare(b.id))

let n = 0
let from = ''
let to = ''
beforeEach(async () => {
  // Fresh dates per test: the store is a module singleton.
  n++
  from = `2026-0${(n % 9) + 1}-10`
  to = `2026-0${(n % 9) + 1}-11`
  server.failMove = false
  server.calls = []
  toasts.length = 0
  server.days[from] = [t('a', 1), t('g', 2), t('g1', 1, { parentId: 'g', done: true }), t('b', 3)]
  server.days[to] = [t('x', 1)]
  await logsStore.loadForDate(from, true)
  await logsStore.loadForDate(to, true)
})

describe('moveTasks', () => {
  it('moves tasks optimistically and settles on the server copy', async () => {
    const p = logsStore.moveTasks(from, to, ['g'])
    // Flushing first is async; give it a tick, then the optimistic state shows.
    await vi.waitFor(() => expect(day(from).map((x) => x.id)).toEqual(['a', 'b']))
    expect(day(to).map((x) => x.id).sort()).toEqual(['g', 'g1', 'x'])
    expect(await p).toBe(true)
    expect(strip(day(from))).toEqual(strip(server.days[from]))
    expect(strip(day(to))).toEqual(strip(server.days[to]))
    expect(toasts.at(-1)!.message).toMatch(/^Moved “g” to /)
  })

  it('rolls back both days when the server refuses', async () => {
    const before = [strip(day(from)), strip(day(to))]
    server.failMove = true
    expect(await logsStore.moveTasks(from, to, ['a', 'g'])).toBe(false)
    expect([strip(day(from)), strip(day(to))]).toEqual(before)
    expect(toasts.at(-1)!.message).toBe('Couldn’t move tasks.')
  })

  it('undo puts everything back exactly, order included', async () => {
    const before = strip(server.days[from])
    await logsStore.moveTasks(from, to, ['a', 'g'])
    expect(toasts.at(-1)!.message).toMatch(/^Moved 2 tasks to /)
    toasts.at(-1)!.onAction!()
    await vi.waitFor(() => expect(server.calls.filter((c) => c.startsWith('move')).length).toBe(2))
    await vi.waitFor(() => expect(strip(day(from))).toEqual(before))
    expect(strip(server.days[from])).toEqual(before)
    expect(day(to).map((x) => x.id)).toEqual(['x'])
  })

  it('saves pending edits before moving', async () => {
    logsStore.editTask(from, 'a', { text: 'edited' })
    await logsStore.moveTasks(from, to, ['a'])
    expect(server.calls.indexOf(`patch:${from}`)).toBeLessThan(server.calls.indexOf(`move:${from}>${to}`))
    expect(server.days[to].find((x) => x.id === 'a')!.text).toBe('edited')
  })

  it('tells listeners which tasks moved', async () => {
    const seen: unknown[] = []
    const off = logsStore.onTasksMoved((m) => seen.push(m))
    await logsStore.moveTasks(from, to, ['g'], { quiet: true })
    off()
    expect(seen).toEqual([{ from, to, ids: ['g', 'g1'] }])
    expect(toasts).toEqual([])
  })
})

describe('removeTasks', () => {
  it('deletes several tasks in one write with one undo', async () => {
    logsStore.removeTasks(from, ['a', 'g'])
    expect(day(from).map((x) => x.id)).toEqual(['b'])
    await logsStore.flushTasks(from)
    expect(server.calls.filter((c) => c === `patch:${from}`)).toHaveLength(1)
    expect(toasts.at(-1)!.message).toBe('Deleted 2 tasks')
    toasts.at(-1)!.onAction!()
    expect(day(from).map((x) => x.id).sort()).toEqual(['a', 'b', 'g', 'g1'])
  })
})
