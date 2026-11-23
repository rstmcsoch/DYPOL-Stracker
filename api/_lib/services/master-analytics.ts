import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../http.js'
import { toCsv } from '../control-policy.js'
import { isValidTimeZone, parseTimeZone } from '../../../src/lib/time-window.js'
import { PRESETS, resolvePeriod, type Preset } from '../../../src/lib/telemetry/metrics.js'
import { CONFIG_SCHEMAS, REPORTS, type ConfigKey, type ReportName } from '../../../src/lib/telemetry/report-config.js'
import { buildReport, type Filters, type ReportBody } from '../analytics/reports.js'

const DEFAULT_ZONE = 'Asia/Kolkata'

export function resolveReportingTimeZone(value: unknown): string {
  if (value == null || value === '') return DEFAULT_ZONE
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_request', 'Use a valid IANA time zone such as Asia/Kolkata.')
  const raw = value.trim()
  if (raw === 'Asia/Calcutta') return isValidTimeZone('Asia/Calcutta') ? 'Asia/Calcutta' : DEFAULT_ZONE
  if (raw === 'Asia/Kolkata') return DEFAULT_ZONE
  if (isValidTimeZone(raw)) return raw
  if (parseTimeZone(raw) === raw) return raw
  throw new ApiError(400, 'invalid_request', 'Use a valid IANA time zone such as Asia/Kolkata.')
}

const filterInput = z.object({
  report: z.enum(REPORTS).optional(),
  preset: z.enum(PRESETS).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  timeZone: z.string().max(80).optional(),
  tz: z.string().max(80).optional(),
  compare: z.boolean().optional(),
  env: z.enum(['production', 'preview', 'all']).optional(),
  audience: z.enum(['all', 'public', 'signed_in']).optional(),
  device: z.enum(['mobile', 'tablet', 'desktop']).optional(),
  path: z.string().max(120).optional(),
  source: z.enum(['public', 'app', 'auth', 'control']).optional(),
  visitor: z.enum(['all', 'new', 'returning']).optional(),
  includeTest: z.boolean().optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  status: z.string().max(40).optional()
}).strict()

export function parseAnalyticsArgs(input: unknown): { report: ReportName; preset: Preset; filters: Filters; period: ReturnType<typeof resolvePeriod>; params: URLSearchParams } {
  const parsed = filterInput.safeParse(input ?? {})
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Check the analytics filters and date range.')
  const report = parsed.data.report ?? 'overview'
  const preset = parsed.data.preset ?? '7d'
  if (preset === 'custom' && (!parsed.data.from || !parsed.data.to)) {
    throw new ApiError(400, 'invalid_request', 'A custom range needs both from and to dates.')
  }
  const timeZone = resolveReportingTimeZone(parsed.data.timeZone ?? parsed.data.tz)
  const route = parsed.data.path && /^\/[a-z0-9_:/-]*$/i.test(parsed.data.path) ? parsed.data.path : null
  const filters: Filters = {
    timeZone,
    env: parsed.data.env ?? 'production',
    audience: parsed.data.audience ?? 'all',
    device: parsed.data.device ?? null,
    route,
    source: parsed.data.source ?? null,
    visitor: parsed.data.visitor ?? 'all',
    includeTest: parsed.data.includeTest === true,
    compare: parsed.data.compare === true
  }
  const period = resolvePeriod(preset, new Date(), timeZone, { from: parsed.data.from, to: parsed.data.to })
  const params = new URLSearchParams()
  if (parsed.data.page) params.set('page', String(parsed.data.page))
  if (parsed.data.status) params.set('status', parsed.data.status)
  return { report, preset, filters, period, params }
}

function dataAvailability(body: ReportBody): { zero: boolean; missing: boolean; unavailable: boolean } {
  const statuses = Object.values(body.sections).map(section => section.status)
  return {
    zero: body.table.length === 0 && statuses.every(status => status !== 'unavailable'),
    missing: statuses.some(status => status === 'partial'),
    unavailable: statuses.length > 0 && statuses.every(status => status === 'unavailable') || statuses.some(status => status === 'unavailable')
  }
}

function annotate(body: ReportBody, preset: Preset) {
  const availability = dataAvailability(body)
  return {
    ...body,
    preset,
    availability,
    note: availability.unavailable
      ? 'Some or all of this report is unavailable. Missing data is not shown as zero.'
      : availability.zero
        ? 'The report ran successfully and found no matching rows in this period (zero, not missing).'
        : undefined
  }
}

export async function getAnalyticsReport(admin: SupabaseClient, input: unknown, report?: ReportName) {
  const args = parseAnalyticsArgs(report ? { ...(typeof input === 'object' && input ? input : {}), report } : input)
  const body = await buildReport(admin, args.report, args.period, args.filters, args.params)
  return annotate(body, args.preset)
}

export async function getAccountAnalytics(admin: SupabaseClient, input: unknown) {
  const base = typeof input === 'object' && input ? { ...input as Record<string, unknown> } : {}
  delete base.report
  const [overview, retention] = await Promise.all([
    getAnalyticsReport(admin, base, 'overview'),
    getAnalyticsReport(admin, base, 'retention')
  ])
  const kpis = (overview.data.kpis ?? {}) as Record<string, unknown>
  return {
    timeZone: overview.period.timeZone,
    period: overview.period,
    preset: overview.preset,
    availability: {
      overview: overview.availability,
      retention: retention.availability
    },
    accounts: {
      signupsInPeriod: kpis.signups_accounts ?? { value: null, previous: null, delta: null },
      signupsTracked: kpis.signups_tracked ?? { value: null, previous: null, delta: null },
      note: 'Registration counts come from accounts (auth) when that feed is available. Active-account and cohort figures are in the retention report. Unavailable feeds are labelled, not invented.'
    },
    retention: retention.data,
    sections: { overview: overview.sections, retention: retention.sections }
  }
}

export async function exportAnalyticsReport(admin: SupabaseClient, input: unknown) {
  const args = parseAnalyticsArgs(input)
  const body = await buildReport(admin, args.report, args.period, args.filters, args.params)
  const annotated = annotate(body, args.preset)
  const rows = body.table
  const headers = [...new Set(rows.flatMap(row => Object.keys(row)))]
  const csv = headers.length ? toCsv(headers, rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value !== null && typeof value === 'object' ? JSON.stringify(value) : value])))) : ''
  return {
    ok: true,
    report: args.report,
    preset: args.preset,
    timeZone: args.filters.timeZone,
    period: body.period,
    rowCount: rows.length,
    availability: annotated.availability,
    filename: `stracker-analytics-${args.report}-${body.period.fromDay}-to-${body.period.toDay}.csv`,
    csv,
    note: 'This export does not include passwords, credentials or audit-log rewrites. Historical audit records are not deleted or changed.'
  }
}

export async function updateErrorGroup(admin: SupabaseClient, input: unknown) {
  const parsed = z.object({
    fingerprint: z.string().regex(/^[a-z0-9]{1,64}$/i),
    status: z.enum(['open', 'resolved', 'ignored']),
    note: z.string().max(1000)
  }).strict().safeParse(input ?? {})
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Check the error status and note.')
  const now = new Date().toISOString()
  const { data, error } = await admin.from('analytics_error_groups').update({
    status: parsed.data.status,
    note: parsed.data.note.trim(),
    updated_by: null,
    updated_at: now
  }).eq('fingerprint', parsed.data.fingerprint).select('fingerprint')
  if (error) throw new ApiError(503, 'save_failed', 'The error group was not updated. Nothing changed.')
  if (!data?.length) throw new ApiError(404, 'not_found', 'That error group was not found.')
  return { ok: true, fingerprint: parsed.data.fingerprint, status: parsed.data.status }
}

export async function updateAnalyticsAlert(admin: SupabaseClient, input: unknown) {
  const parsed = z.object({
    id: z.uuid(),
    status: z.enum(['acknowledged', 'muted', 'resolved', 'open'])
  }).strict().safeParse(input ?? {})
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Check the alert update.')
  const { data, error } = await admin.from('analytics_alert_events').update({
    status: parsed.data.status,
    updated_by: null,
    updated_at: new Date().toISOString()
  }).eq('id', parsed.data.id).select('id')
  if (error) throw new ApiError(503, 'save_failed', 'The alert was not updated. Nothing changed.')
  if (!data?.length) throw new ApiError(404, 'not_found', 'That alert was not found.')
  return { ok: true, id: parsed.data.id, status: parsed.data.status }
}

export async function updateAnalyticsConfiguration(admin: SupabaseClient, input: unknown) {
  const parsed = z.object({
    key: z.enum(Object.keys(CONFIG_SCHEMAS) as [ConfigKey, ...ConfigKey[]]),
    value: z.unknown()
  }).strict().safeParse(input ?? {})
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Unknown setting.')
  const value = CONFIG_SCHEMAS[parsed.data.key].safeParse(parsed.data.value)
  if (!value.success) throw new ApiError(400, 'invalid_config', value.error.issues[0]?.message ?? 'Check the definition.')
  const { error } = await admin.from('analytics_owner_config').upsert({
    key: parsed.data.key,
    value: value.data,
    updated_by: null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' })
  if (error) throw new ApiError(503, 'save_failed', 'The configuration was not saved. Nothing changed.')
  return { ok: true, key: parsed.data.key, items: Array.isArray(value.data) ? value.data.length : 0 }
}
