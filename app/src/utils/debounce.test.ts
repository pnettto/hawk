import { describe, expect, it, vi } from 'vitest'
import { debounce } from './debounce'

describe('debounce', () => {
  it('only fires once after the wait window', async () => {
    vi.useFakeTimers()
    const fn = vi.fn<(x: number) => void>()
    const d = debounce(fn, 100)
    d(1)
    d(2)
    d(3)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(3)
    vi.useRealTimers()
  })

  it('flush runs the pending call immediately', () => {
    vi.useFakeTimers()
    const fn = vi.fn<(x: string) => void>()
    const d = debounce(fn, 200)
    d('a')
    d.flush()
    expect(fn).toHaveBeenCalledWith('a')
    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('cancel drops the pending call', () => {
    vi.useFakeTimers()
    const fn = vi.fn<() => void>()
    const d = debounce(fn, 100)
    d()
    d.cancel()
    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
