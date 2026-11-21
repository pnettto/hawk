// Quick-entry syntax for the add-task box:
//   "14:30 Gym", "9.15 standup", "9h standup", "Gym @ 14:30", "Gym at 7pm"
// Returns the task text with the time stripped, and the time as "HH:MM".

const pad = (n: number) => String(n).padStart(2, '0')

function toTime(h: number, m: number, ampm?: string): string | undefined {
  if (ampm) {
    const pm = ampm.toLowerCase() === 'pm'
    if (h < 1 || h > 12) return undefined
    h = (h % 12) + (pm ? 12 : 0)
  }
  if (h > 23 || m > 59) return undefined
  return `${pad(h)}:${pad(m)}`
}

const TIME = String.raw`(\d{1,2})(?:[:.h](\d{2})|h)?\s*(am|pm)?`
const LEADING = new RegExp(String.raw`^${TIME}\s+(.+)$`, 'i')
const TRAILING = new RegExp(String.raw`^(.+?)\s+(?:@|at)\s*${TIME}$`, 'i')

export function parseQuickTask(input: string): { text: string; time?: string } {
  const raw = input.trim()
  const lead = raw.match(LEADING)
  // Leading form needs an explicit separator, "h" or am/pm — "3 apples"
  // shouldn't become a 03:00 task.
  if (lead && (lead[2] !== undefined || /^\d{1,2}h/i.test(raw) || lead[3])) {
    const time = toTime(Number(lead[1]), Number(lead[2] ?? 0), lead[3])
    if (time) return { text: lead[4].trim(), time }
  }
  const trail = raw.match(TRAILING)
  if (trail) {
    const time = toTime(Number(trail[2]), Number(trail[3] ?? 0), trail[4])
    if (time) return { text: trail[1].trim(), time }
  }
  return { text: raw }
}

// ---- Quick create (⌘K): dates as well as times ------------------------------
// Kept apart from parseQuickTask so the in-day add box only reads times.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]
// Full name or its first three letters ("mon", "monday"; "sep", "september").
const nameAlt = (names: string[]) => names.map((n) => `${n.slice(0, 3)}(?:${n.slice(3)})?`).join('|')
const WEEKDAY = `(?:${nameAlt(WEEKDAYS)})`
const MONTH = `(?:${nameAlt(MONTHS)})`
const ORD = '(?:st|nd|rd|th)?'
const DATE = String.raw`(?:on\s+)?(today|tomorrow|tmr|next\s+week|${WEEKDAY}|${MONTH}\s+\d{1,2}${ORD}|\d{1,2}${ORD}\s+${MONTH}|\d{4}-\d{2}-\d{2})`
const DATE_LEADING = new RegExp(String.raw`^${DATE}\s+(.+)$`, 'i')
const DATE_TRAILING = new RegExp(String.raw`^(.+?)\s+${DATE}$`, 'i')

const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const indexOfName = (names: string[], word: string) => names.findIndex((n) => n.startsWith(word.slice(0, 3)))

// A valid calendar day, or undefined ("Feb 31").
function day(y: number, m: number, d: number): Date | undefined {
  const out = new Date(y, m, d)
  return out.getMonth() === m && out.getDate() === d ? out : undefined
}

function resolveDate(phrase: string, today: Date): string | undefined {
  const p = phrase.toLowerCase().replace(/\s+/g, ' ')
  if (p === 'today') return ymd(today)
  if (p === 'tomorrow' || p === 'tmr') return ymd(addDays(today, 1))
  if (p === 'next week') return ymd(addDays(today, 7))
  const iso = p.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const d = day(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return d && ymd(d)
  }
  if (new RegExp(`^${WEEKDAY}$`).test(p)) {
    // The next one after today: "mon" on a Monday is a week away.
    const delta = (indexOfName(WEEKDAYS, p) - today.getDay() + 7) % 7 || 7
    return ymd(addDays(today, delta))
  }
  const md = p.match(/^([a-z]+) (\d{1,2})/) ?? p.match(/^(\d{1,2})[a-z]* ([a-z]+)$/)
  if (!md) return undefined
  const [monthWord, dayNum] = /^\d/.test(md[1]) ? [md[2], md[1]] : [md[1], md[2]]
  const month = indexOfName(MONTHS, monthWord)
  if (month < 0) return undefined
  // This year, or next year once the day has passed.
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  let d = day(today.getFullYear(), month, Number(dayNum))
  if (d && d < start) d = day(today.getFullYear() + 1, month, Number(dayNum))
  return d && ymd(d)
}

// Strips one leading or trailing date word or phrase: "today", "tomorrow" /
// "tmr", a weekday, "next week", "on May 20", "20 May", "2026-05-20". Text
// that's only a date stays as text.
export function parseQuickDate(input: string, today: Date): { text: string; date?: string } {
  const raw = input.trim()
  const lead = raw.match(DATE_LEADING)
  if (lead) {
    const date = resolveDate(lead[1], today)
    if (date) return { text: lead[2].trim(), date }
  }
  const trail = raw.match(DATE_TRAILING)
  if (trail) {
    const date = resolveDate(trail[2], today)
    // "on friday" alone is only a date too.
    if (date && !/^on$/i.test(trail[1])) return { text: trail[1].trim(), date }
  }
  return { text: raw }
}

// A bare trailing time ("Dentist 14:30"). Like the leading form, it needs a
// separator, "h" or am/pm, so "Chapter 3" stays as text.
const BARE_TRAILING = new RegExp(String.raw`^(.+?)\s+${TIME}$`, 'i')

function parseTime(input: string): { text: string; time?: string } {
  const parsed = parseQuickTask(input)
  if (parsed.time) return parsed
  const raw = input.trim()
  const m = raw.match(BARE_TRAILING)
  if (m && (m[3] !== undefined || /\dh$/i.test(raw) || m[4])) {
    const time = toTime(Number(m[2]), Number(m[3] ?? 0), m[4])
    if (time) return { text: m[1].trim(), time }
  }
  return { text: raw }
}

// Date and time from one line, in either order: "Gym tomorrow at 7pm",
// "tomorrow 14:30 Gym", "Dentist fri 9h".
export function parseQuickEntry(input: string, today: Date): { text: string; date?: string; time?: string } {
  let text = input.trim()
  let date: string | undefined
  let time: string | undefined
  for (let i = 0; i < 2; i++) {
    if (!date) {
      const d = parseQuickDate(text, today)
      if (d.date) ({ text, date } = d)
    }
    if (!time) {
      const t = parseTime(text)
      if (t.time) ({ text, time } = t)
    }
  }
  return { text, ...(date ? { date } : {}), ...(time ? { time } : {}) }
}
