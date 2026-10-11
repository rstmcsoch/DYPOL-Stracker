import { useEffect, useState } from 'react'

/** Pixels of movement needed before the direction counts, so tiny jitters don't toggle it. */
export const SCROLL_DIRECTION_THRESHOLD = 8
/** Near the top of the page the launcher always shows as the compact circle. */
export const SCROLL_TOP_ZONE = 24

/**
 * Pure state step for the Ask Stracker launcher: scrolling down expands it into a labelled pill,
 * scrolling up collapses it back to a circle, small movements keep the current state.
 */
export function nextScrollExpanded(expanded: boolean, lastY: number, y: number, threshold = SCROLL_DIRECTION_THRESHOLD): boolean {
  if (y <= SCROLL_TOP_ZONE) return false
  if (y - lastY > threshold) return true
  if (lastY - y > threshold) return false
  return expanded
}

/**
 * Tracks window scroll direction (the student app scrolls the document, not an inner element).
 * One passive listener, throttled to one update per animation frame.
 */
export function useScrollExpanded(): boolean {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    let lastY = window.scrollY
    let current = false
    let frame = 0
    const update = () => {
      frame = 0
      const y = window.scrollY
      const next = nextScrollExpanded(current, lastY, y)
      // Move the reference point only once a direction is decided (or at the top), so slow scrolls still register.
      if (next !== current || Math.abs(y - lastY) > SCROLL_DIRECTION_THRESHOLD || y <= SCROLL_TOP_ZONE) lastY = y
      if (next !== current) { current = next; setExpanded(next) }
    }
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])
  return expanded
}
