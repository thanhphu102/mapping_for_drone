import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { throttle } from './throttle'

const WAIT_MS = 100

beforeEach(() => {
  vi.useFakeTimers()
  // Large enough that `now - lastCallTime` (lastCallTime starts at 0) is always
  // far past WAIT_MS, so the first call of each test fires on the leading edge —
  // matching real-world Date.now() values, which are always >> any throttle window.
  vi.setSystemTime(1_000_000)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('throttle', () => {
  it('invokes immediately on the leading call', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, WAIT_MS)

    throttled(1)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(1)
  })

  it('coalesces calls within the window into one trailing call with the latest args', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, WAIT_MS)

    throttled('a')
    vi.advanceTimersByTime(30)
    throttled('b')
    vi.advanceTimersByTime(20)
    throttled('c')

    // Only 50ms of the 100ms window have elapsed; trailing call not due yet.
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(50)

    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenNthCalledWith(2, 'c')
  })

  it('fires immediately again once the window has fully elapsed with no intervening calls', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, WAIT_MS)

    throttled(1)
    vi.advanceTimersByTime(WAIT_MS + 50)
    throttled(2)

    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenNthCalledWith(2, 2)
  })

  it('cancel() prevents a pending trailing call from firing', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, WAIT_MS)

    throttled('a')
    vi.advanceTimersByTime(30)
    throttled('b')
    throttled.cancel()
    vi.advanceTimersByTime(WAIT_MS)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancel() is a no-op when nothing is pending', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, WAIT_MS)

    expect(() => throttled.cancel()).not.toThrow()
  })
})
