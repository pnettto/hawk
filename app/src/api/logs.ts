import { api } from './client'
import type { DayLog, LogsByDate, SnapshotMeta, Task } from '../types/models'

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

// Day history covers the task list. (Day notes are notes, with note history.)
const historyQuery = (dateStr: string, extra: Record<string, string> = {}) =>
  q({ date: dateStr, section: 'tasks', ...extra })

export const listDayVersions = (dateStr: string) =>
  api.get<SnapshotMeta[]>(`/api/day/versions?${historyQuery(dateStr)}`)

export const getDayVersion = (dateStr: string, savedAt: number) =>
  api.get<{ savedAt: number; content: { tasks?: Task[] } }>(
    `/api/day/versions/one?${historyQuery(dateStr, { savedAt: String(savedAt) })}`,
  )

export const restoreDayVersion = (dateStr: string, savedAt: number) =>
  api.post<{ success: boolean; tasks?: Task[] }>(
    `/api/day/versions/restore?${historyQuery(dateStr, { savedAt: String(savedAt) })}`,
  )
