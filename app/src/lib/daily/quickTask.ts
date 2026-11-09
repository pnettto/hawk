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
