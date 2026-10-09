import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { ApiError, sendJson } from '../_lib/http.js'
import { controlHandler, recordAuditEvent, requireRecentMfa, type ControlContext } from '../_lib/control.js'
import { isUuid, parseAuditAction, parseAuditOutcome, parseIsoDate, parsePage, toCsv } from '../_lib/control-policy.js'

const EXPORT_LIMIT = 5000
const COLUMNS = ['occurred_at', 'action', 'outcome', 'severity', 'actor_id', 'actor_role', 'target_type', 'target_id', 'error_code', 'reason', 'request_id', 'summary'] as const

interface AuditFilters {
  outcome: string | null
  action: string | null
  target: string | null
  from: string | null
  to: string | null
}

/** Applies the validated filters to any audit query. Values are bound parameters, never SQL text. */
function withFilters<Q extends { eq: (column: string, value: string) => Q; gte: (column: string, value: string) => Q; lt: (column: string, value: string) => Q }>(query: Q, filters: AuditFilters): Q {
  let next = query
  if (filters.outcome) next = next.eq('outcome', filters.outcome)
  if (filters.action) next = next.eq('action', filters.action)
  if (filters.target) next = next.eq('target_id', filters.target)
  if (filters.from) next = next.gte('occurred_at', filters.from)
  if (filters.to) next = next.lt('occurred_at', filters.to)
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
  // "to" is inclusive of the whole named day (UTC).
  const to = toDay ? new Date(Date.parse(toDay) + 24 * 60 * 60 * 1000).toISOString() : null
  return { outcome, action, target, from, to }
}

async function exportCsv(context: ControlContext, filters: AuditFilters, res: ApiResponse): Promise<void> {
  requireRecentMfa(context)
  const base = context.admin.from('admin_audit_events').select(COLUMNS.join(', ')).order('occurred_at', { ascending: false }).limit(EXPORT_LIMIT)
  const { data, error } = await withFilters(base, filters)
  if (error) throw new ApiError(503, 'audit_unavailable', 'The audit log could not be exported. Try again shortly.')
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
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
 * CSV export requires a recent TOTP verification and is itself recorded. Export is refused
 * if the export event cannot be recorded. The audit table is append-only in the database.
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
      .from('admin_audit_events')
      .select(COLUMNS.join(', '), { count: 'exact' })
      .order('occurred_at', { ascending: false })
      .range(offset, offset + limit - 1)
    const { data, error, count } = await withFilters(base, filters)
    if (error) throw new ApiError(503, 'audit_unavailable', 'The audit log could not be loaded. Try again shortly.')
    sendJson(res, 200, { events: data ?? [], total: count ?? 0, page, pageSize: limit })
  })
}
