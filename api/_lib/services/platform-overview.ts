import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../http.js'
import { DAY_MS, dayKeyInZone, parseReportingRange, reportingWindow, type ReportingRangeKey } from '../../../src/lib/time-window.js'
import { isAccountSuspended, listAuthUsers, type AuthUserRecord } from './auth-users.js'

export interface OverviewQuery {
  range?: unknown
  timeZone: string
  now?: Date
}

export interface DailyPoint {
  day: string
  registrations: number
  verified: number
  testsLogged: number
}

const pct = (part: number, whole: number) => whole > 0 ? Math.round((part / whole) * 1000) / 10 : null

export async function loadPlatformOverview(admin: SupabaseClient, query: OverviewQuery) {
  const now = query.now ?? new Date()
  const rangeKey = parseReportingRange(query.range)
  const window = reportingWindow(rangeKey, now, query.timeZone)
  const { since, until } = window
  const started = Date.now()

  const [overviewResult, auditResult, testCountResult, testUsersResult, testWindowResult, authUsers] = await Promise.all([
    admin.rpc('control_overview', { since_ts: since.toISOString(), until_ts: until.toISOString() }),
    admin.from('control_audit_events').select('id, created_at, action, result, actor_id, actor_role, target_type, target_id, error_category, reason, after_summary').order('created_at', { ascending: false }).limit(8),
    admin.from('tests').select('id', { count: 'exact', head: true }).gte('created_at', since.toISOString()).lt('created_at', until.toISOString()),
    admin.from('tests').select('user_id').limit(10000),
    admin.from('tests').select('created_at').gte('created_at', since.toISOString()).lt('created_at', until.toISOString()).limit(10000),
    listAuthUsers(admin, 'overview_unavailable', 'Account metrics could not be loaded from Supabase Auth.')
  ])
  const dbLatencyMs = Date.now() - started
  if (overviewResult.error || auditResult.error || testCountResult.error || testUsersResult.error || testWindowResult.error) {
    throw new ApiError(503, 'overview_unavailable', 'Overview metrics could not be loaded from the database. Try again shortly.')
  }

  const m = (overviewResult.data ?? {}) as Record<string, number | string>
  const total = Number(m.total_accounts ?? 0)
  const verified = Number(m.verified_accounts ?? 0)
  const registrations = Number(m.new_accounts ?? 0)
  const instant = now.getTime()
  const users = authUsers.filter(user => user.created_at)
  const pendingOver3Days = users.filter(user => !user.email_confirmed_at && user.created_at && Date.parse(user.created_at) < instant - 3 * DAY_MS).length
  const activeAccounts = users.filter(user => user.last_sign_in_at && Date.parse(user.last_sign_in_at) >= since.getTime() && Date.parse(user.last_sign_in_at) < until.getTime()).length
  const accountTestUsers = new Set(((testUsersResult.data ?? []) as Array<{ user_id: string }>).map(row => row.user_id)).size
  const testsLogged = testCountResult.count ?? 0
  const testRows = (testWindowResult.data ?? []) as Array<{ created_at: string }>

  const series = buildDailySeries(users, testRows, window.days, since, until, query.timeZone)
  const recentActivity = ((auditResult.data ?? []) as Array<Record<string, unknown>>).map(normalizeRecentAudit)
  const zoneLabel = query.timeZone === 'UTC' ? 'UTC' : `${query.timeZone} days`

  const metrics = {
    totalAccounts: total,
    registrations,
    verifiedAccounts: verified,
    verifiedRatePercent: pct(verified, total),
    pendingConfirmation: Number(m.unverified_accounts ?? 0),
    pendingOver3Days,
    activeAccounts,
    suspendedAccounts: Number(m.banned_accounts ?? users.filter(user => isAccountSuspended(user, instant)).length),
    testsLogged,
    accountsWithTests: accountTestUsers,
    trackerAdoptionPercent: pct(accountTestUsers, total)
  }

  const range = {
    key: rangeKey as ReportingRangeKey,
    since: since.toISOString(),
    until: until.toISOString(),
    firstDay: window.firstDay,
    lastDay: window.lastDay,
    timezone: query.timeZone
  }

  const definitions = {
    totalAccounts: 'All registered accounts (current state, all time).',
    registrations: `Accounts created in the selected window (${zoneLabel}).`,
    verifiedRatePercent: 'Verified accounts ÷ all accounts (current state, all time).',
    pendingConfirmation: 'Accounts whose email is not yet confirmed (current state, all time).',
    pendingOver3Days: 'Unconfirmed accounts created more than 72 hours ago.',
    activeAccounts: `Accounts whose most recent sign-in fell inside the selected window (${zoneLabel}). A lower bound: only the latest sign-in per account is known.`,
    suspendedAccounts: 'Accounts whose sign-in is currently disabled (current state, all time).',
    testsLogged: `Test journal rows created in the selected window (${zoneLabel}).`,
    trackerAdoptionPercent: 'Accounts with at least one logged test ÷ all accounts (all time).'
  }

  return {
    generatedAt: now.toISOString(),
    range,
    database: { status: 'healthy' as const, latencyMs: dbLatencyMs },
    metrics,
    series,
    recentActivity,
    definitions
  }
}

export async function loadAccountOverview(admin: SupabaseClient, query: OverviewQuery) {
  const overview = await loadPlatformOverview(admin, query)
  return {
    generatedAt: overview.generatedAt,
    range: overview.range,
    metrics: overview.metrics,
    definitions: overview.definitions
  }
}

export async function loadDailyActivity(admin: SupabaseClient, query: OverviewQuery) {
  const overview = await loadPlatformOverview(admin, query)
  return {
    generatedAt: overview.generatedAt,
    range: overview.range,
    series: overview.series,
    totals: {
      registrations: overview.metrics.registrations,
      testsLogged: overview.metrics.testsLogged,
      activeAccounts: overview.metrics.activeAccounts
    }
  }
}

function buildDailySeries(
  users: AuthUserRecord[],
  testRows: Array<{ created_at: string }>,
  days: string[],
  since: Date,
  until: Date,
  timeZone: string
): DailyPoint[] {
  const byDay = new Map<string, DailyPoint>()
  for (const day of days) byDay.set(day, { day, registrations: 0, verified: 0, testsLogged: 0 })
  for (const user of users) {
    const createdAt = user.created_at ? Date.parse(user.created_at) : NaN
    if (Number.isNaN(createdAt) || createdAt < since.getTime() || createdAt >= until.getTime()) continue
    const day = dayKeyInZone(createdAt, timeZone)
    const item = byDay.get(day)
    if (!item) continue
    item.registrations += 1
    if (user.email_confirmed_at) item.verified += 1
  }
  for (const row of testRows) {
    const createdAt = Date.parse(row.created_at)
    if (Number.isNaN(createdAt) || createdAt < since.getTime() || createdAt >= until.getTime()) continue
    const item = byDay.get(dayKeyInZone(createdAt, timeZone))
    if (item) item.testsLogged += 1
  }
  return days.map(day => byDay.get(day) ?? { day, registrations: 0, verified: 0, testsLogged: 0 })
}

function normalizeRecentAudit(row: Record<string, unknown>) {
  const result = typeof row.result === 'string' ? row.result : 'success'
  return {
    id: row.id,
    occurredAt: row.created_at,
    action: row.action,
    outcome: result === 'error' ? 'failed' : result,
    actorRole: row.actor_role,
    targetType: row.target_type,
    targetId: row.target_id,
    errorCategory: row.error_category,
    reason: row.reason
  }
}
