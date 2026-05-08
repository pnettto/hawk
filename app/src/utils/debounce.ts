export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait = 300,
): ((...args: A) => void) & { cancel: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: A | null = null

  const wrapped = (...args: A) => {
    lastArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const a = lastArgs!
      lastArgs = null
      fn(...a)
    }, wait)
  }
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    lastArgs = null
  }
  wrapped.flush = () => {
    if (timer && lastArgs) {
      clearTimeout(timer)
      timer = null
      const a = lastArgs
      lastArgs = null
      fn(...a)
    }
  }
  return wrapped
}
