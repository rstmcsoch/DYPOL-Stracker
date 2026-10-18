import { AUDIT_ACTION_NAMES } from '../lib/control-audit-catalog'

/**
 * Audit-log filter state shared by the URL, the visible controls, the JSON query and the CSV
 * export, so all four always agree. Only non-default values are ever serialized: the server
 * treats an absent parameter as "no filter" and rejects anything it cannot validate.
 */
export const AUDIT_OUTCOME_OPTIONS = ['all', 'success', 'denied', 'failed'] as const
export type AuditOutcomeOption = (typeof AUDIT_OUTCOME_OPTIONS)[number]

export interface AuditFilters {
  outcome: AuditOutcomeOption
  action: string
  target: string
  from: string
  to: string
}

export const DEFAULT_AUDIT_FILTERS: AuditFilters = { outcome: 'all', action: '', target: '', from: '', to: '' }

const ACTION_PATTERN = /^[a-z][a-z0-9_.]{0,79}$/
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Reads filters from the URL; values that could never be valid are dropped so a stale link still loads. */
export function readAuditFilters(params: URLSearchParams): AuditFilters {
  const outcome = params.get('outcome') ?? ''
  const action = (params.get('action') ?? '').trim()
  const target = (params.get('target') ?? '').trim()
  const from = (params.get('from') ?? '').trim()
  const to = (params.get('to') ?? '').trim()
  return {
    outcome: (AUDIT_OUTCOME_OPTIONS as readonly string[]).includes(outcome) ? (outcome as AuditOutcomeOption) : 'all',
    action: ACTION_PATTERN.test(action) ? action : '',
    target: UUID_PATTERN.test(target) ? target.toLowerCase() : '',
    from: DAY_PATTERN.test(from) ? from : '',
    to: DAY_PATTERN.test(to) ? to : ''
  }
}

export function readAuditPage(params: URLSearchParams): number {
  const page = Number.parseInt(params.get('page') ?? '1', 10)
  return Number.isFinite(page) && page >= 1 ? Math.min(page, 10_000) : 1
}

export function isDefaultAuditFilters(filters: AuditFilters): boolean {
  return filters.outcome === 'all' && !filters.action && !filters.target && !filters.from && !filters.to
}

/** URL search params containing only the non-default filters (used for the address bar). */
export function auditFiltersToParams(filters: AuditFilters, page = 1): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.outcome !== 'all') params.set('outcome', filters.outcome)
  if (filters.action) params.set('action', filters.action)
  if (filters.target) params.set('target', filters.target)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (page > 1) params.set('page', String(page))
  return params
}

/** Query string for /api/control/audit: same filters as the URL plus the display zone. */
export function buildAuditQuery(filters: AuditFilters, timeZone: string, extra: Record<string, string | number> = {}): string {
  const params = auditFiltersToParams(filters)
  params.set('tz', timeZone)
  for (const [key, value] of Object.entries(extra)) params.set(key, String(value))
  return params.toString()
}

/** Known action names plus any valid action present in the URL (so old links still resolve). */
export function auditActionChoices(current: string): string[] {
  const names = [...AUDIT_ACTION_NAMES]
  if (current && !names.includes(current)) names.push(current)
  return names
}

/** Maps the server's `reason: field:<name>` hint to a filter key, if present. */
export function invalidFilterField(reason: string | undefined | null): keyof AuditFilters | null {
  const match = /^field:(outcome|action|target|from|to)$/.exec(reason ?? '')
  return match ? (match[1] as keyof AuditFilters) : null
}
