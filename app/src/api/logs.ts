import { api } from './client'
import type { DayLog, LogsByDate } from '../types/models'

export const getDayLog = (dateStr: string) =>
  api.get<DayLog>(`/api/day?date=${encodeURIComponent(dateStr)}`)

export const getRangeLog = (start: string, end: string) =>
  api.get<LogsByDate>(
    `/api/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
  )

export const setDayLog = (dateStr: string, data: DayLog) =>
  api.post(`/api/day?date=${encodeURIComponent(dateStr)}`, data)
