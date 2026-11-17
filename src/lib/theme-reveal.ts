import { flushSync } from 'react-dom'
import '../styles/theme-reveal.css'

/**
 * Light/night switch with a circular reveal that grows from the control that was pressed.
 *
 * Uses the View Transitions API: the browser snapshots the old page, `update` applies the new
 * theme synchronously (flushSync), and the new page is revealed through an expanding
 * `clip-path: circle()` on `::view-transition-new(root)`. Only the clip animates (GPU-cheap,
 * no filters or blend modes). Browsers without the API, reduced-motion users and hidden tabs
 * switch instantly. Presses during a running reveal are ignored.
 */
export const THEME_REVEAL_MS = 520
const EASING = 'cubic-bezier(.22, .61, .36, 1)'

type ViewTransitionLike = { ready: Promise<void>; finished: Promise<void> }
type DocumentWithVT = Document & { startViewTransition?: (update: () => void) => ViewTransitionLike }

let running = false

export function isThemeRevealRunning(): boolean {
  return running
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
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  const width = window.innerWidth
  const height = window.innerHeight
  const radius = Math.ceil(Math.hypot(Math.max(x, width - x), Math.max(y, height - y)))
  const root = doc.documentElement

  running = true
  root.classList.add('theme-revealing')
  let transition: ViewTransitionLike
  try {
    transition = doc.startViewTransition.call(doc, () => { flushSync(update) })
  } catch {
    running = false
    root.classList.remove('theme-revealing')
    update()
    return
  }
  transition.ready.then(() => {
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: THEME_REVEAL_MS, easing: EASING, pseudoElement: '::view-transition-new(root)' }
    )
  }).catch(() => undefined)
  transition.finished.catch(() => undefined).finally(() => {
    running = false
    root.classList.remove('theme-revealing')
  })
}
