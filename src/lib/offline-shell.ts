/**
 * Register the offline shell in production only. The worker caches the application
 * shell as an offline fallback, but online document navigations are network-first.
 * New workers activate without an update prompt; the current in-memory route is left
 * alone, and the user's next ordinary refresh fetches the deployment's latest HTML.
 */
export function registerOfflineApplicationShell(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  // Installing the worker downloads the whole offline precache (several MB). Doing that while
  // the first page is still loading made it fight the homepage's own files for bandwidth on
  // mobile connections, leaving "Just a moment…" up for a long time after every deploy.
  // Register only after the page has loaded and the browser is idle.
  whenPageSettled(() => {
    void import('virtual:pwa-register').then(({ registerSW }) => {
      registerSW({
        immediate: true,
        // autoUpdate normally reloads on controllerchange. Keep the current session
        // stable instead: fresh documents are obtained by the network-first nav route.
        onNeedReload() {}
      })
    }).catch(() => {
      // The site remains fully usable online if service-worker registration is blocked.
    })
  })
}

export const SW_REGISTER_DELAY_MS = 4_000

/** Runs `task` after window load, then a short delay and an idle period. */
export function whenPageSettled(task: () => void, win: Window = window): void {
  const schedule = () => {
    win.setTimeout(() => {
      if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(() => task(), { timeout: 5_000 })
      else task()
    }, SW_REGISTER_DELAY_MS)
  }
  if (win.document.readyState === 'complete') schedule()
  else win.addEventListener('load', schedule, { once: true })
}
