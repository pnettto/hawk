import { describe, it, expect } from 'vitest'
import { relativeTime, dateBucket } from './relativeTime'

describe('relativeTime', () => {
  const now = new Date('2026-05-08T12:00:00').getTime()

  it('returns "Just now" for sub-minute differences', () => {
    expect(relativeTime(now - 10_000, now)).toBe('Just now')
  })

  it('returns minutes for sub-hour differences', () => {
    expect(relativeTime(now - 12 * 60_000, now)).toBe('12m ago')
  })

  it('returns hours for sub-day differences', () => {
    expect(relativeTime(now - 3 * 60 * 60_000, now)).toBe('3h ago')
  })

  it('returns "Yesterday" for the prior calendar day', () => {
    const yesterday = new Date('2026-05-07T18:00:00').getTime()
    expect(relativeTime(yesterday, now)).toBe('Yesterday')
  })

  it('returns a month/day for older same-year dates', () => {
    const earlier = new Date('2026-03-04T10:00:00').getTime()
    expect(relativeTime(earlier, now)).toMatch(/Mar/)
  })

  it('includes the year for prior years', () => {
    const lastYear = new Date('2024-08-12T10:00:00').getTime()
    expect(relativeTime(lastYear, now)).toMatch(/2024/)
  })
})

describe('dateBucket', () => {
  const now = new Date('2026-05-08T12:00:00').getTime()

  it('buckets timestamps from today as "today"', () => {
    expect(dateBucket(now - 60_000, now)).toBe('today')
  })
  it('buckets yesterday', () => {
    expect(dateBucket(new Date('2026-05-07T20:00:00').getTime(), now)).toBe('yesterday')
  })
  it('buckets within the last week', () => {
    expect(dateBucket(new Date('2026-05-04T09:00:00').getTime(), now)).toBe('week')
  })
  it('buckets earlier in the same month', () => {
    expect(dateBucket(new Date('2026-05-01T09:00:00').getTime(), now)).toBe('month')
  })
  it('buckets older items', () => {
    expect(dateBucket(new Date('2026-04-15T09:00:00').getTime(), now)).toBe('older')
  })
})
