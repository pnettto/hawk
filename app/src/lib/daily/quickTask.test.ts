import { describe, expect, it } from 'vitest'
import { parseQuickDate, parseQuickEntry, parseQuickTask } from './quickTask'

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
  it('ignores date words', () => {
    expect(parseQuickTask('Gym tomorrow')).toEqual({ text: 'Gym tomorrow' })
  })
})

// Monday, May 11 2026, mid-morning.
const MON = new Date(2026, 4, 11, 10, 30)

describe('parseQuickDate', () => {
  it.each([
    ['Gym today', 'Gym', '2026-05-11'],
    ['Gym tomorrow', 'Gym', '2026-05-12'],
    ['tmr Gym', 'Gym', '2026-05-12'],
    ['Plan trip next week', 'Plan trip', '2026-05-18'],
    ['Call mom on friday', 'Call mom', '2026-05-15'],
    ['Call mom fri', 'Call mom', '2026-05-15'],
    ['Wed standup', 'standup', '2026-05-13'],
    // A weekday means the next one after today.
    ['Review mon', 'Review', '2026-05-18'],
    ['Review Monday', 'Review', '2026-05-18'],
    ['Brunch sun', 'Brunch', '2026-05-17'],
    ['Dentist on May 20', 'Dentist', '2026-05-20'],
    ['Dentist 20 May', 'Dentist', '2026-05-20'],
    ['Dentist may 20th', 'Dentist', '2026-05-20'],
    ['Dentist 2026-05-20', 'Dentist', '2026-05-20'],
    ['Sep 3 Taxes', 'Taxes', '2026-09-03'],
    // A passed day of the year is next year's.
    ['Taxes Jan 5', 'Taxes', '2027-01-05'],
    ['Party December 31', 'Party', '2026-12-31'],
  ])('%s', (input, text, date) => {
    expect(parseQuickDate(input, MON)).toEqual({ text, date })
  })

  it.each([
    'Tomorrow',
    'on friday',
    'Monitor setup',
    'Buy milk',
    'Dentist Feb 31',
    'Dentist 2026-13-01',
    'Read chapter 3',
  ])('leaves %s alone', (input) => {
    expect(parseQuickDate(input, MON)).toEqual({ text: input })
  })

  it('rolls over months and years', () => {
    expect(parseQuickDate('Party tomorrow', new Date(2026, 11, 31))).toEqual({ text: 'Party', date: '2027-01-01' })
    expect(parseQuickDate('Rent fri', new Date(2026, 3, 30))).toEqual({ text: 'Rent', date: '2026-05-01' })
  })
})

describe('parseQuickEntry', () => {
  it.each([
    ['Gym tomorrow at 7pm', { text: 'Gym', date: '2026-05-12', time: '19:00' }],
    ['tomorrow 14:30 Gym', { text: 'Gym', date: '2026-05-12', time: '14:30' }],
    ['14:30 Gym tomorrow', { text: 'Gym', date: '2026-05-12', time: '14:30' }],
    ['Dentist tomorrow 14:30', { text: 'Dentist', date: '2026-05-12', time: '14:30' }],
    ['Dentist fri 9h', { text: 'Dentist', date: '2026-05-15', time: '09:00' }],
    ['Call dentist 14:30', { text: 'Call dentist', time: '14:30' }],
    ['9h standup', { text: 'standup', time: '09:00' }],
    ['Standup on May 20 at 9am', { text: 'Standup', date: '2026-05-20', time: '09:00' }],
    ['Call dentist', { text: 'Call dentist' }],
    ['Read chapter 3', { text: 'Read chapter 3' }],
    ['Tomorrow', { text: 'Tomorrow' }],
    ['14:30', { text: '14:30' }],
  ])('%s', (input, out) => {
    expect(parseQuickEntry(input, MON)).toEqual(out)
  })
})
