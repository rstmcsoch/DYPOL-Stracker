import { useCallback, useEffect, useRef, useState, type AnimationEvent } from 'react'

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Play a short exit animation before running a close/unmount callback.
 * `exit(fn)` sets data-state="closed" (via `state`), then runs `fn` once on the element's own
 * animationend, or after `fallbackMs` if no animation fires (CSS missing, tab hidden, etc.).
 * With reduced motion `fn` runs immediately. If the parent keeps the element mounted after `fn`
 * (a refused close), the state returns to "open" so nothing stays invisible.
 */
export function useExit(fallbackMs = 200) {
  const [closing, setClosing] = useState(false)
  const pending = useRef<(() => void) | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const finish = useCallback(() => {
    const fn = pending.current
    if (!fn) return
    pending.current = null
    window.clearTimeout(timer.current)
    fn()
    setClosing(false)
  }, [])
  const exit = useCallback((fn: () => void) => {
    if (pending.current) return
    if (prefersReducedMotion()) { fn(); return }
    pending.current = fn
    setClosing(true)
    timer.current = window.setTimeout(finish, fallbackMs)
  }, [fallbackMs, finish])
  const onAnimationEnd = useCallback((event: AnimationEvent) => {
    if (event.target === event.currentTarget && pending.current) finish()
  }, [finish])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return { state: closing ? 'closed' as const : 'open' as const, exit, onAnimationEnd }
}
