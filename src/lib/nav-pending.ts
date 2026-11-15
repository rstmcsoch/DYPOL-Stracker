import { useSyncExternalStore } from 'react'

/**
 * The tab a student just tapped, shown as active straight away.
 *
 * React Router applies location changes inside a transition, so the real `active` class only
 * moves once the next page has rendered. This tiny store is updated synchronously on tap so
 * the highlight moves on the very next frame; the shell clears it when the route commits.
 */
let pendingPath: string | null = null
const listeners = new Set<() => void>()

export function setPendingNav(path: string | null): void {
  if (pendingPath === path) return
  pendingPath = path
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function usePendingNav(): string | null {
  return useSyncExternalStore(subscribe, () => pendingPath, () => null)
}

/** Same matching rule as NavLink: exact for `/` or `end`, otherwise the path or a sub-path. */
export function navMatches(to: string, pathname: string, exact = false): boolean {
  if (pathname === to) return true
  if (exact || to === '/') return false
  return pathname.startsWith(`${to}/`)
}

/** Only a plain primary click navigates in this tab; modified clicks open elsewhere. */
export function isPlainClick(event: { button: number; metaKey: boolean; altKey: boolean; ctrlKey: boolean; shiftKey: boolean; defaultPrevented: boolean }): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey
}
