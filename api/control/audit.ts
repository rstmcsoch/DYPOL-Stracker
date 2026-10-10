import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { ApiError, sendJson } from '../_lib/http.js'
import { controlHandler, recordAuditEvent, requireRecentMfa, type ControlContext } from '../_lib/control.js'
import { isUuid, parseAuditAction, parseAuditOutcome, parseIsoDate, parsePage, toCsv } from '../_lib/control-policy.js'

const EXPORT_LIMIT = 5000
const COLUMNS = ['occurred_at', 'action', 'outcome', 'severity', 'actor_id', 'actor_role', 'target_type', 'target_id', 'error_code', 'reason', 'request_id', 'summary'] as const
const DB_COLUMNS = 'id, created_at, action, result, actor_id, actor_role, target_type, target_id, error_category, reason, request_id, before_summary, after_summary'

interface AuditFilters {
  outcome: string | null
  action: string | null
  target: string | null
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
function withFilters<Q extends { eq: (column: string, value: string) => Q; gte: (column: string, value: string) => Q; lt: (column: string, value: string) => Q }>(query: Q, filters: AuditFilters): Q {
  let next = query
  if (filters.outcome) next = next.eq('result', filters.outcome === 'failed' ? 'error' : filters.outcome)
  if (filters.action) next = next.eq('action', filters.action)
  if (filters.target) next = next.eq('target_id', filters.target)
  if (filters.from) next = next.gte('created_at', filters.from)
  if (filters.to) next = next.lt('created_at', filters.to)
  return next
}

function parseFilters(params: URLSearchParams): AuditFilters {
  const rawOutcome = params.get('outcome')
  const rawAction = params.get('action')
  const rawTarget = params.get('target')
  const rawFrom = params.get('from')
  const rawTo = params.get('to')
  const outcome = rawOutcome ? parseAuditOutcome(rawOutcome) : null
  const action = rawAction ? parseAuditAction(rawAction) : null
  const target = rawTarget ? (isUuid(rawTarget) ? rawTarget.toLowerCase() : null) : null
  const from = rawFrom ? parseIsoDate(rawFrom) : null
  const toDay = rawTo ? parseIsoDate(rawTo) : null
  if ((rawOutcome && !outcome) || (rawAction && !action) || (rawTarget && !target) || (rawFrom && !from) || (rawTo && !toDay)) {
    throw new ApiError(400, 'invalid_filter', 'One of the audit filters is not valid.')
  }
  // "to" includes the entire specified UTC day.
  const to = toDay ? new Date(Date.parse(toDay) + 24 * 60 * 60 * 1000).toISOString() : null
  return { outcome, action, target, from, to }
}

async function exportCsv(context: ControlContext, filters: AuditFilters, res: ApiResponse): Promise<void> {
  requireRecentMfa(context)
  const base = context.admin.from('control_audit_events').select(DB_COLUMNS).order('created_at', { ascending: false }).limit(EXPORT_LIMIT)
  const { data, error } = await withFilters(base, filters)
  if (error) throw new ApiError(503, 'audit_unavailable', 'The audit log could not be exported. Try again shortly.')
  const rows = ((data ?? []) as unknown as AuditDbRow[]).map(normalizeAuditRow)
  const csv = toCsv([...COLUMNS], rows)
  const recorded = await recordAuditEvent(context.admin, {
    requestId: context.requestId,
    actorId: context.userId,
    actorRole: context.role,
    action: 'audit.export',
    targetType: 'audit_log',
    outcome: 'success',
    severity: 'notice',
    summary: { rows: rows.length, limit: EXPORT_LIMIT, filtered: Boolean(filters.outcome || filters.action || filters.target || filters.from || filters.to) }
  })
  if (!recorded) throw new ApiError(503, 'audit_unavailable', 'The export was not produced because it could not be recorded in the audit log.')
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="stracker-control-audit.csv"')
  res.end(csv)
}

/**
 * GET /api/control/audit?outcome=&action=&target=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=&pageSize=&format=json|csv
 * CSV export requires recent TOTP verification and is itself recorded. Export is refused
 * if the export event cannot be recorded. The database audit table is append-only.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const params = new URL(req.url ?? '/', 'http://localhost').searchParams
  await controlHandler(req, res, ['GET'], { requireAal2: true }, async context => {
    const filters = parseFilters(params)
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
    sendJson(res, 200, { events, total: count ?? 0, page, pageSize: limit })
  })
}
