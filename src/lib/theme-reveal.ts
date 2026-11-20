import { flushSync } from 'react-dom'
import '../styles/theme-reveal.css'

/**
 * Light/night switch with a single-flow circular reveal that grows from the pressed control.
 *
 * Uses the View Transitions API with pure CSS @keyframes (`theme-reveal-circle` in
 * `src/styles/theme-reveal.css`):
 * 1. Origin coordinates and exact farthest-corner radius (accounting for mobile dynamic
 *    viewport differences plus a 4px anti-aliasing buffer) are written to `--theme-reveal-*`
 *    custom properties on `<html>` synchronously BEFORE `startViewTransition()` is called.
 * 2. Because the CSS keyframe with `fill-mode: both` is bound to `:root.theme-revealing::view-transition-new(root)`
 *    before the pseudo-element tree is created, Frame 0 is clipped to `circle(0px ...)` from the
 *    very first compositor frame — eliminating the 1-frame unclipped flash.
 * 3. Only `clip-path` animates on the compositor thread (zero JS animation loop, zero filters)
 *    with a non-stalling exit curve (`cubic-bezier(0.30, 0.02, 0.52, 0.72)`) so the wave clears
 *    the farthest corner cleanly in one uninterrupted flow on every device.
 */
export const THEME_REVEAL_MS = 420
const CLEANUP_FALLBACK_MS = THEME_REVEAL_MS + 350

type ViewTransitionLike = {
  ready: Promise<void>
  finished: Promise<void>
  skipTransition?: () => void
}
type DocumentWithVT = Document & { startViewTransition?: (update: () => void) => ViewTransitionLike }

let running = false
let currentRunId = 0
let activeTransition: ViewTransitionLike | null = null
let cleanupTimer: ReturnType<typeof setTimeout> | null = null

export function isThemeRevealRunning(): boolean {
  return running
}

function clearRevealStyles(root: HTMLElement): void {
  root.classList.remove('theme-revealing')
  root.style.removeProperty('--theme-reveal-x')
  root.style.removeProperty('--theme-reveal-y')
  root.style.removeProperty('--theme-reveal-r')
  root.style.removeProperty('--theme-reveal-duration')
}

function finishRun(runId: number, root: HTMLElement): void {
  if (runId !== currentRunId) return
  if (cleanupTimer !== null) {
    clearTimeout(cleanupTimer)
    cleanupTimer = null
  }
  activeTransition = null
  running = false
  clearRevealStyles(root)
}

export function revealThemeChange(origin: Element | null | undefined, update: () => void, animate = true): void {
  if (running) return
  const doc = document as DocumentWithVT
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!animate || !origin || typeof doc.startViewTransition !== 'function' || reduced || doc.visibilityState === 'hidden') {
    update()
    return
  }

  const root = doc.documentElement
  const rect = origin.getBoundingClientRect()
  const x = Math.round(rect.left + rect.width / 2)
  const y = Math.round(rect.top + rect.height / 2)
  const width = Math.max(window.innerWidth, root.clientWidth)
  const height = Math.max(window.innerHeight, root.clientHeight)
  const radius = Math.ceil(Math.hypot(Math.max(x, width - x), Math.max(y, height - y))) + 4
  const runId = ++currentRunId

  running = true
  // Write geometry + class BEFORE startViewTransition so CSS @keyframes binds on Frame 0.
  root.style.setProperty('--theme-reveal-x', `${x}px`)
  root.style.setProperty('--theme-reveal-y', `${y}px`)
  root.style.setProperty('--theme-reveal-r', `${radius}px`)
  root.style.setProperty('--theme-reveal-duration', `${THEME_REVEAL_MS}ms`)
  root.classList.add('theme-revealing')

  let transition: ViewTransitionLike
  try {
    transition = doc.startViewTransition.call(doc, () => { flushSync(update) })
  } catch {
    finishRun(runId, root)
    update()
    return
  }
  activeTransition = transition

  // Watchdog: if the browser/GPU stalls on rapid toggles, force-skip and release the lock.
  cleanupTimer = setTimeout(() => {
    if (runId !== currentRunId) return
    try { activeTransition?.skipTransition?.() } catch { /* ignore */ }
    finishRun(runId, root)
  }, CLEANUP_FALLBACK_MS)

  transition.ready.catch(() => {
    finishRun(runId, root)
  })

  transition.finished.catch(() => undefined).finally(() => {
    finishRun(runId, root)
  })
}
