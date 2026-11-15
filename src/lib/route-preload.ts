/**
 * Route chunk loaders shared by `lazy()` in App.tsx and the navigation prefetcher.
 *
 * A tap on a tab used to start downloading/parsing that page's chunk only after the click,
 * and React Router keeps the old page (and the old highlight) on screen until it arrives.
 * Each loader is memoised, so `lazy()` and the prefetcher share one promise per chunk; a
 * failed load (offline, deploy swap) is forgotten so the next attempt retries.
 */
type Loader<T> = () => Promise<T>

function once<T>(load: Loader<T>): Loader<T> {
  let promise: Promise<T> | null = null
  return () => {
    if (!promise) promise = load().catch(error => { promise = null; throw error })
    return promise
  }
}

export const routeLoaders = {
  '/': once(() => import('../pages/HomePage')),
  '/syllabus': once(() => import('../pages/SyllabusPage')),
  '/tests': once(() => import('../pages/TestsPage')),
  '/mistakes': once(() => import('../pages/MistakesPage')),
  '/retry': once(() => import('../pages/RetryPage')),
  '/planner': once(() => import('../pages/PlannerPage')),
  '/revision': once(() => import('../pages/RevisionPage')),
  '/analytics': once(() => import('../pages/AnalyticsPage')),
  '/weak-areas': once(() => import('../pages/WeakAreasPage')),
  '/backup': once(() => import('../pages/BackupPage')),
  '/settings': once(() => import('../pages/SettingsPage')),
  '/profile': once(() => import('../pages/ProfilePage')),
  '/focus': once(() => import('../pages/FocusPage')),
  '/practice': once(() => import('../pages/PracticePage')),
  '/pyqs': once(() => import('../pages/PyqPage')),
  '/backlog': once(() => import('../pages/BacklogPage')),
  '/mock-analysis': once(() => import('../pages/MockAnalysisPage')),
  '/decks': once(() => import('../pages/DecksPage')),
  '/study-now': once(() => import('../pages/StudyNowPage'))
} as const

export type AppRoutePath = keyof typeof routeLoaders

/** The tabs students reach most often are warmed first. */
const WARM_ORDER: AppRoutePath[] = ['/tests', '/analytics', '/syllabus', '/planner', '/profile', '/settings', '/revision', '/mistakes', '/focus', '/practice']

/** Starts loading a route's chunk (hover, focus or pointerdown on a link). Never throws. */
export function preloadRoute(path: string): void {
  const loader = (routeLoaders as Record<string, Loader<unknown> | undefined>)[path.split(/[?#]/)[0] ?? path]
  if (loader) void loader().catch(() => { /* a later real navigation retries and shows the usual error UI */ })
}

function shouldSaveData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  return Boolean(connection?.saveData) || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g'
}

/**
 * After the first paint, warms every signed-in route one at a time in idle periods, so a
 * later tap renders from memory instead of waiting on the network or service worker.
 * Skipped on Data Saver / 2G. Returns a cancel function.
 */
export function preloadAppRoutesWhenIdle(): () => void {
  if (typeof window === 'undefined' || shouldSaveData()) return () => {}
  const hasIdle = typeof window.requestIdleCallback === 'function'
  const queue: AppRoutePath[] = [...WARM_ORDER, ...(Object.keys(routeLoaders) as AppRoutePath[]).filter(path => !WARM_ORDER.includes(path))]
  let cancelled = false
  let handle: number | null = null
  const schedule = (run: () => void) => {
    handle = hasIdle ? window.requestIdleCallback(run, { timeout: 2000 }) : window.setTimeout(run, 200)
  }
  const next = () => {
    if (cancelled) return
    const path = queue.shift()
    if (!path) return
    routeLoaders[path]().catch(() => undefined).finally(() => { if (!cancelled) schedule(next) })
  }
  schedule(next)
  return () => {
    cancelled = true
    if (handle !== null) {
      if (hasIdle) window.cancelIdleCallback(handle)
      else window.clearTimeout(handle)
    }
  }
}
