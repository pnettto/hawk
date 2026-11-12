import { describe, expect, it } from 'vitest'
import {
  BREAK_MS,
  FOCUS_MS,
  IDLE,
  advance,
  formatClock,
  pause,
  remainingMs,
  resume,
  skip,
  startSession,
} from './pomodoro'

const NOW = 1_700_000_000_000
const TARGET = { id: 't1', text: 'Write the report', dateStr: '2024-05-01' }
const DURATIONS = { focusMs: FOCUS_MS, breakMs: BREAK_MS }

describe('formatClock', () => {
  it('shows minutes and zero-padded seconds', () => {
    expect(formatClock(FOCUS_MS)).toBe('25:00')
    expect(formatClock(65_000)).toBe('1:05')
  })
  it('rounds up so 0:00 only appears when time is up', () => {
    expect(formatClock(1)).toBe('0:01')
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(-500)).toBe('0:00')
  })
})

describe('startSession', () => {
  it('starts a full focus phase on the task', () => {
    const state = startSession(IDLE, TARGET, NOW, DURATIONS)
    expect(state).toMatchObject({
      taskId: 't1',
      taskText: 'Write the report',
      dateStr: '2024-05-01',
      mode: 'focus',
      running: true,
      remainingMs: FOCUS_MS,
    })
    expect(state.endsAt).toBe(NOW + FOCUS_MS)
  })
})

describe('custom block lengths', () => {
  const custom = { focusMs: 10 * 60_000, breakMs: 2 * 60_000 }

  it('uses the configured lengths for the session', () => {
    const started = startSession(IDLE, TARGET, NOW, custom)
    expect(started.focusMs).toBe(custom.focusMs)
    expect(started.endsAt).toBe(NOW + custom.focusMs)

    const onBreak = advance(started, NOW + custom.focusMs).state
    expect(onBreak.mode).toBe('break')
    expect(onBreak.endsAt).toBe(NOW + custom.focusMs + custom.breakMs)
  })

  it('keeps the lengths through a skip and back to idle', () => {
    const started = startSession(IDLE, TARGET, NOW, custom)
    const onBreak = skip(started, NOW + 1000)
    expect(onBreak.remainingMs).toBe(custom.breakMs)
    const idle = skip(onBreak, NOW + 2000)
    expect(idle.focusMs).toBe(custom.focusMs)
    expect(idle.remainingMs).toBe(custom.focusMs)
  })
})

describe('pause / resume', () => {
  it('freezes the remaining time', () => {
    const started = startSession(IDLE, TARGET, NOW, DURATIONS)
    const paused = pause(started, NOW + 60_000)
    expect(paused.running).toBe(false)
    expect(paused.endsAt).toBeNull()
    expect(paused.remainingMs).toBe(FOCUS_MS - 60_000)
    // Time passing while paused doesn't eat the clock.
    expect(remainingMs(paused, NOW + 600_000)).toBe(FOCUS_MS - 60_000)
  })

  it('resumes from the frozen time', () => {
    const paused = pause(startSession(IDLE, TARGET, NOW, DURATIONS), NOW + 60_000)
    const resumed = resume(paused, NOW + 120_000)
    expect(resumed.running).toBe(true)
    expect(resumed.endsAt).toBe(NOW + 120_000 + FOCUS_MS - 60_000)
  })
})

describe('advance', () => {
  it('does nothing while the phase still has time', () => {
    const started = startSession(IDLE, TARGET, NOW, DURATIONS)
    const { state, finished } = advance(started, NOW + 1000)
    expect(finished).toBeNull()
    expect(state.mode).toBe('focus')
    expect(state.remainingMs).toBe(FOCUS_MS - 1000)
  })

  it('switches to a break when focus runs out', () => {
    const started = startSession(IDLE, TARGET, NOW, DURATIONS)
    const { state, finished } = advance(started, NOW + FOCUS_MS)
    expect(finished).toBe('focus')
    expect(state.mode).toBe('break')
    expect(state.running).toBe(true)
    expect(state.remainingMs).toBe(BREAK_MS)
    expect(state.completed).toBe(1)
    expect(state.taskId).toBe('t1')
  })

  it('goes idle when the break runs out', () => {
    const onBreak = advance(startSession(IDLE, TARGET, NOW, DURATIONS), NOW + FOCUS_MS).state
    const { state, finished } = advance(onBreak, NOW + FOCUS_MS + BREAK_MS)
    expect(finished).toBe('break')
    expect(state.taskId).toBeNull()
    expect(state.running).toBe(false)
    expect(state.completed).toBe(1)
  })
})

describe('skip', () => {
  it('jumps from focus to break without counting the session', () => {
    const state = skip(startSession(IDLE, TARGET, NOW, DURATIONS), NOW + 5000)
    expect(state.mode).toBe('break')
    expect(state.running).toBe(true)
    expect(state.completed).toBe(0)
  })

  it('ends the break', () => {
    const onBreak = skip(startSession(IDLE, TARGET, NOW, DURATIONS), NOW + 5000)
    const state = skip(onBreak, NOW + 10_000)
    expect(state.mode).toBe('focus')
    expect(state.running).toBe(false)
    expect(state.taskId).toBeNull()
  })
})
