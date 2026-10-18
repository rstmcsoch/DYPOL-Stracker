import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError, sendJson } from '../http.js'
import { controlHandler } from '../control.js'
import { DAY_MS, dayKeyInZone, parseReportingRange, parseTimeZone, reportingWindow, type ReportingRangeKey } from '../../../src/lib/time-window.js'

/** Kept for existing callers/tests: a UTC window for a range key. */
export function rangeWindow(key: ReportingRangeKey, now: Date, timeZone = 'UTC'): { since: Date; until: Date } {
  const window = reportingWindow(key, now, timeZone)
  return { since: window.since, until: window.until }
}

export const parseRangeKey = parseReportingRange

type AuthUser = {
  id: string
  email?: string
  created_at?: string
  email_confirmed_at?: string | null
  last_sign_in_at?: string | null
  banned_until?: string | null
}

type AuditRow = {
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
  after_summary: Record<string, unknown> | null
}

async function listAuthUsers(admin: { auth: { admin: { listUsers: (options: { page: number; perPage: number }) => Promise<{data: {users?: AuthUser[]} | null; error: {message?: string} | null}> } } }): Promise<AuthUser[]> {
  const users: AuthUser[] = []
  for (let page = 1; page <= 500; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new ApiError(503, 'overview_unavailable', 'Account metrics could not be loaded from Supabase Auth.')
    const batch = data?.users ?? []
    users.push(...batch)
    if (batch.length < 200) return users
  }
  throw new ApiError(503, 'overview_unavailable', 'Account metrics exceeded the safe pagination limit.')
}

/**
 * GET /api/control/overview?range=today|7d|30d&tz=Area/City
 * The window is the last N calendar days in `tz` (validated IANA zone, default UTC), ending
 * today. `range.since`/`range.until` are the half-open query instants; `range.firstDay` and
 * `range.lastDay` are the inclusive calendar days for display.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET'], { requireAal2: true }, async context => {
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams
    const rangeKey = parseRangeKey(params.get('range'))
    const timeZone = parseTimeZone(params.get('tz'))
    const window = reportingWindow(rangeKey, new Date(), timeZone)
    const { since, until } = window
    const started = Date.now()

    const [overviewResult, auditResult, testCountResult, testUsersResult, authUsers] = await Promise.all([
      context.admin.rpc('control_overview', { since_ts: since.toISOString(), until_ts: until.toISOString() }),
      context.admin.from('control_audit_events').select('id, created_at, action, result, actor_id, actor_role, target_type, target_id, error_category, reason, after_summary').order('created_at', { ascending: false }).limit(8),
      context.admin.from('tests').select('id', { count: 'exact', head: true }).gte('created_at', since.toISOString()).lt('created_at', until.toISOString()),
      context.admin.from('tests').select('user_id').limit(10000),
      listAuthUsers(context.admin)
    ])
    const dbLatencyMs = Date.now() - started
    if (overviewResult.error || auditResult.error || testCountResult.error || testUsersResult.error) {
      throw new ApiError(503, 'overview_unavailable', 'Overview metrics could not be loaded from the database. Try again shortly.')
    }

    const m = (overviewResult.data ?? {}) as Record<string, unknown>
    const total = Number(m.total_accounts ?? 0)
    const verified = Number(m.verified_accounts ?? 0)
    const registrations = Number(m.new_accounts ?? 0)
    const now = Date.now()
    const users = authUsers.filter(user => user.created_at)
    const pendingOver3Days = users.filter(user => !user.email_confirmed_at && user.created_at && Date.parse(user.created_at) < now - 3 * DAY_MS).length
    const activeAccounts = users.filter(user => user.last_sign_in_at && Date.parse(user.last_sign_in_at) >= since.getTime() && Date.parse(user.last_sign_in_at) < until.getTime()).length
    const accountTestUsers = new Set(((testUsersResult.data ?? []) as Array<{user_id: string}>).map(row => row.user_id)).size
    const testsLogged = testCountResult.count ?? 0
    const pct = (part: number, whole: number) => whole > 0 ? Math.round((part / whole) * 1000) / 10 : null

    const seriesByDay = new Map<string, { registrations: number; verified: number }>()
    for (const user of users) {
      const createdAt = user.created_at ? Date.parse(user.created_at) : NaN
      if (Number.isNaN(createdAt) || createdAt < since.getTime() || createdAt >= until.getTime()) continue
      const day = dayKeyInZone(createdAt, timeZone)
      const item = seriesByDay.get(day) ?? { registrations: 0, verified: 0 }
      item.registrations += 1
      if (user.email_confirmed_at) item.verified += 1
      seriesByDay.set(day, item)
    }
    const series = window.days.map(day => ({ day, registrations: seriesByDay.get(day)?.registrations ?? 0, verified: seriesByDay.get(day)?.verified ?? 0 }))

    const recentActivity = ((auditResult.data ?? []) as AuditRow[]).map(row => ({
      id: row.id,
      occurred_at: row.created_at,
      action: row.action,
      outcome: row.result === 'error' ? 'failed' : row.result,
      severity: row.result === 'error' ? 'warning' : row.result === 'denied' ? 'notice' : 'info',
      actor_id: row.actor_id,
      actor_role: row.actor_role,
      target_type: row.target_type,
      target_id: row.target_id,
      error_code: row.error_category,
      reason: row.reason,
      summary: row.after_summary ?? undefined
    }))

    const zoneLabel = timeZone === 'UTC' ? 'UTC' : `${timeZone} days`
    sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      range: { key: rangeKey, since: since.toISOString(), until: until.toISOString(), firstDay: window.firstDay, lastDay: window.lastDay, timezone: timeZone },
      database: { status: 'healthy', latencyMs: dbLatencyMs },
      metrics: {
        totalAccounts: total,
        registrations,
        verifiedAccounts: verified,
        verifiedRatePercent: pct(verified, total),
        pendingConfirmation: Number(m.unverified_accounts ?? 0),
        pendingOver3Days,
        activeAccounts,
        suspendedAccounts: Number(m.banned_accounts ?? 0),
        testsLogged,
        accountsWithTests: accountTestUsers,
        trackerAdoptionPercent: pct(accountTestUsers, total)
      },
      series,
      recentActivity,
      definitions: {
        totalAccounts: 'All registered accounts (current state, all time).',
        registrations: `Accounts created in the selected window (${zoneLabel}).`,
        verifiedRatePercent: 'Verified accounts ÷ all accounts (current state, all time).',
        pendingConfirmation: 'Accounts whose email is not yet confirmed (current state, all time). Opens the Users page filtered to "Email not verified".',
        pendingOver3Days: 'Unconfirmed accounts created more than 72 hours ago.',
        activeAccounts: `Accounts whose most recent sign-in fell inside the selected window (${zoneLabel}). A lower bound: only the latest sign-in per account is known.`,
        suspendedAccounts: 'Accounts whose sign-in is currently disabled (current state, all time).',
        testsLogged: `Test journal rows created in the selected window (${zoneLabel}).`,
        trackerAdoptionPercent: 'Accounts with at least one logged test ÷ all accounts (all time).'
      }
    })
  })
}
