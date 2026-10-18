import { FEATURES, cleanRoute, errorFingerprint, scrubMessage, type EventName, type EventProps, type EventSource } from './taxonomy'

/**
 * Privacy-friendly first-party tracker.
 * - No cookies. One random session id in sessionStorage (cleared when the tab closes).
 * - Honours Do Not Track / Global Privacy Control: nothing is sent at all.
 * - The signed-in account is sent as a raw id only to our own ingest route, which stores a
 *   keyed hash instead (pseudonymous); IPs are never stored.
 * - Batched and flushed with sendBeacon on page hide, so it never slows the app.
 * - Test traffic: open any page with ?analytics_test=1 to tag this tab's events as test
 *   (excluded from reports by default); ?analytics_test=0 clears it.
 */
export const INGEST_PATH = '/api/control/analytics-ingest'
const SESSION_KEY = 'stracker.analytics.session'
const TEST_KEY = 'stracker.analytics.test'
const MAX_QUEUE = 40

interface QueuedEvent { id: string; name: EventName; ts: string; source: EventSource; route: string; props: EventProps }

let queue: QueuedEvent[] = []
let timer: number | undefined
let userId: string | null = null
let appMode = false
let context: Record<string, unknown> | null = null

function uuid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16))
}

export function trackingAllowed(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (import.meta.env.MODE === 'test') return false
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  return !(nav.doNotTrack === '1' || (window as unknown as { doNotTrack?: string }).doNotTrack === '1' || nav.globalPrivacyControl === true)
}

function storage(): Storage | null { try { return window.sessionStorage } catch { return null } }

function browserFamily(ua: string): string {
  if (/edg\//i.test(ua)) return 'edge'
  if (/opr\/|opera/i.test(ua)) return 'opera'
  if (/samsungbrowser/i.test(ua)) return 'samsung'
  if (/firefox|fxios/i.test(ua)) return 'firefox'
  if (/chrome|crios/i.test(ua)) return 'chrome'
  if (/safari/i.test(ua)) return 'safari'
  return 'other'
}

function sessionContext(): Record<string, unknown> {
  if (context) return context
  const store = storage()
  const params = new URLSearchParams(window.location.search)
  if (params.get('analytics_test') === '1') store?.setItem(TEST_KEY, '1')
  if (params.get('analytics_test') === '0') store?.removeItem(TEST_KEY)
  let session = store?.getItem(SESSION_KEY)
  const fresh = !session
  if (!session) { session = uuid(); store?.setItem(SESSION_KEY, session) }
  let referrer: string | null = null
  try { const host = document.referrer ? new URL(document.referrer).hostname : ''; referrer = host && host !== window.location.hostname ? host : null } catch { referrer = null }
  const width = window.innerWidth
  context = {
    session_id: session,
    test: store?.getItem(TEST_KEY) === '1',
    device: width < 640 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop',
    viewport: `${Math.round(width / 10) * 10}x${Math.round(window.innerHeight / 10) * 10}`,
    browser: browserFamily(navigator.userAgent),
    referrer,
    utm_source: params.get('utm_source'), utm_medium: params.get('utm_medium'), utm_campaign: params.get('utm_campaign')
  }
  if (fresh) queueMicrotask(() => track('session_started'))
  return context
}

/** Called by the auth layer; null when signed out. Local-only preview accounts are never linked. */
export function setTelemetryUser(id: string | null, inApp: boolean): void {
  userId = id
  appMode = inApp
}

function currentSource(route: string): EventSource {
  if (/^\/control-panel(\/|$)/.test(route)) return 'control'
  if (/^\/(login|signup|reset-password)/.test(route)) return 'auth'
  return appMode ? 'app' : 'public'
}

export function track(name: EventName, props: EventProps = {}): void {
  if (!trackingAllowed()) return
  try {
    sessionContext()
    const route = cleanRoute(window.location.pathname)
    queue.push({ id: uuid(), name, ts: new Date().toISOString(), source: currentSource(route), route, props })
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE)
    if (queue.length >= 15) flush()
    else if (timer === undefined) timer = window.setTimeout(flush, 5000)
  } catch {
    // Analytics must never break the app.
  }
}

export function flush(): void {
  if (timer !== undefined) { clearTimeout(timer); timer = undefined }
  if (!queue.length || !context) return
  const batch = queue.splice(0, 25)
  const body = JSON.stringify({ context: { ...context, user_id: userId }, events: batch })
  try {
    const sent = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(INGEST_PATH, new Blob([body], { type: 'application/json' }))
    if (!sent) void fetch(INGEST_PATH, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true, credentials: 'omit' }).catch(() => undefined)
  } catch { /* dropped */ }
  if (queue.length) timer = window.setTimeout(flush, 1000)
}

let installed = false
const reported = new Set<string>()

/** Report a client error once per fingerprint per page load. */
export function reportError(kind: 'error' | 'unhandledrejection' | 'api', message: string, status?: number): void {
  const clean = scrubMessage(message || 'Unknown error')
  const fingerprint = errorFingerprint(kind, clean)
  if (reported.has(fingerprint) || reported.size > 20) return
  reported.add(fingerprint)
  track('app_error', { kind, fingerprint, message: clean, ...(status ? { status } : {}) })
}

/** Global listeners: errors, page hide flush, and real-user web vitals. Idempotent. */
export function installTelemetry(): void {
  if (installed || !trackingAllowed()) return
  installed = true
  window.addEventListener('error', event => reportError('error', event.message || String(event.error ?? '')))
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason as { message?: unknown } | undefined
    reportError('unhandledrejection', typeof reason?.message === 'string' ? reason.message : String(event.reason ?? ''))
  })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
  window.addEventListener('pagehide', flush)
  void import('web-vitals').then(({ onLCP, onINP, onCLS, onFCP, onTTFB }) => {
    const send = (metric: { name: string; value: number; rating: string; navigationType?: string }) =>
      track('web_vital', { metric: metric.name, value: metric.value, rating: metric.rating, nav: metric.navigationType ?? 'navigate' })
    onLCP(send); onINP(send); onCLS(send); onFCP(send); onTTFB(send)
  }).catch(() => undefined)
}

/** Test hook. */
export function _resetTelemetryForTests(): void { queue = []; context = null; installed = false; reported.clear() }
export function _queued(): readonly QueuedEvent[] { return queue }

/** Coarse login failure category; the provider message itself is never sent. */
export function loginFailureReason(message: string): 'invalid_credentials' | 'unconfirmed' | 'rate_limited' | 'network' | 'other' {
  if (/invalid login|invalid credentials/i.test(message)) return 'invalid_credentials'
  if (/not confirmed|confirm/i.test(message)) return 'unconfirmed'
  if (/rate|too many/i.test(message)) return 'rate_limited'
  if (/fetch|network/i.test(message)) return 'network'
  return 'other'
}

/** Student record write outcome: feature category, operation and row count only — never content. */
export function trackStudentWrite(stage: 'attempted' | 'succeeded' | 'failed', table: string, op: 'create' | 'update' | 'delete', count: number, reason?: 'offline' | 'server' | 'validation' | 'other'): void {
  const feature = (FEATURES as readonly string[]).includes(table) ? table : 'other'
  track(`student_record_write_${stage}`, { feature, op, count: Math.max(1, Math.min(5000, count)), ...(stage === 'failed' ? { reason: reason ?? 'other' } : {}) })
}
