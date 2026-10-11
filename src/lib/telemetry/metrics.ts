/**
 * Pure metric math for the Control Center Analytics tab. Runs on the server (aggregation
 * endpoint) and in tests. Every function takes already-filtered, de-duplicated event rows.
 */
import { dayKeyInZone, isDayKey, shiftDayKey, startOfDayInZone } from '../time-window.js'

export interface EventRow {
  id: string
  name: string
  ts: string
  source: string
  route: string
  session_id: string
  user_ref: string | null
  props: Record<string, unknown>
  device: string | null
  browser: string | null
  referrer_domain: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  is_test: boolean
  env: string
  missing_props?: string[]
  dropped_props?: string[]
}

export const PRESETS = ['today', 'yesterday', '7d', '28d', '30d', '90d', 'custom'] as const
export type Preset = (typeof PRESETS)[number]

export interface Period { from: Date; to: Date; prevFrom: Date; prevTo: Date; fromDay: string; toDay: string; days: number }

/**
 * Whole local days, half-open [from, to). The comparison period is the same number of days
 * immediately before. Custom ranges are inclusive day keys, at most 400 days.
 */
export function resolvePeriod(preset: Preset, now: Date, timeZone: string, custom?: { from?: string | null; to?: string | null }): Period {
  const today = dayKeyInZone(now, timeZone)
  let fromDay = today
  let toDay = today
  if (preset === 'yesterday') { fromDay = shiftDayKey(today, -1); toDay = fromDay }
  else if (preset === 'custom' && isDayKey(custom?.from) && isDayKey(custom?.to) && custom.from <= custom.to) { fromDay = custom.from; toDay = custom.to }
  else if (preset !== 'today' && preset !== 'custom') fromDay = shiftDayKey(today, -(Number.parseInt(preset, 10) - 1))
  let days = Math.round((startOfDayInZone(shiftDayKey(toDay, 1), timeZone).getTime() - startOfDayInZone(fromDay, timeZone).getTime()) / 86_400_000)
  if (days > 400) { fromDay = shiftDayKey(toDay, -399); days = 400 }
  const from = startOfDayInZone(fromDay, timeZone)
  const to = startOfDayInZone(shiftDayKey(toDay, 1), timeZone)
  const prevFrom = startOfDayInZone(shiftDayKey(fromDay, -days), timeZone)
  return { from, to, prevFrom, prevTo: from, fromDay, toDay, days }
}

/** Every local day key in [fromDay, toDay]. */
export function dayKeys(fromDay: string, toDay: string): string[] {
  const out: string[] = []
  for (let day = fromDay; day <= toDay && out.length < 400; day = shiftDayKey(day, 1)) out.push(day)
  return out
}

/** Change vs previous period; null when the previous value is 0 (no meaningful %). */
export function delta(current: number, previous: number): { abs: number; pct: number | null } {
  return { abs: current - previous, pct: previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10 }
}

export function dedupe(rows: EventRow[]): EventRow[] {
  const seen = new Set<string>()
  return rows.filter(row => (seen.has(row.id) ? false : (seen.add(row.id), true)))
}

const visitorKey = (row: EventRow) => row.user_ref ?? `s:${row.session_id}`

export interface Totals { events: number; pageViews: number; sessions: number; visitors: number; signedInUsers: number; bounceRate: number | null; pagesPerSession: number | null }

export function totals(rows: EventRow[]): Totals {
  const sessions = new Map<string, number>()
  let pageViews = 0
  for (const row of rows) {
    if (row.name === 'page_view') { pageViews += 1; sessions.set(row.session_id, (sessions.get(row.session_id) ?? 0) + 1) }
    else if (!sessions.has(row.session_id)) sessions.set(row.session_id, 0)
  }
  const withViews = [...sessions.values()].filter(count => count > 0)
  return {
    events: rows.length,
    pageViews,
    sessions: sessions.size,
    visitors: new Set(rows.map(visitorKey)).size,
    signedInUsers: new Set(rows.filter(row => row.user_ref).map(row => row.user_ref)).size,
    bounceRate: withViews.length ? Math.round((withViews.filter(count => count === 1).length / withViews.length) * 1000) / 10 : null,
    pagesPerSession: withViews.length ? Math.round((pageViews / withViews.length) * 100) / 100 : null
  }
}

/** Count per local day (zero-filled — days inside the window with no events really had none). */
export function dailySeries(rows: EventRow[], period: Period, timeZone: string, pick: (row: EventRow) => string | null = row => row.id, distinct = false): { day: string; value: number }[] {
  const buckets = new Map<string, Set<string> | number>()
  for (const row of rows) {
    const key = pick(row)
    if (key === null) continue
    const day = dayKeyInZone(new Date(row.ts), timeZone)
    if (distinct) { const set = (buckets.get(day) as Set<string> | undefined) ?? new Set<string>(); set.add(key); buckets.set(day, set) }
    else buckets.set(day, ((buckets.get(day) as number | undefined) ?? 0) + 1)
  }
  return dayKeys(period.fromDay, period.toDay).map(day => {
    const value = buckets.get(day)
    return { day, value: value instanceof Set ? value.size : value ?? 0 }
  })
}

export function topBy(rows: EventRow[], key: (row: EventRow) => string | null, limit = 20): { key: string; count: number; visitors: number }[] {
  const map = new Map<string, { count: number; visitors: Set<string> }>()
  for (const row of rows) {
    const value = key(row)
    if (value === null) continue
    const entry = map.get(value) ?? { count: 0, visitors: new Set<string>() }
    entry.count += 1
    entry.visitors.add(visitorKey(row))
    map.set(value, entry)
  }
  return [...map.entries()].map(([k, v]) => ({ key: k, count: v.count, visitors: v.visitors.size })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, limit)
}

/** Acquisition channel from referrer + UTM. */
export function channel(row: Pick<EventRow, 'referrer_domain' | 'utm_medium' | 'utm_source'>): string {
  const medium = row.utm_medium?.toLowerCase() ?? ''
  if (/cpc|paid|ppc/.test(medium)) return 'Paid'
  if (/email|newsletter/.test(medium)) return 'Email'
  if (row.utm_source || medium) return 'Campaign'
  const ref = row.referrer_domain ?? ''
  if (!ref) return 'Direct'
  if (/google\.|bing\.|duckduckgo\.|yahoo\.|yandex\.|ecosia\./.test(ref)) return 'Organic search'
  if (/facebook|instagram|t\.co$|twitter|x\.com|linkedin|youtube|reddit|whatsapp|telegram|threads/.test(ref)) return 'Social'
  return 'Referral'
}

export interface FunnelStep { name: string; match?: { prop: string; value: string } }
export interface FunnelResult { step: string; count: number; conversion: number | null; fromPrevious: number | null; medianSecondsFromPrevious: number | null }

const matches = (row: EventRow, step: FunnelStep) => row.name === step.name && (!step.match || (step.match.prop === 'route' ? row.route : step.match.prop === 'source' ? row.source : String(row.props?.[step.match.prop] ?? '')) === step.match.value)

/**
 * Ordered funnel per visitor (signed-in ref, else session): a visitor reaches step N only
 * after reaching step N-1 at or before that time, within the window. Medians use the time
 * between consecutive first-reach timestamps.
 */
export function funnel(rows: EventRow[], steps: FunnelStep[]): FunnelResult[] {
  const sorted = [...rows].sort((a, b) => a.ts.localeCompare(b.ts))
  const byVisitor = new Map<string, EventRow[]>()
  for (const row of sorted) { const key = visitorKey(row); const list = byVisitor.get(key) ?? []; list.push(row); byVisitor.set(key, list) }
  // A session's anonymous events belong to the account that later signs in during it.
  const sessionOwner = new Map<string, string>()
  for (const row of sorted) if (row.user_ref && !sessionOwner.has(row.session_id)) sessionOwner.set(row.session_id, row.user_ref)
  const merged = new Map<string, EventRow[]>()
  for (const row of sorted) {
    const key = row.user_ref ?? sessionOwner.get(row.session_id) ?? `s:${row.session_id}`
    const list = merged.get(key) ?? []; list.push(row); merged.set(key, list)
  }
  const reached = steps.map(() => 0)
  const gaps: number[][] = steps.map(() => [])
  for (const events of merged.values()) {
    let at: number | null = null
    for (const [index, step] of steps.entries()) {
      const hit = events.find(row => matches(row, step) && (at === null || Date.parse(row.ts) >= at))
      if (!hit) break
      const time = Date.parse(hit.ts)
      if (at !== null) gaps[index]!.push((time - at) / 1000)
      at = time
      reached[index]! += 1
    }
  }
  return steps.map((step, index) => ({
    step: step.match ? `${step.name} (${step.match.prop}=${step.match.value})` : step.name,
    count: reached[index]!,
    conversion: reached[0] ? Math.round((reached[index]! / reached[0]) * 1000) / 10 : null,
    fromPrevious: index === 0 ? null : reached[index - 1] ? Math.round((reached[index]! / reached[index - 1]!) * 1000) / 10 : null,
    medianSecondsFromPrevious: index === 0 ? null : median(gaps[index]!)
  }))
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** Nearest-rank percentile (p in 0..100). */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!
}

export const VITAL_THRESHOLDS: Record<string, { good: number; poor: number; unit: string }> = {
  LCP: { good: 2500, poor: 4000, unit: 'ms' },
  INP: { good: 200, poor: 500, unit: 'ms' },
  CLS: { good: 0.1, poor: 0.25, unit: '' },
  FCP: { good: 1800, poor: 3000, unit: 'ms' },
  TTFB: { good: 800, poor: 1800, unit: 'ms' }
}

export function vitalRating(metric: string, value: number | null): 'good' | 'needs-improvement' | 'poor' | null {
  const threshold = VITAL_THRESHOLDS[metric]
  if (!threshold || value === null) return null
  return value <= threshold.good ? 'good' : value <= threshold.poor ? 'needs-improvement' : 'poor'
}

/**
 * Weekly retention cohorts. Cohort = week (Mon-start, local) of a user's first activity day;
 * cell k = share of the cohort active in week k. A cell whose week has not fully ended by
 * `today` is immature and returned as null (shown blank, never as 0).
 */
export function retentionCohorts(activity: { user: string; day: string }[], today: string, weeks = 8): { cohort: string; size: number; cells: (number | null)[] }[] {
  const weekStart = (day: string) => { const date = new Date(`${day}T00:00:00Z`); const dow = (date.getUTCDay() + 6) % 7; return shiftDayKey(day, -dow) }
  const first = new Map<string, string>()
  const activeWeeks = new Map<string, Set<string>>()
  for (const { user, day } of activity) {
    if (!first.has(user) || day < first.get(user)!) first.set(user, day)
    const set = activeWeeks.get(user) ?? new Set<string>(); set.add(weekStart(day)); activeWeeks.set(user, set)
  }
  const cohorts = new Map<string, string[]>()
  for (const [user, day] of first) { const week = weekStart(day); const list = cohorts.get(week) ?? []; list.push(user); cohorts.set(week, list) }
  return [...cohorts.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, weeks).map(([cohort, users]) => ({
    cohort,
    size: users.length,
    cells: Array.from({ length: weeks }, (_, k) => {
      const week = shiftDayKey(cohort, k * 7)
      if (shiftDayKey(week, 6) >= today) return k === 0 ? 100 : null // week 0 is by definition 100%
      const active = users.filter(user => activeWeeks.get(user)?.has(week)).length
      return Math.round((active / users.length) * 1000) / 10
    })
  }))
}

/** DAU/WAU/MAU ending at `today` (inclusive), plus stickiness DAU/MAU. */
export function activeUsers(activity: { user: string; day: string }[], today: string): { dau: number; wau: number; mau: number; stickiness: number | null } {
  const within = (days: number) => new Set(activity.filter(item => item.day <= today && item.day > shiftDayKey(today, -days)).map(item => item.user)).size
  const dau = within(1); const wau = within(7); const mau = within(30)
  return { dau, wau, mau, stickiness: mau ? Math.round((dau / mau) * 1000) / 10 : null }
}

/** Next/previous event names around a pivot event, within the same session. */
export function paths(rows: EventRow[], pivot: string, limit = 10): { before: { key: string; count: number }[]; after: { key: string; count: number }[] } {
  const sessions = new Map<string, EventRow[]>()
  for (const row of [...rows].sort((a, b) => a.ts.localeCompare(b.ts))) { const list = sessions.get(row.session_id) ?? []; list.push(row); sessions.set(row.session_id, list) }
  const before = new Map<string, number>(); const after = new Map<string, number>()
  const label = (row: EventRow) => row.name === 'page_view' ? `page_view ${row.route}` : row.name
  for (const list of sessions.values()) {
    list.forEach((row, index) => {
      if (label(row) !== pivot && row.name !== pivot) return
      const prev = list[index - 1]; const next = list[index + 1]
      before.set(prev ? label(prev) : '(session start)', (before.get(prev ? label(prev) : '(session start)') ?? 0) + 1)
      after.set(next ? label(next) : '(session end)', (after.get(next ? label(next) : '(session end)') ?? 0) + 1)
    })
  }
  const top = (map: Map<string, number>) => [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, limit)
  return { before: top(before), after: top(after) }
}

/** Successful writes only; a failed or merely attempted write is never counted as activity. */
export function writeOutcomes(rows: EventRow[]): { feature: string; op: string; succeeded: number; failed: number; attempted: number; failureRate: number | null }[] {
  const map = new Map<string, { succeeded: number; failed: number; attempted: number }>()
  for (const row of rows) {
    const match = /^student_record_write_(attempted|succeeded|failed)$/.exec(row.name)
    if (!match) continue
    const key = `${String(row.props.feature ?? 'other')}|${String(row.props.op ?? 'update')}`
    const entry = map.get(key) ?? { succeeded: 0, failed: 0, attempted: 0 }
    entry[match[1] as 'attempted' | 'succeeded' | 'failed'] += Number(row.props.count ?? 1) || 1
    map.set(key, entry)
  }
  return [...map.entries()].map(([key, value]) => {
    const [feature, op] = key.split('|') as [string, string]
    const finished = value.succeeded + value.failed
    return { feature, op, ...value, failureRate: finished ? Math.round((value.failed / finished) * 1000) / 10 : null }
  }).sort((a, b) => b.succeeded - a.succeeded)
}

/** Alert rule evaluation: returns the metric value and whether it breaches. */
export interface AlertRule { id: string; label: string; metric: 'errors' | 'write_failures' | 'page_views' | 'signups' | 'poor_lcp_share' | 'no_events_minutes'; comparator: 'above' | 'below'; threshold: number; windowMinutes: number; muted?: boolean }

export function evaluateAlert(rule: AlertRule, rows: EventRow[], now: Date): { value: number; breached: boolean } {
  const since = now.getTime() - rule.windowMinutes * 60_000
  const recent = rows.filter(row => Date.parse(row.ts) >= since)
  let value = 0
  if (rule.metric === 'errors') value = recent.filter(row => row.name === 'app_error').length
  else if (rule.metric === 'write_failures') value = recent.filter(row => row.name === 'student_record_write_failed').length
  else if (rule.metric === 'page_views') value = recent.filter(row => row.name === 'page_view').length
  else if (rule.metric === 'signups') value = recent.filter(row => row.name === 'signup_completed').length
  else if (rule.metric === 'poor_lcp_share') { const lcp = recent.filter(row => row.name === 'web_vital' && row.props.metric === 'LCP'); value = lcp.length ? Math.round((lcp.filter(row => row.props.rating === 'poor').length / lcp.length) * 100) : 0 }
  else { const last = rows.reduce((max, row) => Math.max(max, Date.parse(row.ts)), 0); value = last ? Math.round((now.getTime() - last) / 60_000) : rule.windowMinutes }
  return { value, breached: rule.comparator === 'above' ? value > rule.threshold : value < rule.threshold }
}
