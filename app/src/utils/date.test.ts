import { describe, expect, it } from 'vitest'
import { formatDate } from './date'

describe('formatDate', () => {
  it('zero-pads month and day', () => {
    expect(formatDate(new Date(2024, 0, 5))).toBe('2024-01-05')
  })
  it('handles end of year', () => {
    expect(formatDate(new Date(2024, 11, 31))).toBe('2024-12-31')
  })
})
