import { writable } from 'svelte/store'
import * as logsApi from '../api/logs'
import { savingStore } from './saving'
import type { DayLog, LogsByDate } from '../types/models'
import { formatDate } from '../utils/date'

interface LogsState {
  byDate: LogsByDate
}

const inFlight = new Map<string, Promise<DayLog | null>>()

function createLogsStore() {
  const { subscribe, update } = writable<LogsState>({ byDate: {} })

  async function loadForDate(dateStr: string, force = false): Promise<DayLog | null> {
    if (!force) {
      let cached: DayLog | undefined
      const unsub = subscribe((s) => (cached = s.byDate[dateStr]))
      unsub()
      if (cached) return cached
    }
    if (inFlight.has(dateStr)) return inFlight.get(dateStr)!

    const promise = (async () => {
      try {
        const data = await logsApi.getDayLog(dateStr)
        const log = (typeof data === 'string' ? JSON.parse(data) : data) as DayLog
        update((s) => ({ byDate: { ...s.byDate, [dateStr]: log } }))
        return log
      } catch (e) {
        console.error(`Failed to load log for ${dateStr}:`, e)
        return null
      } finally {
        inFlight.delete(dateStr)
      }
    })()
    inFlight.set(dateStr, promise)
    return promise
  }

  function prefetchSurrounding(date: Date) {
    const prev = new Date(date)
    prev.setDate(prev.getDate() - 1)
    const next = new Date(date)
    next.setDate(next.getDate() + 1)
    loadForDate(formatDate(prev))
    loadForDate(formatDate(next))
  }

  async function loadForRange(start: string, end: string): Promise<LogsByDate> {
    try {
      const data = await logsApi.getRangeLog(start, end)
      update((s) => ({ byDate: { ...s.byDate, ...data } }))
      return data
    } catch (e) {
      console.error(`Failed to load range ${start} to ${end}:`, e)
      return {}
    }
  }

  function updateLog(dateStr: string, data: DayLog) {
    update((s) => ({ byDate: { ...s.byDate, [dateStr]: data } }))
  }

  async function saveDay(dateStr: string, data: DayLog) {
    updateLog(dateStr, data)
    await savingStore.track(
      logsApi.setDayLog(dateStr, data).catch((e) => {
        console.error(`Failed to save log for ${dateStr}:`, e)
        throw e
      }),
    )
  }

  return {
    subscribe,
    loadForDate,
    loadForRange,
    prefetchSurrounding,
    updateLog,
    saveDay,
  }
}

export const logsStore = createLogsStore()
