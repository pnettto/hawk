import { api } from './client'
import type { DayLog, DayNote, LogsByDate, SnapshotMeta, Task } from '../types/models'

export type DaySection = 'notes' | 'tasks'

const q = (params: Record<string, string | undefined>) =>
  new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined),
  ).toString()

export const getDayLog = (dateStr: string) => api.get<DayLog>(`/api/day?${q({ date: dateStr })}`)

export const getRangeLog = (start: string, end: string) =>
  api.get<LogsByDate>(`/api/range?${q({ start, end })}`)

export const patchTasks = (
  dateStr: string,
  body: { upsert?: Task[]; remove?: string[] },
  opts: { snapshot?: boolean } = {},
) =>
  api.post<{ tasks: Task[] }>(
    `/api/day/tasks?${q({ date: dateStr, snapshot: opts.snapshot ? 'true' : undefined })}`,
    body,
    // Task writes are small; keepalive lets one fired on page close land.
    { keepalive: JSON.stringify(body).length < 60_000 },
  )

export const saveDayNote = (
  dateStr: string,
  note: Pick<DayNote, 'id' | 'title' | 'markdown' | 'order'>,
  baseRev: number,
  opts: { snapshot?: boolean; keepalive?: boolean } = {},
) =>
  api.postWithConflict<{ note: DayNote }>(
    `/api/day/notes?${q({ date: dateStr, snapshot: opts.snapshot ? 'true' : undefined })}`,
    { note, baseRev },
    { keepalive: opts.keepalive },
  )

export const deleteDayNote = (dateStr: string, id: string) =>
  api.del(`/api/day/notes?${q({ date: dateStr, id })}`)

// History target: the day's task list, or one day note.
export type DayHistoryTarget = { section: 'tasks' } | { section: 'notes'; noteId: string }

const historyQuery = (dateStr: string, t: DayHistoryTarget, extra: Record<string, string> = {}) =>
  q({
    date: dateStr,
    section: t.section,
    note: t.section === 'notes' ? t.noteId : undefined,
    ...extra,
  })

export const listDayVersions = (dateStr: string, t: DayHistoryTarget) =>
  api.get<SnapshotMeta[]>(`/api/day/versions?${historyQuery(dateStr, t)}`)

export const getDayVersion = (dateStr: string, t: DayHistoryTarget, savedAt: number) =>
  api.get<{ savedAt: number; content: { tasks?: Task[]; title?: string; markdown?: string } }>(
    `/api/day/versions/one?${historyQuery(dateStr, t, { savedAt: String(savedAt) })}`,
  )

export const restoreDayVersion = (dateStr: string, t: DayHistoryTarget, savedAt: number) =>
  api.post<{ success: boolean; tasks?: Task[]; note?: DayNote }>(
    `/api/day/versions/restore?${historyQuery(dateStr, t, { savedAt: String(savedAt) })}`,
  )
