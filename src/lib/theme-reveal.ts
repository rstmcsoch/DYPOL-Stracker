import { flushSync } from 'react-dom'
import '../styles/theme-reveal.css'

/**
 * Telegram-inspired light/night switch with a circular reveal that grows from the pressed control.
 *
 * Uses the View Transitions API with pure CSS @keyframes (`theme-reveal-circle` in
 * `src/styles/theme-reveal.css`):
 * 1. Origin coordinates and max corner radius are written to `--theme-reveal-*` custom properties
 *    on `<html>` synchronously BEFORE `startViewTransition()` is called.
 * 2. Because the CSS keyframe with `fill-mode: both` is bound to `:root.theme-revealing::view-transition-new(root)`
 *    before the pseudo-element tree is created, Frame 0 is clipped to `circle(0px ...)` from the
 *    very first compositor frame — eliminating the 1-frame unclipped flash caused by waiting for
 *    `transition.ready.then(() => root.animate(...))`.
 * 3. Only `clip-path` animates on the compositor thread (zero JS animation loop, zero filters),
 *    keeping transitions smooth on low-spec devices.
 */
export const THEME_REVEAL_MS = 560
const CLEANUP_FALLBACK_MS = THEME_REVEAL_MS + 400

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

  const rect = origin.getBoundingClientRect()
  const x = Math.round(rect.left + rect.width / 2)
  const y = Math.round(rect.top + rect.height / 2)
  const width = window.innerWidth
  const height = window.innerHeight
  const radius = Math.ceil(Math.hypot(Math.max(x, width - x), Math.max(y, height - y)))
  const root = doc.documentElement
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
