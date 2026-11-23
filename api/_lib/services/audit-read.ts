import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../http.js'
import { AUDIT_FILTER_LABELS, parseAuditFilters, parsePage, sanitizeAuditSummary } from '../control-policy.js'
import { dayRangeInZone, isValidTimeZone, parseTimeZone } from '../../../src/lib/time-window.js'

export type AuditSource = 'control' | 'master_mcp' | 'all'

export interface AuditReadQuery {
  source?: unknown
  outcome?: unknown
  action?: unknown
  target?: unknown
  from?: unknown
  to?: unknown
  timeZone?: unknown
  page?: unknown
  pageSize?: unknown
}

const CONTROL_COLUMNS = 'id, created_at, action, result, actor_id, actor_role, target_type, target_id, error_category, reason, request_id, before_summary, after_summary'
const MASTER_COLUMNS = 'id, created_at, action, result, credential_id, credential_label, tool_name, target_type, target_id, error_category, reason, request_id, before_summary, after_summary'

function parseSource(value: unknown): AuditSource {
  return value === 'control' || value === 'master_mcp' || value === 'all' ? value : 'all'
}

function parseZone(value: unknown): string {
  if (value === undefined || value === null || value === '') return parseTimeZone(null)
  if (!isValidTimeZone(value)) throw new ApiError(400, 'invalid_filter', 'The time zone is not a valid IANA name.')
  return value
}


const EXTRA_BLOCKED = /note|notes|mark|marks|payload|body|content|message_body|question|solution/i

function safeSummary(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (EXTRA_BLOCKED.test(key)) continue
    filtered[key] = value
  }
  return sanitizeAuditSummary(filtered)
}

function publicEvent(row: Record<string, unknown>, source: 'control' | 'master_mcp') {
  const result = typeof row.result === 'string' ? row.result : 'success'
  const outcome = result === 'error' ? 'failed' : result
  const before = safeSummary(row.before_summary)
  const after = safeSummary(row.after_summary)
  return {
    id: row.id,
    source,
    occurredAt: row.created_at,
    action: row.action,
    outcome,
    actorRole: source === 'control' ? row.actor_role ?? 'control' : 'master_mcp',
    credentialLabel: source === 'master_mcp' ? row.credential_label ?? null : null,
    toolName: source === 'master_mcp' ? row.tool_name ?? null : null,
    targetType: row.target_type ?? null,
    targetId: row.target_id ?? null,
    errorCategory: row.error_category ?? null,
    reason: row.reason ?? null,
    summary: { ...before, ...after }
  }
}

/**
 * Read-only audit listing. Master MCP cannot edit or delete these rows.
 * Filters are the same bounded shapes used by the Control Centre audit log.
 */
export async function listAuditEvents(admin: SupabaseClient, query: AuditReadQuery) {
  const source = parseSource(query.source)
  const timeZone = parseZone(query.timeZone)
  const asText = (value: unknown): string | null => typeof value === 'string' ? value : value == null ? null : String(value)
  const parsed = parseAuditFilters({ outcome: asText(query.outcome), action: asText(query.action), target: asText(query.target), from: asText(query.from), to: asText(query.to) })
  if (!parsed.ok) {
    throw new ApiError(400, 'invalid_filter', `The ${AUDIT_FILTER_LABELS[parsed.problem.field]} filter is not valid. Expected ${parsed.problem.expected}.`, { reason: `field:${parsed.problem.field}` })
  }
  const { limit, offset, page } = parsePage(query.page, query.pageSize, 50, 100)
  const range = dayRangeInZone(parsed.filters.fromDay, parsed.filters.toDay, timeZone)
  const from = range.from?.toISOString() ?? null
  const to = range.to?.toISOString() ?? null

  const control = source === 'master_mcp' ? { events: [] as ReturnType<typeof publicEvent>[], total: 0 } : await loadControl(admin, parsed.filters, from, to, offset, limit, source === 'all')
  const master = source === 'control' ? { events: [] as ReturnType<typeof publicEvent>[], total: 0 } : await loadMaster(admin, parsed.filters, from, to, offset, limit, source === 'all')

  const events = source === 'all'
    ? [...control.events, ...master.events].sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt))).slice(0, limit)
    : source === 'control' ? control.events : master.events

  return {
    events,
    total: source === 'all' ? control.total + master.total : source === 'control' ? control.total : master.total,
    page,
    pageSize: limit,
    filters: {
      source,
      outcome: parsed.filters.outcome,
      action: parsed.filters.action,
      target: parsed.filters.target,
      from: parsed.filters.fromDay,
      to: parsed.filters.toDay,
      timeZone,
      since: from,
      until: to
    },
    readOnly: true
  }
}

function applyFilters<Q extends { eq: (column: string, value: string) => Q; gte: (column: string, value: string) => Q; lt: (column: string, value: string) => Q }>(
  query: Q,
  filters: { outcome: string | null; action: string | null; target: string | null },
  from: string | null,
  to: string | null,
  failedResult = 'error'
): Q {
  let next = query
  if (filters.outcome) next = next.eq('result', filters.outcome === 'failed' ? failedResult : filters.outcome)
  if (filters.action) next = next.eq('action', filters.action)
  if (filters.target) next = next.eq('target_id', filters.target)
  if (from) next = next.gte('created_at', from)
  if (to) next = next.lt('created_at', to)
  return next
}

async function loadControl(
  admin: SupabaseClient,
  filters: { outcome: string | null; action: string | null; target: string | null },
  from: string | null,
  to: string | null,
  offset: number,
  limit: number,
  prefetch: boolean
) {
  const end = prefetch ? offset + limit - 1 : offset + limit - 1
  const start = prefetch ? 0 : offset
  const { data, error, count } = await applyFilters(
    admin.from('control_audit_events').select(CONTROL_COLUMNS, { count: 'exact' }).order('created_at', { ascending: false }).range(start, end),
    filters,
    from,
    to
  )
  if (error) throw new ApiError(503, 'audit_unavailable', 'The audit log could not be loaded. Try again shortly.')
  const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).map(row => publicEvent(row, 'control'))
  return { events: prefetch ? rows : rows, total: count ?? 0 }
}

async function loadMaster(
  admin: SupabaseClient,
  filters: { outcome: string | null; action: string | null; target: string | null },
  from: string | null,
  to: string | null,
  offset: number,
  limit: number,
  prefetch: boolean
) {
  const end = offset + limit - 1
  const start = prefetch ? 0 : offset
  const { data, error, count } = await applyFilters(
    admin.from('master_mcp_audit_events').select(MASTER_COLUMNS, { count: 'exact' }).order('created_at', { ascending: false }).range(start, end),
    filters,
    from,
    to,
    'failed'
  )
  if (error) {
    if (isMissingRelation(error)) return { events: [], total: 0 }
    throw new ApiError(503, 'audit_unavailable', 'The Master MCP audit log could not be loaded. Try again shortly.')
  }
  const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).map(row => publicEvent(row, 'master_mcp'))
  return { events: rows, total: count ?? 0 }
}

export function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist/i.test(error.message ?? '')
}
