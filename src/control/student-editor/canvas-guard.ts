/**
 * Network and storage guard for the Student Dashboard Editor canvas window.
 *
 * The canvas renders the real student pages, so any code path that would normally talk to
 * Supabase, the sync queue, IndexedDB, private image storage, telemetry or the AI backend is
 * refused here as a second line of defence behind the preview-only providers. Allowed:
 * same-origin static assets, read-only console session checks, and Supabase session refresh
 * (so the shared sign-in in this browser stays healthy). Installed only inside the canvas.
 */

export const PREVIEW_BLOCKED = 'Blocked in the synthetic student preview.'

function blocked(): Promise<Response> {
  return Promise.reject(new TypeError(PREVIEW_BLOCKED))
}

/** Whether a request may leave the canvas window (exported for tests). */
export function previewRequestAllowed(input: string, method: string, origin: string): boolean {
  let url: URL
  try { url = new URL(input, origin) } catch { return false }
  const verb = method.toUpperCase()
  if (url.origin === origin) {
    if (!url.pathname.startsWith('/api/')) return verb === 'GET'
    return verb === 'GET' && url.pathname.startsWith('/api/control/') && !url.pathname.includes('student-layout') && !url.pathname.includes('appearance')
  }
  // Supabase Auth session refresh only; no tables, storage, functions or realtime.
  return /\.supabase\.co$/.test(url.hostname) && (url.pathname === '/auth/v1/token' || url.pathname === '/auth/v1/user')
}

export function installPreviewGuard(target: Window & typeof globalThis = window): () => void {
  const originalFetch = target.fetch.bind(target)
  const origin = target.location.origin
  target.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
    return previewRequestAllowed(url, method, origin) ? originalFetch(input, init) : blocked()
  }) as typeof fetch
  const restore: Array<() => void> = [() => { target.fetch = originalFetch }]
  const replace = (owner: object, key: string, value: unknown) => {
    const previous = Object.getOwnPropertyDescriptor(owner, key)
    try {
      Object.defineProperty(owner, key, { configurable: true, writable: true, value })
      restore.push(() => { if (previous) Object.defineProperty(owner, key, previous); else delete (owner as Record<string, unknown>)[key] })
    } catch { /* read-only in this browser: the preview providers still never call it */ }
  }
  if (target.navigator && 'sendBeacon' in target.navigator) replace(target.navigator, 'sendBeacon', () => true)
  if (target.indexedDB) {
    const refuse = () => { throw new DOMException(PREVIEW_BLOCKED, 'SecurityError') }
    replace(target.indexedDB, 'open', refuse)
    replace(target.indexedDB, 'deleteDatabase', refuse)
  }
  replace(target, 'Notification', undefined)
  replace(target, 'open', () => null)
  return () => { for (const undo of restore.reverse()) undo() }
}
