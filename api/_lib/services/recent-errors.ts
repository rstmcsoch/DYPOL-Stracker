import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../http.js'
import { parsePage } from '../control-policy.js'
import { isMissingRelation } from './audit-read.js'

const ERROR_STATUSES = ['open', 'resolved', 'ignored'] as const
const SAFE_COLUMNS = 'fingerprint, kind, message, first_seen, last_seen, occurrences, last_route, status'

export interface RecentErrorsQuery {
  page?: unknown
  pageSize?: unknown
  status?: unknown
}

export async function loadRecentErrors(admin: SupabaseClient, query: RecentErrorsQuery = {}) {
  const status = typeof query.status === 'string' && (ERROR_STATUSES as readonly string[]).includes(query.status) ? query.status : null
  if (query.status && !status) throw new ApiError(400, 'invalid_filter', 'Error status must be open, resolved or ignored.')
  const { limit, offset, page } = parsePage(query.page, query.pageSize, 25, 100)
  let request = admin.from('analytics_error_groups').select(SAFE_COLUMNS, { count: 'exact' }).order('last_seen', { ascending: false }).range(offset, offset + limit - 1)
  if (status) request = request.eq('status', status)
  const { data, error, count } = await request
  if (error) {
    if (isMissingRelation(error)) {
      return {
        groups: [],
        total: 0,
        page,
        pageSize: limit,
        filters: { status },
        available: false,
        note: 'Analytics error groups are not available in this deployment yet.'
      }
    }
    throw new ApiError(503, 'errors_unavailable', 'Recent errors could not be loaded. Try again shortly.')
  }
  const groups = ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
    fingerprint: row.fingerprint,
    kind: row.kind,
    message: row.message,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    occurrences: row.occurrences,
    lastRoute: row.last_route,
    status: row.status
  }))
  return { groups, total: count ?? 0, page, pageSize: limit, filters: { status }, available: true }
}
