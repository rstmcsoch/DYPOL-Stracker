import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError, sendJson } from '../http.js'
import { controlHandler, recordAuditEvent, requireRecentMfa, type ControlContext } from '../control.js'
import { AUDIT_FILTER_LABELS, parseAuditFilters, parsePage, toCsv, type AuditFilterInput } from '../control-policy.js'
import { logAIEvent } from '../diagnostics.js'
import { dayRangeInZone, parseTimeZone, wallClock } from '../../../src/lib/time-window.js'

const EXPORT_LIMIT = 5000
const COLUMNS = ['occurred_at_utc', 'occurred_at_local', 'time_zone', 'action', 'outcome', 'severity', 'actor_id', 'actor_role', 'target_type', 'target_id', 'error_code', 'reason', 'request_id', 'summary'] as const
const DB_COLUMNS = 'id, created_at, action, result, actor_id, actor_role, target_type, target_id, error_category, reason, request_id, before_summary, after_summary'

/** Filters resolved to query instants. `to` is the exclusive start of the day after the To date. */
interface AuditQueryFilters extends AuditFilterInput {
  timeZone: string
  from: string | null
  to: string | null
}

type AuditDbRow = {
  id: string
  created_at: string
  action: string
  result: string
  actor_id: string | null
  actor_role: string | null
  target_type: string | null
  target_id: string | null
  error_category: string | null
  reason: string | null
  request_id: string | null
  before_summary: Record<string, unknown> | null
  after_summary: Record<string, unknown> | null
}

function normalizeAuditRow(row: AuditDbRow): Record<string, unknown> {
  const outcome = row.result === 'error' ? 'failed' : row.result
  return {
    id: row.id,
    occurred_at: row.created_at,
    action: row.action,
    outcome,
    severity: outcome === 'failed' ? 'warning' : outcome === 'denied' ? 'notice' : 'info',
    actor_id: row.actor_id,
    actor_role: row.actor_role,
    target_type: row.target_type,
    target_id: row.target_id,
    error_code: row.error_category,
    reason: row.reason,
    request_id: row.request_id,
    summary: { ...(row.before_summary ?? {}), ...(row.after_summary ?? {}) }
  }
}

/** Apply validated filters to the existing control_audit_events columns. */
function withFilters<Q extends { eq: (column: string, value: string) => Q; gte: (column: string, value: string) => Q; lt: (column: string, value: string) => Q }>(query: Q, filters: AuditQueryFilters): Q {
  let next = query
  if (filters.outcome) next = next.eq('result', filters.outcome === 'failed' ? 'error' : filters.outcome)
  if (filters.action) next = next.eq('action', filters.action)
  if (filters.target) next = next.eq('target_id', filters.target)
  if (filters.from) next = next.gte('created_at', filters.from)
  if (filters.to) next = next.lt('created_at', filters.to)
  return next
}

function isFiltered(filters: AuditQueryFilters): boolean {
  return Boolean(filters.outcome || filters.action || filters.target || filters.from || filters.to)
}

/**
 * Validates the query string. Empty values and outcome=all mean "no filter". An invalid value
 * is answered with the field name and the expected shape; the failure is written to the
 * structured server log (never to the audit table, so a bad filter cannot create audit noise).
 */
function parseFilters(params: URLSearchParams, context: ControlContext): AuditQueryFilters {
  const timeZone = parseTimeZone(params.get('tz'))
  const parsed = parseAuditFilters({ outcome: params.get('outcome'), action: params.get('action'), target: params.get('target'), from: params.get('from'), to: params.get('to') })
  if (!parsed.ok) {
    logAIEvent('warn', 'control_audit_filter_invalid', { requestId: context.requestId, field: parsed.problem.field })
    throw new ApiError(400, 'invalid_filter', `The ${AUDIT_FILTER_LABELS[parsed.problem.field]} filter is not valid. Expected ${parsed.problem.expected}.`, { reason: `field:${parsed.problem.field}` })
  }
  const range = dayRangeInZone(parsed.filters.fromDay, parsed.filters.toDay, timeZone)
  return { ...parsed.filters, timeZone, from: range.from?.toISOString() ?? null, to: range.to?.toISOString() ?? null }
}

function localStamp(iso: string, timeZone: string): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return ''
  const clock = wallClock(time, timeZone)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)} ${pad(clock.hour)}:${pad(clock.minute)}:${pad(clock.second)}`
}

async function exportCsv(context: ControlContext, filters: AuditQueryFilters, res: ApiResponse): Promise<void> {
  await requireRecentMfa(context, { action: 'audit.export', targetType: 'audit_log' })
  const exportSummary = { limit: EXPORT_LIMIT, filtered: isFiltered(filters), zone: filters.timeZone }
  const base = context.admin.from('control_audit_events').select(DB_COLUMNS).order('created_at', { ascending: false }).limit(EXPORT_LIMIT)
  const { data, error } = await withFilters(base, filters)
  if (error) {
    await recordAuditEvent(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action: 'audit.export', targetType: 'audit_log', outcome: 'failed', severity: 'warning', errorCode: 'audit_unavailable', summary: exportSummary })
    throw new ApiError(503, 'audit_unavailable', 'The audit log could not be exported. Try again shortly.')
  }
  const rows = ((data ?? []) as unknown as AuditDbRow[]).map(normalizeAuditRow).map(row => ({
    ...row,
    occurred_at_utc: row.occurred_at,
    occurred_at_local: localStamp(String(row.occurred_at), filters.timeZone),
    time_zone: filters.timeZone
  }))
  const csv = toCsv([...COLUMNS], rows)
  const recorded = await recordAuditEvent(context.admin, {
    requestId: context.requestId,
    actorId: context.userId,
    actorRole: context.role,
    action: 'audit.export',
    targetType: 'audit_log',
    outcome: 'success',
    severity: 'notice',
    summary: { rows: rows.length, truncated: rows.length >= EXPORT_LIMIT, ...exportSummary }
  })
  if (!recorded) throw new ApiError(503, 'audit_unavailable', 'The export was not produced because it could not be recorded in the audit log.')
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Disposition', 'attachment; filename="stracker-control-audit.csv"')
  res.end(csv)
}

/**
 * GET /api/control/audit?outcome=&action=&target=&from=YYYY-MM-DD&to=YYYY-MM-DD&tz=Area/City&page=&pageSize=&format=json|csv
 *
 * `from` and `to` are inclusive calendar days in `tz` (validated IANA zone; defaults to UTC).
 * CSV export requires recent TOTP verification and is itself recorded. Export is refused
 * if the export event cannot be recorded. The database audit table is append-only.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const params = new URL(req.url ?? '/', 'http://localhost').searchParams
  await controlHandler(req, res, ['GET'], { requireAal2: true }, async context => {
    const filters = parseFilters(params, context)
    if (params.get('format') === 'csv') {
      await exportCsv(context, filters, res)
      return
    }
    const { limit, offset, page } = parsePage(params.get('page'), params.get('pageSize'), 50, 100)
    const base = context.admin
      .from('control_audit_events')
      .select(DB_COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    const { data, error, count } = await withFilters(base, filters)
    if (error) throw new ApiError(503, 'audit_unavailable', 'The audit log could not be loaded. Try again shortly.')
    const events = ((data ?? []) as unknown as AuditDbRow[]).map(normalizeAuditRow)
    sendJson(res, 200, {
      events,
      total: count ?? 0,
      page,
      pageSize: limit,
      filters: { outcome: filters.outcome, action: filters.action, target: filters.target, from: filters.fromDay, to: filters.toDay, timeZone: filters.timeZone, since: filters.from, until: filters.to }
    })
  })
}
