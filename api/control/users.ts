import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { ApiError, sendJson } from '../_lib/http.js'
import { controlHandler } from '../_lib/control.js'
import { parsePage, parseSearch, parseUserSort, parseUserStatus } from '../_lib/control-policy.js'

/**
 * GET /api/control/users?q=&status=all|verified|unverified|suspended&sort=created_desc|created_asc|last_sign_in&page=1&pageSize=25
 * Server-side search, filtering, sorting and pagination. Returns the administration fields only.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET'], { requireAal2: true }, async context => {
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams
    const search = parseSearch(params.get('q'))
    const status = parseUserStatus(params.get('status'))
    const sort = parseUserSort(params.get('sort'))
    const { limit, offset, page } = parsePage(params.get('page'), params.get('pageSize'))

    const { data, error } = await context.admin.rpc('admin_list_users', {
      p_search: search,
      p_status: status,
      p_sort: sort,
      p_limit: limit,
      p_offset: offset
    })
    if (error) throw new ApiError(503, 'directory_unavailable', 'The user directory could not be loaded. Try again shortly.')

    const rows = (data ?? []) as Array<Record<string, unknown>>
    const total = rows.length ? Number(rows[0]?.total_count ?? 0) : 0
    const now = Date.now()
    sendJson(res, 200, {
      users: rows.map(row => {
        const bannedUntil = typeof row.banned_until === 'string' ? row.banned_until : null
        return {
          id: String(row.user_id),
          email: String(row.email ?? ''),
          displayName: String(row.display_name ?? ''),
          createdAt: row.created_at ?? null,
          lastSignInAt: row.last_sign_in_at ?? null,
          emailConfirmedAt: row.email_confirmed_at ?? null,
          suspended: bannedUntil !== null && Date.parse(bannedUntil) > now,
          testsCount: Number(row.tests_count ?? 0)
        }
      }),
      total,
      page,
      pageSize: limit,
      filters: { q: search, status, sort }
    })
  })
}
