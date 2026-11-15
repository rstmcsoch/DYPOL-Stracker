/**
 * Recovery for page code that never arrives.
 *
 * A lazily loaded page can stall (a request stuck on a flaky mobile connection) or fail (an old
 * tab asking for a file a newer deploy replaced). Either way React keeps showing the
 * "Just a moment…" fallback forever, and a manual refresh fixes it. This does that refresh once,
 * automatically, and never loops: at most one recovery reload per minute per tab.
 */
const RELOAD_KEY = 'stracker-chunk-reload-at'
const RELOAD_WINDOW_MS = 60_000
export const CHUNK_TIMEOUT_MS = 8_000

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Unable to preload CSS|Loading chunk|Loading CSS chunk/i.test(message)
}

/** Reloads the page once; returns false (does nothing) if a recovery reload just happened. */
export function reloadOnce(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSession(), reload: () => void = () => window.location.reload(), now = Date.now()): boolean {
  if (!storage) return false
  const last = Number(storage.getItem(RELOAD_KEY) ?? 0)
  if (Number.isFinite(last) && now - last < RELOAD_WINDOW_MS) return false
  try { storage.setItem(RELOAD_KEY, String(now)) } catch { return false }
  reload()
  return true
}

function safeSession(): Storage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { return null }
}

/**
 * Wraps a dynamic import: a stale-chunk error, or no answer within `timeoutMs`, triggers the
 * one-time reload. If a reload already happened recently the import keeps waiting / rejects
 * normally, so a genuinely slow connection still finishes loading.
 */
export function withChunkRecovery<T>(load: () => Promise<T>, timeoutMs = CHUNK_TIMEOUT_MS, recover: () => boolean = reloadOnce): () => Promise<T> {
  return () => new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => { if (!settled) recover() }, timeoutMs)
    load().then(value => {
      settled = true
      clearTimeout(timer)
      resolve(value)
    }, (error: unknown) => {
      settled = true
      clearTimeout(timer)
      if (isChunkLoadError(error) && recover()) return
      reject(error)
    })
  })
}

/** Vite reports failed CSS/JS preloads for dynamic imports with this event. */
export function installChunkErrorRecovery(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('vite:preloadError', event => {
    if (reloadOnce()) event.preventDefault()
  })
}
