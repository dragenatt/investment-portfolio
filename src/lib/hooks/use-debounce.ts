import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * Returns a debounced version of the provided value.
 * The returned value only updates after `delay` ms of inactivity.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}

/**
 * Returns a debounced version of the provided callback.
 * The callback only fires after `delay` ms of inactivity.
 */
export function useDebouncedCallback<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): T {
  // The latest callback, kept in a ref so a re-render does not restart the
  // timer. Assigned in an effect, not during render: writing a ref while
  // rendering is what the React rules forbid, and the disable comment that
  // used to sit below turned the whole check off for this function rather
  // than fixing it. The timer only ever fires after a commit, so the ref it
  // reads is the same one either way.
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  }, [fn])

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const debounced = useCallback(
    (...args: unknown[]) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => fnRef.current(...args), delay)
    },
    [delay]
  )

  return debounced as T
}
