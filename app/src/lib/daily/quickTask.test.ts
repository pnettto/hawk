import { describe, expect, it } from 'vitest'
import { parseQuickTask } from './quickTask'

describe('parseQuickTask', () => {
  it('parses a leading time', () => {
    expect(parseQuickTask('14:30 Gym')).toEqual({ text: 'Gym', time: '14:30' })
    expect(parseQuickTask('9.15 standup')).toEqual({ text: 'standup', time: '09:15' })
    expect(parseQuickTask('9h standup')).toEqual({ text: 'standup', time: '09:00' })
    expect(parseQuickTask('7pm dinner')).toEqual({ text: 'dinner', time: '19:00' })
  })
  it('parses a trailing time', () => {
    expect(parseQuickTask('Gym @ 14:30')).toEqual({ text: 'Gym', time: '14:30' })
    expect(parseQuickTask('Call mom at 6pm')).toEqual({ text: 'Call mom', time: '18:00' })
  })
  it('leaves plain text alone', () => {
    expect(parseQuickTask('3 apples')).toEqual({ text: '3 apples' })
    expect(parseQuickTask('Buy milk')).toEqual({ text: 'Buy milk' })
    expect(parseQuickTask('25:00 nope')).toEqual({ text: '25:00 nope' })
  })
})
