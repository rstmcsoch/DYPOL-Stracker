import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../http.js'
import { dayKeyInZone, shiftDayKey } from '../../../src/lib/time-window.js'
import {
  activeUsers, channel, dailySeries, dayKeys, dedupe, delta, evaluateAlert, funnel, paths, percentile, retentionCohorts,
  topBy, totals, VITAL_THRESHOLDS, vitalRating, writeOutcomes, type AlertRule, type EventRow, type Period
} from '../../../src/lib/telemetry/metrics.js'
import { BUILT_IN_FUNNELS, DEFAULT_ALERTS, DEFAULT_WIDGETS, type DataStatus, type ReportName } from '../../../src/lib/telemetry/report-config.js'
import { EVENT_NAMES } from '../../../src/lib/telemetry/taxonomy.js'
import { analyticsSecret, userRef } from '../control-routes/analytics-ingest.js'

export const MAX_ROWS = 50_000
const PAGE = 1000
const COLUMNS = 'id, name, ts, source, route, session_id, user_ref, props, device, browser, referrer_domain, utm_source, utm_medium, utm_campaign, is_test, env, missing_props, dropped_props'

export interface Filters {
  timeZone: string
  env: 'production' | 'preview' | 'all'
  audience: 'all' | 'public' | 'signed_in'
  device: string | null
  route: string | null
  source: string | null
  visitor: 'all' | 'new' | 'returning'
  includeTest: boolean
  compare: boolean
}

export interface Section { status: DataStatus; coverageStart: string | null; note: string }
export interface ReportBody { report: ReportName; period: { from: string; to: string; fromDay: string; toDay: string; prevFrom: string; prevTo: string; timeZone: string }; truncated: boolean; sections: Record<string, Section>; data: Record<string, unknown>; table: Record<string, unknown>[] }

const missingTable = (error: { code?: string; message?: string } | null) => Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? '')))
export const NOT_READY = 'Analytics storage is not set up yet (migration pending).'

/** Page through events in [from, to) with the server-side filters. */
export async function loadEvents(admin: SupabaseClient, from: Date, to: Date, filters: Filters, extra?: (query: never) => never): Promise<{ rows: EventRow[]; truncated: boolean; ready: boolean }> {
  const rows: EventRow[] = []
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    let query = admin.from('analytics_events').select(COLUMNS).gte('ts', from.toISOString()).lt('ts', to.toISOString()).order('ts', { ascending: true }).order('id').range(offset, offset + PAGE - 1)
    if (!filters.includeTest) query = query.eq('is_test', false)
    if (filters.env !== 'all') query = query.eq('env', filters.env)
    if (filters.device) query = query.eq('device', filters.device)
    if (filters.source) query = query.eq('source', filters.source)
    if (filters.route) query = query.eq('route', filters.route)
    if (filters.audience === 'signed_in') query = query.not('user_ref', 'is', null)
    if (filters.audience === 'public') query = query.is('user_ref', null)
    if (extra) query = extra(query as never)
    const { data, error } = await query
    if (missingTable(error)) return { rows: [], truncated: false, ready: false }
    if (error) throw new ApiError(503, 'analytics_unavailable', 'Analytics data could not be loaded. Try again.')
    rows.push(...((data ?? []) as unknown as EventRow[]))
    if (!data || data.length < PAGE) return { rows: dedupe(rows), truncated: false, ready: true }
  }
  return { rows: dedupe(rows), truncated: true, ready: true }
}

export async function coverageStart(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin.from('analytics_events').select('ts').eq('is_test', false).order('ts', { ascending: true }).limit(1).maybeSingle()
  return error || !data ? null : String(data.ts)
}

async function rpc<T>(admin: SupabaseClient, name: string, args: Record<string, unknown> = {}): Promise<T | null> {
  const { data, error } = await admin.rpc(name, args)
  return error ? null : (data as T)
}

async function config<T>(admin: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data, error } = await admin.from('analytics_owner_config').select('value').eq('key', key).maybeSingle()
  return error || !data ? fallback : (data.value as T)
}

/** Visitors first seen within the 90 days before the period count as returning. */
function splitVisitors(current: EventRow[], history: EventRow[], mode: Filters['visitor']): EventRow[] {
  if (mode === 'all') return current
  const key = (row: EventRow) => row.user_ref ?? `s:${row.session_id}`
  const seenBefore = new Set(history.map(key))
  return current.filter(row => (mode === 'returning') === seenBefore.has(key(row)))
}

const live = (coverage: string | null, note = ''): Section => ({ status: coverage ? 'live' : 'unavailable', coverageStart: coverage, note: coverage ? note : 'No events recorded yet.' })

export async function buildReport(admin: SupabaseClient, report: ReportName, period: Period, filters: Filters, params: URLSearchParams, now = new Date()): Promise<ReportBody> {
  const tz = filters.timeZone
  const base: ReportBody = {
    report,
    period: { from: period.from.toISOString(), to: period.to.toISOString(), fromDay: period.fromDay, toDay: period.toDay, prevFrom: period.prevFrom.toISOString(), prevTo: period.prevTo.toISOString(), timeZone: tz },
    truncated: false, sections: {}, data: {}, table: []
  }
  const coverage = await coverageStart(admin)

  if (report === 'realtime') {
    const since = new Date(now.getTime() - 30 * 60_000)
    const { rows, ready } = await loadEvents(admin, since, new Date(now.getTime() + 60_000), filters)
    if (!ready) return { ...base, sections: { realtime: { status: 'unavailable', coverageStart: null, note: NOT_READY } } }
    const five = rows.filter(row => Date.parse(row.ts) >= now.getTime() - 5 * 60_000)
    const visitors = (list: EventRow[]) => new Set(list.map(row => row.user_ref ?? row.session_id)).size
    const recent = [...rows].reverse().slice(0, 50).map(row => ({ ts: row.ts, name: row.name, route: row.route, source: row.source, device: row.device }))
    return { ...base, sections: { realtime: live(coverage, 'Active = at least one event in the window. No simulated visitors.') }, data: {
      active5: visitors(five), active30: visitors(rows), events30: rows.length,
      routes: topBy(rows, row => row.name === 'page_view' ? row.route : null, 10), sources: topBy(rows, row => row.source, 5), recent
    }, table: recent }
  }

  const historyNeeded = filters.visitor !== 'all'
  const loadFrom = new Date(Math.min(filters.compare ? period.prevFrom.getTime() : period.from.getTime(), historyNeeded ? period.from.getTime() - 90 * 86_400_000 : Infinity))
  const loaded = report === 'errors' || report === 'dataops' || report === 'health' || report === 'alerts'
    ? await loadEvents(admin, period.from, period.to, filters)
    : await loadEvents(admin, loadFrom, period.to, filters)
  if (!loaded.ready && report !== 'student' && report !== 'retention' && report !== 'dataops') {
    return { ...base, sections: { main: { status: 'unavailable', coverageStart: null, note: NOT_READY } } }
  }
  const all = loaded.rows
  const inRange = (row: EventRow, from: Date, to: Date) => { const t = Date.parse(row.ts); return t >= from.getTime() && t < to.getTime() }
  const history = all.filter(row => Date.parse(row.ts) < period.from.getTime())
  const cur = splitVisitors(all.filter(row => inRange(row, period.from, period.to)), history, filters.visitor)
  const prev = filters.compare ? all.filter(row => inRange(row, period.prevFrom, period.prevTo)) : []
  base.truncated = loaded.truncated
  const liveSection = live(coverage, loaded.truncated ? `Only the first ${MAX_ROWS.toLocaleString()} events were analysed (Partial).` : '')
  if (loaded.truncated) liveSection.status = 'partial'

  switch (report) {
    case 'overview': {
      const widgets = await config(admin, 'overview.widgets', DEFAULT_WIDGETS)
      const t = totals(cur); const p = totals(prev)
      const writes = (rows: EventRow[]) => rows.filter(row => row.name === 'student_record_write_succeeded').reduce((sum, row) => sum + (Number(row.props.count) || 1), 0)
      const count = (rows: EventRow[], name: string) => rows.filter(row => row.name === name).length
      const lcp = (rows: EventRow[]) => percentile(rows.filter(row => row.name === 'web_vital' && row.props.metric === 'LCP').map(row => Number(row.props.value)), 75)
      const historical = await rpc<{ day: string; feature: string; created: number; users: number }[]>(admin, 'analytics_business_activity', { p_from: period.from.toISOString(), p_to: period.to.toISOString(), p_tz: tz })
      const signups = await rpc<{ created_at: string }[]>(admin, 'analytics_signups', { p_from: period.from.toISOString(), p_to: period.to.toISOString() })
      const kpi = (current: number | null, previous: number | null) => ({ value: current, previous: filters.compare ? previous : null, delta: filters.compare && current !== null && previous !== null ? delta(current, previous) : null })
      return { ...base, sections: { live: liveSection, historical: { status: historical ? 'historical' : 'unavailable', coverageStart: null, note: 'Rows created in student tables (seeded syllabus excluded). Signups from accounts (auth).' } }, data: {
        widgets,
        kpis: {
          visitors: kpi(t.visitors, p.visitors), sessions: kpi(t.sessions, p.sessions), page_views: kpi(t.pageViews, p.pageViews),
          signups_tracked: kpi(count(cur, 'signup_completed'), count(prev, 'signup_completed')),
          signups_accounts: { value: signups ? signups.length : null, previous: null, delta: null },
          writes: kpi(writes(cur), writes(prev)), errors: kpi(count(cur, 'app_error'), count(prev, 'app_error')), lcp_p75: kpi(lcp(cur), lcp(prev))
        },
        traffic: (() => { const visitors = dailySeries(cur, period, tz, row => row.user_ref ?? row.session_id, true); return dailySeries(cur.filter(row => row.name === 'page_view'), period, tz).map((point, index) => ({ ...point, visitors: visitors[index]?.value ?? 0 })) })(),
        writes: dailySeries(cur.filter(row => row.name === 'student_record_write_succeeded'), period, tz),
        topPages: topBy(cur, row => row.name === 'page_view' ? row.route : null, 8),
        channels: topBy(cur.filter(row => row.name === 'session_started'), row => channel(row), 8),
        historical: summarizeHistorical(historical ?? [])
      } }
    }
    case 'traffic': {
      const starts = cur.filter(row => row.name === 'session_started')
      const table = topBy(starts, row => channel(row), 20).map(row => ({ channel: row.key, sessions: row.count, visitors: row.visitors }))
      return { ...base, sections: { main: { ...liveSection, note: 'Counted from session_started. Referrer domain only (no full URLs). Geography is not collected.' } }, data: {
        channels: table, referrers: topBy(starts, row => row.referrer_domain, 20), utmSource: topBy(starts, row => row.utm_source, 20), utmMedium: topBy(starts, row => row.utm_medium, 20), utmCampaign: topBy(starts, row => row.utm_campaign, 20),
        sessionsByDay: dailySeries(starts, period, tz), previousSessions: filters.compare ? prev.filter(row => row.name === 'session_started').length : null
      }, table }
    }
    case 'pages': {
      const views = cur.filter(row => row.name === 'page_view')
      const table = topBy(views, row => row.route, 50).map(row => ({ route: row.key, views: row.count, visitors: row.visitors }))
      const video = ['video_started', 'video_progress_25', 'video_progress_50', 'video_progress_75', 'video_completed', 'video_error'].map(name => ({ key: name, count: cur.filter(row => row.name === name).length }))
      return { ...base, sections: { main: liveSection }, data: {
        pages: table, sections: topBy(cur.filter(row => row.name === 'section_viewed'), row => String(row.props.section ?? ''), 20),
        ctas: topBy(cur.filter(row => row.name === 'cta_clicked'), row => `${String(row.props.cta)} · ${String(row.props.placement)}`, 20), video,
        landing: topBy(cur.filter(row => row.name === 'session_started'), row => row.route, 15)
      }, table }
    }
    case 'audience': {
      const t = totals(cur)
      const seenBefore = new Set(history.map(row => row.user_ref ?? `s:${row.session_id}`))
      const visitors = [...new Set(cur.map(row => row.user_ref ?? `s:${row.session_id}`))]
      const returning = visitors.filter(key => seenBefore.has(key)).length
      const table = topBy(cur, row => row.device, 5).map(row => ({ device: row.key, events: row.count, visitors: row.visitors }))
      return { ...base, sections: { main: { ...liveSection, note: `${liveSection.note} New vs returning compares with the 90 days before the period${historyNeeded ? '' : ' (choose a visitor filter to load that history)'}.`.trim() } }, data: {
        visitors: t.visitors, signedIn: t.signedInUsers, anonymous: t.visitors - t.signedInUsers,
        newVisitors: historyNeeded ? visitors.length - returning : null, returningVisitors: historyNeeded ? returning : null,
        devices: table, browsers: topBy(cur, row => row.browser, 10), sources: topBy(cur, row => row.source, 5)
      }, table }
    }
    case 'funnels': {
      const custom = await config(admin, 'funnels', [] as typeof BUILT_IN_FUNNELS)
      const definitions = [...BUILT_IN_FUNNELS.map(f => ({ ...f, builtIn: true })), ...custom.map(f => ({ ...f, builtIn: false }))]
      const results = definitions.map(def => ({ id: def.id, name: def.name, builtIn: def.builtIn, steps: funnel(cur, def.steps), previous: filters.compare ? funnel(prev, def.steps) : null, definition: def.steps }))
      const table = results.flatMap(result => result.steps.map(step => ({ funnel: result.name, step: step.step, reached: step.count, conversion_pct: step.conversion, from_previous_pct: step.fromPrevious, median_seconds_from_previous: step.medianSecondsFromPrevious })))
      return { ...base, sections: { main: { ...liveSection, note: 'Ordered steps per visitor within the period; anonymous steps in a session join the account that signs in during it.' } }, data: { funnels: results, events: EVENT_NAMES }, table }
    }
    case 'student': {
      const historical = await rpc<{ day: string; feature: string; created: number; users: number }[]>(admin, 'analytics_business_activity', { p_from: period.from.toISOString(), p_to: period.to.toISOString(), p_tz: tz })
      const outcomes = writeOutcomes(cur)
      const table = (historical ?? []).map(row => ({ day: row.day, feature: row.feature, rows_created: row.created, accounts: row.users }))
      return { ...base, sections: {
        historical: { status: historical ? 'historical' : 'unavailable', coverageStart: null, note: 'Rows created per day in student tables (created_at). Edits only show the latest update and deletes leave no trace, so this is a lower bound.' },
        live: loaded.ready ? { ...liveSection, note: 'Save outcomes from the app. Failed or queued saves never count as activity.' } : { status: 'unavailable', coverageStart: null, note: NOT_READY }
      }, data: { historical: summarizeHistorical(historical ?? []), byDay: historicalByDay(historical ?? [], period), outcomes, writesByDay: dailySeries(cur.filter(row => row.name === 'student_record_write_succeeded'), period, tz) }, table }
    }
    case 'adoption': {
      const signedIn = cur.filter(row => row.user_ref)
      const denominator = new Set(signedIn.map(row => row.user_ref)).size
      const opened = topBy(signedIn.filter(row => row.name === 'feature_opened'), row => String(row.props.feature), 40)
      const saved = topBy(signedIn.filter(row => row.name === 'student_record_write_succeeded'), row => String(row.props.feature), 40)
      const historical = await rpc<{ feature: string; users: number }[]>(admin, 'analytics_feature_accounts', { p_from: period.from.toISOString(), p_to: period.to.toISOString() })
      const accounts = await rpc<{ user_id: string }[]>(admin, 'analytics_signups', { p_from: '2000-01-01T00:00:00Z', p_to: now.toISOString() })
      const table = opened.map(row => ({ feature: row.key, opened_by: row.visitors, active_signed_in_users: denominator, adoption_pct: denominator ? Math.round((row.visitors / denominator) * 1000) / 10 : null, saved_by: saved.find(item => item.key === row.key)?.visitors ?? 0 }))
      return { ...base, sections: {
        live: { ...liveSection, note: 'Denominator = signed-in users with any event in the period.' },
        historical: { status: historical && accounts ? 'historical' : 'unavailable', coverageStart: null, note: 'Accounts that created at least one row of each kind in the period ÷ all accounts.' }
      }, data: { denominator, table, historical: historicalAdoption(historical ?? [], accounts?.length ?? 0) }, table }
    }
    case 'retention': {
      const today = dayKeyInZone(now, tz)
      const historyFrom = new Date(now.getTime() - 120 * 86_400_000)
      const historical = await rpc<{ user_id: string; day: string }[]>(admin, 'analytics_business_active_days', { p_from: historyFrom.toISOString(), p_to: now.toISOString(), p_tz: tz })
      const secret = analyticsSecret()
      const activity = new Map<string, { user: string; day: string }>()
      for (const row of historical ?? []) { const user = userRef(row.user_id, secret); activity.set(`${user}|${row.day}`, { user, day: String(row.day) }) }
      if (loaded.ready) {
        const { rows } = await loadEvents(admin, historyFrom, now, { ...filters, audience: 'signed_in' })
        for (const row of rows) { if (!row.user_ref) continue; const day = dayKeyInZone(new Date(row.ts), tz); activity.set(`${row.user_ref}|${day}`, { user: row.user_ref, day }) }
      }
      const list = [...activity.values()]
      const dauSeries = dayKeys(period.fromDay, period.toDay).map(day => ({ day, value: new Set(list.filter(item => item.day === day).map(item => item.user)).size }))
      const cohorts = retentionCohorts(list, today, 8)
      const table = cohorts.map(row => ({ cohort_week: row.cohort, size: row.size, ...Object.fromEntries(row.cells.map((cell, k) => [`week_${k}`, cell])) }))
      return { ...base, sections: { main: { status: historical ? 'partial' : loaded.ready ? 'live' : 'unavailable', coverageStart: coverage, note: 'Active = saved study work (historical tables, last 120 days) or any signed-in event. Historical tables keep only each row’s latest edit, so older activity is undercounted (Partial). Cohort cells for weeks not yet finished are blank, not zero.' } }, data: { ...activeUsers(list, period.toDay < today ? period.toDay : today), dauSeries, cohorts }, table }
    }
    case 'journeys': {
      const pivot = (params.get('pivot') ?? 'signup_started').slice(0, 120)
      const sessionId = params.get('session')
      const sessions = topBy(cur, row => row.session_id, 30).map(row => {
        const events = cur.filter(item => item.session_id === row.key)
        return { session: row.key, events: row.count, start: events[0]?.ts ?? null, source: events[0]?.source ?? null, device: events[0]?.device ?? null, signedIn: events.some(item => item.user_ref) }
      })
      const timeline = sessionId && /^[0-9a-f-]{36}$/i.test(sessionId) ? cur.filter(row => row.session_id === sessionId).map(row => ({ ts: row.ts, name: row.name, route: row.route, detail: Object.entries(row.props).filter(([key]) => key !== 'message' && key !== 'title').map(([key, value]) => `${key}=${String(value)}`).join(' ') })) : []
      return { ...base, sections: { main: { ...liveSection, note: 'Session timelines show event names, routes and allowlisted properties only — never student content or identities.' } }, data: { pivot, ...paths(cur, pivot), sessions, timeline }, table: sessions }
    }
    case 'performance': {
      const vitals = cur.filter(row => row.name === 'web_vital')
      const metrics = Object.keys(VITAL_THRESHOLDS).map(metric => {
        const values = vitals.filter(row => row.props.metric === metric).map(row => Number(row.props.value))
        const p75 = percentile(values, 75)
        const previous = percentile(prev.filter(row => row.name === 'web_vital' && row.props.metric === metric).map(row => Number(row.props.value)), 75)
        return { metric, samples: values.length, p75, previousP75: filters.compare ? previous : null, rating: vitalRating(metric, p75), ...VITAL_THRESHOLDS[metric]!,
          good: values.filter(v => vitalRating(metric, v) === 'good').length, needsImprovement: values.filter(v => vitalRating(metric, v) === 'needs-improvement').length, poor: values.filter(v => vitalRating(metric, v) === 'poor').length }
      })
      const byRoute = topBy(vitals.filter(row => row.props.metric === 'LCP'), row => row.route, 20).map(row => ({ route: row.key, samples: row.count, lcp_p75: percentile(vitals.filter(item => item.props.metric === 'LCP' && item.route === row.key).map(item => Number(item.props.value)), 75) }))
      return { ...base, sections: { main: { ...liveSection, note: 'Real-user measurements from visitors’ browsers (web-vitals). p75 = 75th percentile.' } }, data: { metrics, byRoute }, table: metrics.map(({ metric, samples, p75, rating, good, needsImprovement, poor }) => ({ metric, samples, p75, rating, good, needs_improvement: needsImprovement, poor })) }
    }
    case 'errors': {
      const page = Math.max(1, Number(params.get('page')) || 1)
      const status = params.get('status')
      let query = admin.from('analytics_error_groups').select('*', { count: 'exact' }).order('last_seen', { ascending: false }).range((page - 1) * 25, page * 25 - 1)
      if (status === 'open' || status === 'resolved' || status === 'ignored') query = query.eq('status', status)
      const { data, count, error } = await query
      if (missingTable(error)) return { ...base, sections: { main: { status: 'unavailable', coverageStart: null, note: NOT_READY } } }
      const errors = cur.filter(row => row.name === 'app_error')
      return { ...base, sections: { main: { ...liveSection, note: 'Browser errors, unhandled promise rejections and failed API calls, grouped by fingerprint. Messages are scrubbed of emails, URLs and ids.' } }, data: {
        groups: data ?? [], total: count ?? 0, page, pageSize: 25, byDay: dailySeries(errors, period, tz), byKind: topBy(errors, row => String(row.props.kind), 5)
      }, table: (data ?? []) as Record<string, unknown>[] }
    }
    case 'dataops': {
      const ops = await rpc<{ last_write: Record<string, string> | null; row_counts: Record<string, number> | null }>(admin, 'analytics_data_operations')
      const outcomes = writeOutcomes(cur)
      const lastWrite = ops?.last_write ? Object.values(ops.last_write).sort().at(-1) ?? null : null
      const { data: stats } = await admin.from('analytics_ingest_stats').select('day, kind, detail, count').gte('day', period.fromDay).order('day', { ascending: false }).limit(200)
      return { ...base, sections: {
        historical: { status: ops ? 'historical' : 'unavailable', coverageStart: null, note: 'Latest updated_at per student table, and current row counts.' },
        live: loaded.ready ? liveSection : { status: 'unavailable', coverageStart: null, note: NOT_READY },
        supabase: { status: 'unavailable', coverageStart: null, note: 'Supabase usage, quotas and logs need a Supabase management token, which the deployed app does not have. Check them in the Supabase dashboard.' }
      }, data: { lastStudentWrite: lastWrite, lastWriteByTable: ops?.last_write ?? {}, rowCounts: ops?.row_counts ?? {}, outcomes, ingest: stats ?? [] }, table: outcomes }
    }
    case 'custom': {
      const reports = await config(admin, 'reports', [] as { id: string; name: string; event: string | null; measure: 'events' | 'visitors' | 'sessions'; dimension: string; limit: number }[])
      const id = params.get('id')
      const definition = reports.find(item => item.id === id) ?? null
      let table: Record<string, unknown>[] = []
      if (definition) {
        const rows = definition.event ? cur.filter(row => row.name === definition.event) : cur
        const dim = (row: EventRow): string | null => {
          switch (definition.dimension) {
            case 'day': return dayKeyInZone(new Date(row.ts), tz)
            case 'route': return row.route
            case 'source': return row.source
            case 'device': return row.device
            case 'browser': return row.browser
            case 'channel': return channel(row)
            case 'referrer': return row.referrer_domain
            case 'utm_campaign': return row.utm_campaign
            default: { const value = row.props[definition.dimension]; return value === undefined ? null : String(value) }
          }
        }
        const grouped = new Map<string, { events: number; visitors: Set<string>; sessions: Set<string> }>()
        for (const row of rows) { const key = dim(row); if (key === null) continue; const entry = grouped.get(key) ?? { events: 0, visitors: new Set(), sessions: new Set() }; entry.events += 1; entry.visitors.add(row.user_ref ?? row.session_id); entry.sessions.add(row.session_id); grouped.set(key, entry) }
        table = [...grouped.entries()].map(([key, value]) => ({ [definition.dimension]: key, value: definition.measure === 'events' ? value.events : definition.measure === 'visitors' ? value.visitors.size : value.sessions.size }))
          .sort((a, b) => definition.dimension === 'day' ? String(a.day).localeCompare(String(b.day)) : Number(b.value) - Number(a.value)).slice(0, definition.limit)
      }
      return { ...base, sections: { main: liveSection }, data: { reports, definition }, table }
    }
    case 'alerts': {
      const rules = await config(admin, 'alerts.rules', DEFAULT_ALERTS) as AlertRule[]
      const maxWindow = Math.max(60, ...rules.map(rule => rule.windowMinutes))
      const recent = await loadEvents(admin, new Date(now.getTime() - maxWindow * 60_000), new Date(now.getTime() + 60_000), { ...filters, env: 'production', includeTest: false, audience: 'all', device: null, route: null, source: null })
      const evaluations = rules.map(rule => ({ rule, ...evaluateAlert(rule, recent.rows, now) }))
      for (const item of evaluations) {
        if (!item.breached || item.rule.muted) continue
        // Unique partial index keeps one active alert per rule (dedupe); a conflict just bumps last_seen.
        const { error } = await admin.from('analytics_alert_events').insert({ rule_id: item.rule.id, value: item.value, threshold: item.rule.threshold, message: item.rule.label })
        if (error) await admin.from('analytics_alert_events').update({ last_seen_at: now.toISOString(), value: item.value }).eq('rule_id', item.rule.id).in('status', ['open', 'acknowledged'])
      }
      const { data: events } = await admin.from('analytics_alert_events').select('*').order('triggered_at', { ascending: false }).limit(100)
      return { ...base, sections: { main: { status: recent.ready ? 'live' : 'unavailable', coverageStart: coverage, note: 'Rules are checked whenever this view (or Overview) loads, against production non-test traffic. Delivery is in-app only: no email or push is configured.' } }, data: { rules, evaluations: evaluations.map(({ rule, value, breached }) => ({ id: rule.id, value, breached })), events: events ?? [] }, table: (events ?? []) as Record<string, unknown>[] }
    }
    case 'health': {
      const since = new Date(now.getTime() - 7 * 86_400_000)
      const week = await loadEvents(admin, since, new Date(now.getTime() + 60_000), { ...filters, includeTest: true, env: 'all', audience: 'all', device: null, route: null, source: null })
      const { data: stats } = await admin.from('analytics_ingest_stats').select('day, kind, detail, count').gte('day', shiftDayKey(dayKeyInZone(now, 'UTC'), -7)).order('day', { ascending: false }).limit(200)
      const byName = EVENT_NAMES.map(name => {
        const rows = week.rows.filter(row => row.name === name)
        return { event: name, last7d: rows.length, lastSeen: rows.at(-1)?.ts ?? null, missingProps: rows.filter(row => row.missing_props?.length).length, droppedProps: rows.filter(row => row.dropped_props?.length).length }
      })
      const last = week.rows.at(-1)?.ts ?? null
      const testShare = week.rows.length ? Math.round((week.rows.filter(row => row.is_test).length / week.rows.length) * 1000) / 10 : null
      const sum = (kind: string) => (stats ?? []).filter(row => row.kind === kind).reduce((total, row) => total + Number(row.count), 0)
      return { ...base, sections: { main: { status: week.ready ? (last ? 'live' : 'partial') : 'unavailable', coverageStart: coverage, note: week.ready ? 'Last 7 days, all environments, test traffic included.' : NOT_READY } }, data: {
        lastEvent: last, coverageStart: coverage, eventsLast7d: week.rows.length, testShare,
        unknownEvents: (stats ?? []).filter(row => row.kind === 'unknown_event'), duplicates: sum('duplicate'), invalidBatches: sum('invalid_batch'), rateLimited: sum('rate_limited'),
        byName, reportStatus: REPORT_STATUS
      }, table: byName }
    }
  }
  return base
}

/** Static data-status declaration per Analytics section (shown in Tracking Health). */
export const REPORT_STATUS: { report: string; status: DataStatus; source: string }[] = [
  { report: 'Overview', status: 'live', source: 'Events + historical tables' },
  { report: 'Real-time', status: 'live', source: 'Events (last 30 min)' },
  { report: 'Traffic & Acquisition', status: 'live', source: 'Events (referrer domain, UTM)' },
  { report: 'Pages & Content', status: 'live', source: 'Events' },
  { report: 'Users & Audience', status: 'live', source: 'Events (no geography collected)' },
  { report: 'Funnels', status: 'live', source: 'Events' },
  { report: 'Student Activity', status: 'historical', source: 'Student tables created_at + live save events' },
  { report: 'Feature Adoption', status: 'live', source: 'Events + historical tables' },
  { report: 'Engagement & Retention', status: 'partial', source: 'Student tables (latest edit only) + events' },
  { report: 'Journeys', status: 'live', source: 'Events' },
  { report: 'Performance', status: 'live', source: 'Real-user web vitals' },
  { report: 'Errors', status: 'live', source: 'Client error events' },
  { report: 'Data Operations', status: 'partial', source: 'Student tables + save events; Supabase usage unavailable' },
  { report: 'Admin Audit', status: 'historical', source: 'control_audit_events' },
  { report: 'Custom Reports', status: 'live', source: 'Events' },
  { report: 'Alerts', status: 'live', source: 'Events; in-app only' }
]

function summarizeHistorical(rows: { feature: string; created: number; users: number }[]): { feature: string; created: number }[] {
  const map = new Map<string, number>()
  for (const row of rows) map.set(row.feature, (map.get(row.feature) ?? 0) + Number(row.created))
  return [...map.entries()].map(([feature, created]) => ({ feature, created })).sort((a, b) => b.created - a.created)
}

function historicalByDay(rows: { day: string; created: number }[], period: Period): { day: string; value: number }[] {
  const map = new Map<string, number>()
  for (const row of rows) map.set(String(row.day), (map.get(String(row.day)) ?? 0) + Number(row.created))
  return dayKeys(period.fromDay, period.toDay).map(day => ({ day, value: map.get(day) ?? 0 }))
}

function historicalAdoption(rows: { feature: string; users: number }[], accounts: number): { feature: string; accounts: number; total: number; pct: number | null }[] {
  return rows.map(row => [row.feature, Number(row.users)] as const).map(([feature, users]) => ({ feature, accounts: users, total: accounts, pct: accounts ? Math.round((users / accounts) * 1000) / 10 : null })).sort((a, b) => b.accounts - a.accounts)
}
