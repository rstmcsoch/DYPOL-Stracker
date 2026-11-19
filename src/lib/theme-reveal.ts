import { flushSync } from 'react-dom'
import '../styles/theme-reveal.css'

/**
 * Light/night switch with a circular reveal that grows from the control that was pressed.
 *
 * Uses the View Transitions API: the browser snapshots the old page, `update` applies the new
 * theme synchronously (flushSync), and the new page is revealed through an expanding
 * `clip-path: circle()` on `::view-transition-new(root)` with `fill: 'both'` so frame 0 and
 * the final teardown frame never flash. Only the clip animates (compositor-friendly, no filters
 * or extra isolation buffers) for smooth performance on low-spec devices. Browsers without the
 * API, reduced-motion users and hidden tabs switch instantly. Presses during a running reveal
 * are ignored, and a safety cleanup watchdog guarantees a stalled transition can never stick.
 */
export const THEME_REVEAL_MS = 380
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const CLEANUP_FALLBACK_MS = THEME_REVEAL_MS + 320

type ViewTransitionLike = {
  ready: Promise<void>
  finished: Promise<void>
  skipTransition?: () => void
}
type DocumentWithVT = Document & { startViewTransition?: (update: () => void) => ViewTransitionLike }

let running = false
let currentRunId = 0
let activeAnimation: Animation | null = null
let activeTransition: ViewTransitionLike | null = null
let cleanupTimer: ReturnType<typeof setTimeout> | null = null

export function isThemeRevealRunning(): boolean {
  return running
}

function finishRun(runId: number, root: HTMLElement): void {
  if (runId !== currentRunId) return
  if (cleanupTimer !== null) {
    clearTimeout(cleanupTimer)
    cleanupTimer = null
  }
  if (activeAnimation) {
    try { activeAnimation.cancel() } catch { /* already finished or detached */ }
    activeAnimation = null
  }
  activeTransition = null
  running = false
  root.classList.remove('theme-revealing')
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

  transition.ready.then(() => {
    if (runId !== currentRunId || typeof root.animate !== 'function') return
    activeAnimation = root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: THEME_REVEAL_MS, easing: EASING, fill: 'both', pseudoElement: '::view-transition-new(root)' }
    )
  }).catch(() => {
    finishRun(runId, root)
  })

  transition.finished.catch(() => undefined).finally(() => {
    finishRun(runId, root)
  })
}
