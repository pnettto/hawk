// Compact relative-time formatting for note rows: "Just now", "12m", "3h",
// "Yesterday", "Mar 4", or "Mar 4, 2024" for prior years.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const monthYearFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts
  if (diff < 0) return monthFmt.format(new Date(ts))
  if (diff < MINUTE) return 'Just now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`

  const d = new Date(ts)
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfYesterday = startOfToday - DAY

  if (ts >= startOfToday) return `${Math.floor(diff / HOUR)}h ago`
  if (ts >= startOfYesterday) return 'Yesterday'

  if (d.getFullYear() === today.getFullYear()) return monthFmt.format(d)
  return monthYearFmt.format(d)
}

// Bucket key for date-grouped headers in the notes list.
export type DateBucket = 'today' | 'yesterday' | 'week' | 'month' | 'older'

export function dateBucket(ts: number, now: number = Date.now()): DateBucket {
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfYesterday = startOfToday - DAY
  const startOfWeek = startOfToday - 6 * DAY
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).getTime()

  if (ts >= startOfToday) return 'today'
  if (ts >= startOfYesterday) return 'yesterday'
  if (ts >= startOfWeek) return 'week'
  if (ts >= startOfMonth) return 'month'
  return 'older'
}

export const bucketLabels: Record<DateBucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  month: 'Earlier this month',
  older: 'Older',
}

export const bucketOrder: DateBucket[] = ['today', 'yesterday', 'week', 'month', 'older']
