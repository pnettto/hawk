import { writable, get } from 'svelte/store'
import * as logsApi from '../api/logs'
import { savingStore } from './saving'
import type { DayLog, LogsByDate } from '../types/models'
import { formatDate } from '../utils/date'
import type { SyncEvent } from './sync'

interface LogsState {
  byDate: LogsByDate
}

const inFlight = new Map<string, Promise<DayLog | null>>()

function createLogsStore() {
  const { subscribe, update } = writable<LogsState>({ byDate: {} })

  // True for ~750 ms after a local saveDay, so a cross-device echo doesn't
  // immediately yank the day's checklist while the user is still toggling
  // boxes. The server already filters by originClientId; this is just belt
  // and braces for cases where a sibling tab on the same device wrote.
  const recentLocalSaves = new Map<string, number>()
  const ECHO_GUARD_MS = 750

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
    recentLocalSaves.set(dateStr, Date.now())
    await savingStore.track(
      logsApi.setDayLog(dateStr, data).catch((e) => {
        console.error(`Failed to save log for ${dateStr}:`, e)
        throw e
      }),
    )
  }

  // Mark a snapshot checkpoint for one section (notes or tasks) of the day.
  // Sends the latest state with snapshot=true so the server applies its
  // coalesce rules.
  async function triggerSnapshot(
    dateStr: string,
    section: logsApi.DaySection,
  ): Promise<void> {
    const cur = get({ subscribe })
    const data = (cur.byDate[dateStr] ?? {}) as DayLog
    recentLocalSaves.set(dateStr, Date.now())
    try {
      await savingStore.track(
        logsApi.setDayLog(dateStr, data, { snapshot: true, section }),
      )
    } catch (e) {
      console.error(`Failed to snapshot ${section} for ${dateStr}:`, e)
    }
  }

  // Save + snapshot in a single server round-trip, against an explicit body.
  // Used when the caller has the latest in-memory state ready (e.g. the
  // history-popover toggle) and doesn't want to depend on byDate being
  // up-to-date through a separate save.
  async function snapshotAndSave(
    dateStr: string,
    data: DayLog,
    section: logsApi.DaySection,
  ): Promise<void> {
    recentLocalSaves.set(dateStr, Date.now())
    try {
      await savingStore.track(
        logsApi.setDayLog(dateStr, data, { snapshot: true, section }),
      )
    } catch (e) {
      console.error(`Failed to snapshot+save ${section} for ${dateStr}:`, e)
    }
  }

  async function restoreVersion(
    dateStr: string,
    section: logsApi.DaySection,
    savedAt: number,
  ): Promise<boolean> {
    try {
      const res = await savingStore.track(
        logsApi.restoreDayVersion(dateStr, section, savedAt),
      ) as { success: boolean; dayLog: DayLog } | undefined
      if (res?.dayLog) {
        updateLog(dateStr, res.dayLog)
      }
      return true
    } catch (e) {
      console.error('Failed to restore day version:', e)
      return false
    }
  }

  async function applySyncEvent(evt: SyncEvent): Promise<void> {
    if (evt.type !== 'log.saved') return
    const dateStr = evt.ref
    const lastLocal = recentLocalSaves.get(dateStr) || 0
    if (Date.now() - lastLocal < ECHO_GUARD_MS) return
    // Only refetch if we already have this date loaded — no point pulling a
    // day the user isn't looking at.
    const cur = get({ subscribe })
    if (!cur.byDate[dateStr]) return
    await loadForDate(dateStr, /* force */ true)
  }

  return {
    subscribe,
    loadForDate,
    loadForRange,
    prefetchSurrounding,
    updateLog,
    saveDay,
    triggerSnapshot,
    snapshotAndSave,
    restoreVersion,
    applySyncEvent,
  }
}

export const logsStore = createLogsStore()
