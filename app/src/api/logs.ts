import { api } from './client'
import type { DayLog, LogsByDate, SnapshotMeta } from '../types/models'

export type DaySection = 'notes' | 'tasks'

export const getDayLog = (dateStr: string) =>
  api.get<DayLog>(`/api/day?date=${encodeURIComponent(dateStr)}`)

export const getRangeLog = (start: string, end: string) =>
  api.get<LogsByDate>(
    `/api/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
  )

export const setDayLog = (
  dateStr: string,
  data: DayLog,
  opts: { snapshot?: boolean; section?: DaySection | 'both' } = {},
) => {
  const params = new URLSearchParams({ date: dateStr })
  if (opts.snapshot) {
    params.set('snapshot', 'true')
    params.set('section', opts.section ?? 'both')
  }
  return api.post(`/api/day?${params.toString()}`, data)
}

export const listDayVersions = (dateStr: string, section: DaySection) =>
  api.get<SnapshotMeta[]>(
    `/api/day/versions?date=${encodeURIComponent(dateStr)}&section=${section}`,
  )

export const getDayVersion = (
  dateStr: string,
  section: DaySection,
  savedAt: number,
) =>
  api.get<{
    savedAt: number
    content: {
      notesMarkdown?: string
      hourEntries?: Record<string, import('../types/models').HourEntry>
    }
  }>(
    `/api/day/versions/one?date=${encodeURIComponent(dateStr)}&section=${section}&savedAt=${savedAt}`,
  )

export const restoreDayVersion = (
  dateStr: string,
  section: DaySection,
  savedAt: number,
) =>
  api.post<{ success: boolean; dayLog: DayLog }>(
    `/api/day/versions/restore?date=${encodeURIComponent(dateStr)}&section=${section}&savedAt=${savedAt}`,
  )
