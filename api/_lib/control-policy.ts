/**
 * Pure policy helpers for the Stracker Control Center. Nothing in this module touches the
 * network or the database, so the rules that decide access, MFA freshness, audit contents
 * and export shape can be unit-tested directly.
 */

/** Idle sessions expire after this many seconds on the console (mirrors the browser policy). */
export const CONTROL_IDLE_TIMEOUT_SECONDS = 20 * 60

/** A sensitive action needs a TOTP verification no older than this many seconds. */
export const RECENT_MFA_MAX_AGE_SECONDS = 15 * 60

/** Authenticated console requests allowed per account per minute. */
export const CONTROL_API_LIMIT = { limit: 120, windowSeconds: 60 }

/** Denied-access audit entries recorded per account per window (prevents audit flooding). */
export const DENIED_AUDIT_LIMIT = { limit: 20, windowSeconds: 600 }

/** Signed-out attempts per client-IP hash per minute. */
export const ANONYMOUS_LIMIT = { limit: 60, windowSeconds: 60 }

export const CONTROL_ROLES = ['owner', 'administrator', 'support', 'analyst'] as const
export type ControlRole = (typeof CONTROL_ROLES)[number]

/** Only the owner has an implemented permission set today. Other roles grant nothing. */
export function roleGrantsConsole(role: string | null | undefined, revokedAt: string | null | undefined): boolean {
  return role === 'owner' && !revokedAt
}

export interface AmrEntry { method?: unknown; timestamp?: unknown }

/**
 * Returns the newest timestamp (Unix seconds) of a multi-factor method in the JWT `amr`
 * claim, or null when the session was not established with MFA. Only TOTP and phone
 * factors count as a second factor here.
 */
export function latestMfaTimestamp(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null
  let latest: number | null = null
  for (const entry of amr as AmrEntry[]) {
    if (!entry || typeof entry !== 'object') continue
    if (entry.method !== 'totp' && entry.method !== 'phone') continue
    if (typeof entry.timestamp !== 'number' || !Number.isFinite(entry.timestamp)) continue
    latest = latest === null ? entry.timestamp : Math.max(latest, entry.timestamp)
  }
  return latest
}

export function isRecentMfa(mfaTimestamp: number | null, nowSeconds: number, maxAgeSeconds = RECENT_MFA_MAX_AGE_SECONDS): boolean {
  if (mfaTimestamp === null) return false
  if (mfaTimestamp > nowSeconds + 60) return false // reject timestamps from the future (clock skew allowance 60s)
  return nowSeconds - mfaTimestamp <= maxAgeSeconds
}

/** Only exact aal2 satisfies the console. aal1 and any unknown value are denied. */
export function isAal2(aal: unknown): boolean {
  return aal === 'aal2'
}

/** Trims, strips control characters and caps the length of operator-entered text. */
export function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  // Replace C0 controls and DEL by code point (kept free of control-character regexes).
  const cleaned = Array.from(value, character => {
    const code = character.codePointAt(0) ?? 0
    return code < 32 || code === 127 ? ' ' : character
  }).join('')
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

export interface ParsedPage { limit: number; offset: number; page: number }

/** Bounded pagination. Non-numeric, negative or oversized inputs fall back to safe values. */
export function parsePage(pageValue: unknown, sizeValue: unknown, defaultSize = 25, maxSize = 100): ParsedPage {
  const size = clampInt(sizeValue, 1, maxSize, defaultSize)
  const page = clampInt(pageValue, 1, 10_000, 1)
  return { limit: size, offset: (page - 1) * size, page }
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'string' && /^-?\d{1,9}$/.test(value.trim()) ? Number(value) : typeof value === 'number' ? value : NaN
  if (!Number.isInteger(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

export const USER_STATUS_FILTERS = ['all', 'verified', 'unverified', 'suspended'] as const
export const USER_SORTS = ['created_desc', 'created_asc', 'last_sign_in'] as const

export function parseUserStatus(value: unknown): (typeof USER_STATUS_FILTERS)[number] {
  return (USER_STATUS_FILTERS as readonly string[]).includes(value as string) ? (value as (typeof USER_STATUS_FILTERS)[number]) : 'all'
}

export function parseUserSort(value: unknown): (typeof USER_SORTS)[number] {
  return (USER_SORTS as readonly string[]).includes(value as string) ? (value as (typeof USER_SORTS)[number]) : 'created_desc'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** Free-text search: bounded, no control characters. Matching itself is plain text in SQL. */
export function parseSearch(value: unknown): string {
  return cleanText(value, 120)
}

export const AUDIT_OUTCOMES = ['success', 'denied', 'failed'] as const
export type AuditOutcomeFilter = (typeof AUDIT_OUTCOMES)[number]
export const AUDIT_ACTION_PATTERN = /^[a-z][a-z0-9_.]{0,79}$/

export function parseAuditOutcome(value: unknown): AuditOutcomeFilter | null {
  return (AUDIT_OUTCOMES as readonly string[]).includes(value as string) ? (value as AuditOutcomeFilter) : null
}

export function parseAuditAction(value: unknown): string | null {
  return typeof value === 'string' && AUDIT_ACTION_PATTERN.test(value) ? value : null
}

/** Accepts YYYY-MM-DD only. Returns the ISO midnight (UTC) or null. */
export function parseIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null
  return date.toISOString()
}

export interface AuditFilterInput {
  outcome: AuditOutcomeFilter | null
  action: string | null
  target: string | null
  /** Inclusive calendar days (YYYY-MM-DD) in the request's time zone. */
  fromDay: string | null
  toDay: string | null
}

export type AuditFilterField = 'outcome' | 'action' | 'target' | 'from' | 'to'

export interface AuditFilterProblem { field: AuditFilterField; expected: string }

/**
 * Validates raw audit query parameters. Absent values, empty strings and the UI's "all"
 * sentinel for outcome mean "no filter"; anything else must match its exact grammar.
 * Returns the first problem with its field so the browser can point at the right control.
 */
export function parseAuditFilters(raw: { outcome?: string | null; action?: string | null; target?: string | null; from?: string | null; to?: string | null }):
  { ok: true; filters: AuditFilterInput } | { ok: false; problem: AuditFilterProblem } {
  const present = (value: string | null | undefined): value is string => typeof value === 'string' && value.trim() !== ''
  const outcomeRaw = present(raw.outcome) && raw.outcome.trim() !== 'all' ? raw.outcome.trim() : null
  const outcome = outcomeRaw ? parseAuditOutcome(outcomeRaw) : null
  if (outcomeRaw && !outcome) return { ok: false, problem: { field: 'outcome', expected: 'one of success, denied or failed' } }

  const actionRaw = present(raw.action) ? raw.action.trim() : null
  const action = actionRaw ? parseAuditAction(actionRaw) : null
  if (actionRaw && !action) return { ok: false, problem: { field: 'action', expected: 'an action name such as user.suspend (lowercase letters, digits, dots and underscores)' } }

  const targetRaw = present(raw.target) ? raw.target.trim() : null
  const target = targetRaw ? (isUuid(targetRaw) ? targetRaw.toLowerCase() : null) : null
  if (targetRaw && !target) return { ok: false, problem: { field: 'target', expected: 'a full account ID (UUID)' } }

  const fromRaw = present(raw.from) ? raw.from.trim() : null
  const fromDay = fromRaw ? (parseIsoDate(fromRaw) ? fromRaw : null) : null
  if (fromRaw && !fromDay) return { ok: false, problem: { field: 'from', expected: 'a calendar date in YYYY-MM-DD form' } }

  const toRaw = present(raw.to) ? raw.to.trim() : null
  const toDay = toRaw ? (parseIsoDate(toRaw) ? toRaw : null) : null
  if (toRaw && !toDay) return { ok: false, problem: { field: 'to', expected: 'a calendar date in YYYY-MM-DD form' } }

  if (fromDay && toDay && fromDay > toDay) return { ok: false, problem: { field: 'to', expected: 'a date on or after the From date' } }

  return { ok: true, filters: { outcome, action, target, fromDay, toDay } }
}

export const AUDIT_FILTER_LABELS: Record<AuditFilterField, string> = { outcome: 'Outcome', action: 'Action', target: 'Target account ID', from: 'From', to: 'To' }

export type AuditSummaryValue = string | number | boolean | null

/**
 * Audit summaries carry only small scalar before/after values. Nested objects, arrays,
 * long strings and keys that could hold a credential are dropped, so a caller cannot
 * smuggle a token, password or request payload into the audit trail.
 */
export function sanitizeAuditSummary(input: Record<string, unknown> | undefined): Record<string, AuditSummaryValue> {
  const output: Record<string, AuditSummaryValue> = {}
  if (!input) return output
  let count = 0
  for (const [rawKey, value] of Object.entries(input)) {
    if (count >= 20) break
    const key = rawKey.toLowerCase()
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) continue
    if (SENSITIVE_KEY.test(key)) continue
    if (value === null) {
      output[key] = null
    } else if (typeof value === 'boolean') {
      output[key] = value
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      output[key] = value
    } else if (typeof value === 'string') {
      output[key] = cleanText(value, 200)
    } else {
      continue
    }
    count += 1
  }
  return output
}

const SENSITIVE_KEY = /token|secret|password|passwd|otp|code|key|cookie|authorization|totp|recovery|url|link|email/i

/** Minimal RFC 4180 CSV cell escaping with a formula-injection guard for spreadsheet users. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.map(csvCell).join(',')]
  for (const row of rows) lines.push(headers.map(header => csvCell(row[header])).join(','))
  return `${lines.join('\r\n')}\r\n`
}

/** Shortens a commit SHA for display. Returns null for anything that is not hex. */
export function shortCommit(sha: unknown): string | null {
  return typeof sha === 'string' && /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : null
}
