/**
 * Register the offline shell in production only. The worker caches the application
 * shell as an offline fallback, but online document navigations are network-first.
 * New workers activate without an update prompt; the current in-memory route is left
 * alone, and the user's next ordinary refresh fetches the deployment's latest HTML.
 */
export function registerOfflineApplicationShell(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

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
}
