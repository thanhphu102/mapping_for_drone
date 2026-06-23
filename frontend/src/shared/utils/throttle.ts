// Minimal, dependency-free throttle. Leading + trailing edges, like lodash/throttle
// at its defaults, but tiny and strictly typed.

export interface ThrottledFunction<A extends unknown[]> {
  (...args: A): void
  /** Cancel any pending trailing invocation (call on unmount). */
  cancel: () => void
}

/**
 * Returns a throttled wrapper of `fn` that runs at most once per `waitMs`.
 * The most recent call within a window is invoked on the trailing edge so the
 * final state is never dropped.
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
): ThrottledFunction<A> {
  let lastCallTime = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: A | null = null

  const invoke = (args: A) => {
    lastCallTime = Date.now()
    fn(...args)
  }

  const throttled = ((...args: A) => {
    const now = Date.now()
    const remaining = waitMs - (now - lastCallTime)

    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      invoke(args)
      return
    }

    // Within the window: remember the latest args and ensure a trailing run.
    pendingArgs = args
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null
        if (pendingArgs) {
          const trailingArgs = pendingArgs
          pendingArgs = null
          invoke(trailingArgs)
        }
      }, remaining)
    }
  }) as ThrottledFunction<A>

  throttled.cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    pendingArgs = null
  }

  return throttled
}
