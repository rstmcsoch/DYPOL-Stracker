import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError, sendJson } from '../http.js'
import { controlHandler } from '../control.js'
import { parsePage, parseSearch, parseUserSort, parseUserStatus } from '../control-policy.js'

type AuthUserRow = {
  id: string
  email?: string
  created_at?: string
  last_sign_in_at?: string | null
  email_confirmed_at?: string | null
  banned_until?: string | null
}

type ProfileRow = { user_id: string; display_name: string | null }

/**
 * GET /api/control/users?q=&status=all|verified|unverified|suspended&sort=created_desc|created_asc|last_sign_in&page=1&pageSize=25
 * Reads Auth account metadata and public profile labels. Never returns study-content rows.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET'], { requireAal2: true }, async context => {
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams
    const search = parseSearch(params.get('q')).toLowerCase()
    const status = parseUserStatus(params.get('status'))
    const sort = parseUserSort(params.get('sort'))
    const { limit, offset, page } = parsePage(params.get('page'), params.get('pageSize'))

    const allUsers: AuthUserRow[] = []
    for (let authPage = 1; authPage <= 500; authPage += 1) {
      const { data, error } = await context.admin.auth.admin.listUsers({ page: authPage, perPage: 200 })
      if (error) throw new ApiError(503, 'directory_unavailable', 'The user directory could not be loaded from Supabase Auth.')
      const batch = (data?.users ?? []) as AuthUserRow[]
      allUsers.push(...batch)
      if (batch.length < 200) break
      if (authPage === 500) throw new ApiError(503, 'directory_unavailable', 'The user directory exceeded the safe pagination limit.')
    }

    const { data: profiles, error: profileError } = await context.admin.from('profiles').select('user_id, display_name').limit(10000)
    if (profileError) throw new ApiError(503, 'directory_unavailable', 'Profile labels could not be loaded. Try again shortly.')
    const labels = new Map(((profiles ?? []) as ProfileRow[]).map(row => [row.user_id, row.display_name ?? '']))

    const now = Date.now()
    const isSuspended = (user: AuthUserRow) => Boolean(user.banned_until && Date.parse(user.banned_until) > now)
    const filtered = allUsers.filter(user => {
      const email = (user.email ?? '').toLowerCase()
      const displayName = (labels.get(user.id) ?? '').toLowerCase()
      if (search && !email.includes(search) && !displayName.includes(search)) return false
      if (status === 'verified' && !user.email_confirmed_at) return false
      if (status === 'unverified' && user.email_confirmed_at) return false
      if (status === 'suspended' && !isSuspended(user)) return false
      return true
    })

    filtered.sort((a, b) => {
      if (sort === 'created_asc') return Date.parse(a.created_at ?? '') - Date.parse(b.created_at ?? '')
      if (sort === 'last_sign_in') return Date.parse(b.last_sign_in_at ?? '') - Date.parse(a.last_sign_in_at ?? '')
      return Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? '')
    })
    const pageUsers = filtered.slice(offset, offset + limit)
    const ids = pageUsers.map(user => user.id)
    const testCounts = new Map<string, number>()
    if (ids.length) {
      const { data: tests, error: testsError } = await context.admin.from('tests').select('user_id').in('user_id', ids).limit(10000)
      if (testsError) throw new ApiError(503, 'directory_unavailable', 'Activity counts could not be loaded. Try again shortly.')
      for (const row of (tests ?? []) as Array<{ user_id: string }>) testCounts.set(row.user_id, (testCounts.get(row.user_id) ?? 0) + 1)
    }

    sendJson(res, 200, {
      users: pageUsers.map(user => ({
        id: user.id,
        email: user.email ?? '',
        displayName: labels.get(user.id) ?? '',
        createdAt: user.created_at ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
        emailConfirmedAt: user.email_confirmed_at ?? null,
        suspended: isSuspended(user),
        testsCount: testCounts.get(user.id) ?? 0
      })),
      total: filtered.length,
      page,
      pageSize: limit,
      filters: { q: search, status, sort }
    })
  })
}
