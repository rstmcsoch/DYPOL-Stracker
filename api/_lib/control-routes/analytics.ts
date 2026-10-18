import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError, readJson, sendJson } from '../http.js'
import { controlHandler, recordAuditEvent, requireRecentMfa, type ControlContext } from '../control.js'
import { toCsv } from '../control-policy.js'
import { parseTimeZone } from '../../../src/lib/time-window.js'
import { PRESETS, resolvePeriod, type Preset } from '../../../src/lib/telemetry/metrics.js'
import { CONFIG_SCHEMAS, REPORTS, type ConfigKey, type ReportName } from '../../../src/lib/telemetry/report-config.js'
import { buildReport, type Filters } from '../analytics/reports.js'

/**
 * Owner-only Analytics (aal2), server-side aggregation; the browser never touches the
 * analytics tables or a service key.
 *   GET /api/control/analytics?report=…&preset=…&from=&to=&tz=&compare=1&env=&audience=&device=&path=&source=&visitor=&test=1[&format=csv]
 *   PUT /api/control/analytics { kind: 'config', key, value } | { kind: 'error', fingerprint, status, note } | { kind: 'alert', id, status }
 * Saves and CSV exports are audited. Responses are cached per instance for 30s (real-time: never).
 */
const cache = new Map<string, { at: number; body: unknown }>()
const CACHE_MS = 30_000

export function parseFilters(params: URLSearchParams): { report: ReportName; preset: Preset; filters: Filters } {
  const report = (REPORTS as readonly string[]).includes(params.get('report') ?? '') ? params.get('report') as ReportName : 'overview'
  const preset = (PRESETS as readonly string[]).includes(params.get('preset') ?? '') ? params.get('preset') as Preset : '7d'
  const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T => (allowed as readonly string[]).includes(value ?? '') ? value as T : fallback
  const token = (value: string | null, max: number, pattern: RegExp) => value && value.length <= max && pattern.test(value) ? value : null
  return { report, preset, filters: {
    timeZone: params.get('tz') ? parseTimeZone(params.get('tz')) : 'Asia/Kolkata',
    env: pick(params.get('env'), ['production', 'preview', 'all'] as const, 'production'),
    audience: pick(params.get('audience'), ['all', 'public', 'signed_in'] as const, 'all'),
    device: pick(params.get('device'), ['mobile', 'tablet', 'desktop', ''] as const, '') || null,
    route: token(params.get('path'), 120, /^\/[a-z0-9_:/-]*$/i),
    source: pick(params.get('source'), ['public', 'app', 'auth', 'control', ''] as const, '') || null,
    visitor: pick(params.get('visitor'), ['all', 'new', 'returning'] as const, 'all'),
    includeTest: params.get('test') === '1',
    compare: params.get('compare') === '1'
  } }
}

const errorUpdate = z.object({ kind: z.literal('error'), fingerprint: z.string().regex(/^[a-z0-9]{1,64}$/i), status: z.enum(['open', 'resolved', 'ignored']), note: z.string().max(1000) }).strict()
const alertUpdate = z.object({ kind: z.literal('alert'), id: z.string().uuid(), status: z.enum(['acknowledged', 'muted', 'resolved', 'open']) }).strict()
const configUpdate = z.object({ kind: z.literal('config'), key: z.enum(Object.keys(CONFIG_SCHEMAS) as [ConfigKey, ...ConfigKey[]]), value: z.unknown() }).strict()

async function save(req: ApiRequest, res: ApiResponse, context: ControlContext): Promise<void> {
  const body = await readJson(req, 64_000)
  const audit = (action: string, targetId: string, outcome: 'success' | 'failed', summary?: Record<string, string | number | boolean>) =>
    recordAuditEvent(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action, targetType: 'analytics', targetId, outcome, severity: outcome === 'success' ? 'info' : 'warning', summary })
  const now = new Date().toISOString()
  if (body.kind === 'config') {
    const parsed = configUpdate.safeParse(body)
    if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Unknown setting.')
    const value = CONFIG_SCHEMAS[parsed.data.key].safeParse(parsed.data.value)
    if (!value.success) throw new ApiError(400, 'invalid_config', value.error.issues[0]?.message ?? 'Check the definition.')
    const { error } = await context.admin.from('analytics_owner_config').upsert({ key: parsed.data.key, value: value.data, updated_by: context.userId, updated_at: now })
    if (error) { await audit('analytics.config', parsed.data.key, 'failed'); throw new ApiError(503, 'save_failed', 'Not saved. Analytics storage may not be set up yet.') }
    cache.clear()
    sendJson(res, 200, { ok: true, auditRecorded: await audit('analytics.config', parsed.data.key, 'success', { items: Array.isArray(value.data) ? value.data.length : 0 }) })
    return
  }
  if (body.kind === 'error') {
    const parsed = errorUpdate.safeParse(body)
    if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Check the error status and note.')
    const { error } = await context.admin.from('analytics_error_groups').update({ status: parsed.data.status, note: parsed.data.note.trim(), updated_by: context.userId, updated_at: now }).eq('fingerprint', parsed.data.fingerprint)
    if (error) { await audit('analytics.error_update', parsed.data.fingerprint, 'failed'); throw new ApiError(503, 'save_failed', 'Not saved.') }
    cache.clear()
    sendJson(res, 200, { ok: true, auditRecorded: await audit('analytics.error_update', parsed.data.fingerprint, 'success', { status: parsed.data.status }) })
    return
  }
  const parsed = alertUpdate.safeParse(body)
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Check the alert update.')
  const { error } = await context.admin.from('analytics_alert_events').update({ status: parsed.data.status, updated_by: context.userId, updated_at: now }).eq('id', parsed.data.id)
  if (error) { await audit('analytics.alert_update', parsed.data.id, 'failed'); throw new ApiError(503, 'save_failed', 'Not saved (another alert for this rule may already be active).') }
  cache.clear()
  sendJson(res, 200, { ok: true, auditRecorded: await audit('analytics.alert_update', parsed.data.id, 'success', { status: parsed.data.status }) })
}

/** Roll up and prune at most once a day, piggy-backing on owner views (no cron on Hobby). */
async function maintain(context: ControlContext): Promise<void> {
  const { data } = await context.admin.from('analytics_owner_config').select('value').eq('key', 'maintenance.last_run').maybeSingle()
  const last = typeof data?.value === 'string' ? Date.parse(data.value) : 0
  if (Date.now() - last < 86_400_000) return
  const { error } = await context.admin.rpc('analytics_rollup_and_prune')
  if (!error) await context.admin.from('analytics_owner_config').upsert({ key: 'maintenance.last_run', value: new Date().toISOString(), updated_at: new Date().toISOString() })
}

export async function analyticsHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET', 'PUT'], { requireAal2: true }, async context => {
    if (req.method === 'PUT') { await save(req, res, context); return }
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams
    const { report, preset, filters } = parseFilters(params)
    const period = resolvePeriod(preset, new Date(), filters.timeZone, { from: params.get('from'), to: params.get('to') })
    const csv = params.get('format') === 'csv'
    if (csv) await requireRecentMfa(context, { action: 'analytics.export', targetType: 'analytics' })
    const key = [...params.entries()].filter(([name]) => name !== 'format').sort().map(([a, b]) => `${a}=${b}`).join('&')
    const hit = cache.get(key)
    let body = report !== 'realtime' && report !== 'alerts' && !csv && hit && Date.now() - hit.at < CACHE_MS ? hit.body as Awaited<ReturnType<typeof buildReport>> : null
    if (!body) {
      if (report === 'overview' || report === 'health') await maintain(context).catch(() => undefined)
      body = await buildReport(context.admin, report, period, filters, params)
      if (cache.size > 200) cache.clear()
      cache.set(key, { at: Date.now(), body })
    }
    if (!csv) { sendJson(res, 200, { ok: true, generatedAt: new Date().toISOString(), filters, preset, ...body }); return }
    const rows = body.table
    const headers = [...new Set(rows.flatMap(row => Object.keys(row)))]
    const recorded = await recordAuditEvent(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action: 'analytics.export', targetType: 'analytics', targetId: report, outcome: 'success', severity: 'notice', summary: { rows: rows.length, preset, zone: filters.timeZone } })
    if (!recorded) throw new ApiError(503, 'audit_unavailable', 'The export was not produced because it could not be recorded in the audit log.')
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', `attachment; filename="stracker-analytics-${report}-${period.fromDay}-to-${period.toDay}.csv"`)
    res.end(toCsv(headers, rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v !== null && typeof v === 'object' ? JSON.stringify(v) : v])))))
  })
}
