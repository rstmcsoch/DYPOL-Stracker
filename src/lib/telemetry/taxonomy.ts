/**
 * First-party product analytics: the closed list of events Stracker records and the only
 * properties each may carry. Shared by the browser tracker and the server ingest route,
 * which rejects anything not listed here. No free text from students is ever allowed: a
 * property is either an enum, a bounded number, or a short identifier-like token.
 */
export const FEATURES = [
  'chapters', 'chapter_stages', 'chapter_revisions', 'tests', 'test_subject_scores', 'test_chapter_links',
  'test_error_logs', 'test_time_entries', 'mistakes', 'practice_sessions', 'pyq_records', 'study_sessions',
  'study_cards', 'daily_tasks', 'weekly_goals', 'backlog_items', 'user_exam_tracks', 'app_settings', 'profiles',
  'home', 'syllabus', 'retry', 'planner', 'revision', 'analytics', 'weak_areas', 'backup', 'settings', 'focus',
  'practice', 'pyqs', 'backlog', 'mock_analysis', 'decks', 'study_now', 'ai', 'other'
] as const

type PropRule = { kind: 'enum'; values: readonly string[] } | { kind: 'number'; min: number; max: number } | { kind: 'token'; max: number }
const token = (max = 60): PropRule => ({ kind: 'token', max })
const oneOf = (...values: string[]): PropRule => ({ kind: 'enum', values })
const num = (min: number, max: number): PropRule => ({ kind: 'number', min, max })
const feature: PropRule = { kind: 'enum', values: FEATURES }
const op = oneOf('create', 'update', 'delete')

export const EVENTS = {
  page_view: { title: token(80) },
  session_started: {},
  signup_started: {},
  signup_completed: { needs_confirmation: oneOf('yes', 'no') },
  login_succeeded: {},
  login_failed: { reason: oneOf('invalid_credentials', 'unconfirmed', 'rate_limited', 'network', 'other') },
  password_reset_requested: {},
  email_verification_completed: {},
  onboarding_completed: { exam: token(40) },
  dashboard_viewed: {},
  feature_opened: { feature },
  student_record_write_attempted: { feature, op, count: num(1, 5000) },
  student_record_write_succeeded: { feature, op, count: num(1, 5000) },
  student_record_write_failed: { feature, op, count: num(1, 5000), reason: oneOf('offline', 'server', 'validation', 'other') },
  video_started: { video: token(40) },
  video_progress_25: { video: token(40) },
  video_progress_50: { video: token(40) },
  video_progress_75: { video: token(40) },
  video_completed: { video: token(40) },
  video_error: { video: token(40) },
  cta_clicked: { cta: token(40), placement: token(40) },
  section_viewed: { section: token(40) },
  app_error: { kind: oneOf('error', 'unhandledrejection', 'api'), fingerprint: token(64), message: token(160), status: num(0, 599) },
  web_vital: { metric: oneOf('LCP', 'INP', 'CLS', 'FCP', 'TTFB'), value: num(0, 600000), rating: oneOf('good', 'needs-improvement', 'poor'), nav: token(30) }
} as const satisfies Record<string, Record<string, PropRule>>

export type EventName = keyof typeof EVENTS
export const EVENT_NAMES = Object.keys(EVENTS) as EventName[]
export const SOURCES = ['public', 'app', 'auth', 'control'] as const
export type EventSource = (typeof SOURCES)[number]
export type EventProps = Record<string, string | number>

/** Tokens: printable, no angle brackets or control characters, trimmed, length-bounded. */
function cleanToken(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max)
  return text || null
}

/**
 * Keep only the listed properties, coerced to their rule; report the dropped keys so the
 * Tracking Health view can show missing/unknown properties. Unknown events return null.
 */
export function sanitizeProps(name: string, input: unknown): { props: EventProps; dropped: string[]; missing: string[] } | null {
  if (!Object.prototype.hasOwnProperty.call(EVENTS, name)) return null
  const rules = EVENTS[name as EventName] as Record<string, PropRule>
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const props: EventProps = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(source)) {
    const rule = rules[key]
    if (!rule) { dropped.push(key.slice(0, 40)); continue }
    if (rule.kind === 'enum') { if (typeof value === 'string' && rule.values.includes(value)) props[key] = value; else dropped.push(key) }
    else if (rule.kind === 'number') { const n = Number(value); if (Number.isFinite(n) && n >= rule.min && n <= rule.max) props[key] = Math.round(n * 1000) / 1000; else dropped.push(key) }
    else { const text = cleanToken(value, rule.max); if (text) props[key] = text; else dropped.push(key) }
  }
  const missing = Object.keys(rules).filter(key => !(key in props) && !(name === 'app_error' && key === 'status'))
  return { props, dropped, missing }
}

/** Route path with anything id-like collapsed, so URLs never carry record ids or tokens. */
export function cleanRoute(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? '/'
  return (path.split('/').map(part => /^[0-9a-f-]{16,}$/i.test(part) || /\d{4,}/.test(part) ? ':id' : part.replace(/[^a-z0-9_-]/gi, '').slice(0, 40)).join('/') || '/').slice(0, 120)
}

/** Which product surface a route belongs to. */
export function sourceForRoute(route: string): EventSource {
  if (/^\/control-panel(\/|$)/.test(route)) return 'control'
  if (/^\/(login|signup|reset-password)\b/.test(route)) return 'auth'
  return 'public'
}

/** Notebook route → feature category (for feature_opened). */
export function featureForRoute(route: string): (typeof FEATURES)[number] {
  const segment = route.split('/')[1] ?? ''
  if (!segment) return 'home'
  const key = segment.replace(/-/g, '_')
  return (FEATURES as readonly string[]).includes(key) ? key as (typeof FEATURES)[number] : 'other'
}

/** Stable grouping key for an error: kind + message with numbers/ids/urls stripped. */
export function errorFingerprint(kind: string, message: string): string {
  const normalized = `${kind}:${message}`.toLowerCase().replace(/https?:\/\/\S+/g, 'url').replace(/[0-9a-f]{8,}/g, 'id').replace(/\d+/g, 'n').replace(/\s+/g, ' ').slice(0, 200)
  let hash = 2166136261
  for (let i = 0; i < normalized.length; i += 1) { hash ^= normalized.charCodeAt(i); hash = Math.imul(hash, 16777619) }
  return `e${(hash >>> 0).toString(16)}`
}

/** Error text safe to store: emails, urls, long numbers and ids removed. */
export function scrubMessage(message: string): string {
  return message.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/https?:\/\/\S+/g, '[url]').replace(/[0-9a-f]{8,}(-[0-9a-f]{4,})*/gi, '[id]').replace(/\d{5,}/g, '[n]').slice(0, 160)
}
