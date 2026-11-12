import { describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

vi.mock('../api/logs', () => {
  const tasks = [
    { id: 'a', text: 'A', done: false, order: 1 },
    { id: 'b', text: 'B', done: false, order: 2 },
    { id: 'c', text: 'C', done: false, order: 3 },
    { id: 'timed', text: 'Timed', done: false, time: '09:00', order: 4 },
  ]
  return {
    getDayLog: vi.fn(async () => ({ tasks })),
    getRangeLog: vi.fn(async () => ({})),
    patchTasks: vi.fn(async (_date: string, body: { upsert?: unknown[]; remove?: string[] }) => ({
      tasks: body.upsert ?? [],
    })),
    listDayVersions: vi.fn(async () => []),
    getDayVersion: vi.fn(async () => ({ savedAt: 0, content: {} })),
    restoreDayVersion: vi.fn(async () => ({ success: true })),
  }
})

import { logsStore, sortTasks } from './logs'

describe('reorderTasks', () => {
  it('applies a new manual order to the day', async () => {
    const dateStr = '2025-01-01'
    await logsStore.loadForDate(dateStr)

    logsStore.reorderTasks(dateStr, ['c', 'a', 'b'])

    const tasks = get(logsStore).byDate[dateStr].tasks
    expect(sortTasks(tasks).map((t) => t.id)).toEqual(['timed', 'c', 'a', 'b'])
  })
})
