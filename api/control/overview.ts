import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { ApiError, sendJson } from '../_lib/http.js'
import { controlHandler } from '../_lib/control.js'

const DAY_MS = 24 * 60 * 60 * 1000
const RANGES = { today: 1, '7d': 7, '30d': 30 } as const
type RangeKey = keyof typeof RANGES

/** UTC day windows. "today" starts at 00:00 UTC; "7d" and "30d" include today. */
export function rangeWindow(key: RangeKey, now: Date): { since: Date; until: Date } {
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const since = new Date(startOfToday - (RANGES[key] - 1) * DAY_MS)
  const until = new Date(startOfToday + DAY_MS)
  return { since, until }
}

export function parseRangeKey(value: string | null): RangeKey {
  return value === 'today' || value === '7d' || value === '30d' ? value : '7d'
}

/**
 * GET /api/control/overview?range=today|7d|30d
 * Every figure comes from a database function or table. Percentages are computed here and
 * the definitions are returned with the payload so the interface can state them.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET'], { requireAal2: true }, async context => {
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams
    const rangeKey = parseRangeKey(params.get('range'))
    const { since, until } = rangeWindow(rangeKey, new Date())
    const started = Date.now()

    const [metricsResult, seriesResult, auditResult] = await Promise.all([
      context.admin.rpc('admin_overview_metrics', { p_since: since.toISOString(), p_until: until.toISOString() }),
      context.admin.rpc('admin_registration_series', { p_since: since.toISOString(), p_until: until.toISOString() }),
      context.admin.from('admin_audit_events').select('id, occurred_at, action, outcome, severity, actor_role, target_type, target_id').order('occurred_at', { ascending: false }).limit(8)
    ])
    const dbLatencyMs = Date.now() - started
    if (metricsResult.error || seriesResult.error || auditResult.error) {
      throw new ApiError(503, 'overview_unavailable', 'Overview metrics could not be loaded from the database. Try again shortly.')
    }

    const metrics = (metricsResult.data ?? {}) as Record<string, number>
    const total = Number(metrics.total_accounts ?? 0)
    const verified = Number(metrics.verified_accounts ?? 0)
    const withTests = Number(metrics.accounts_with_tests ?? 0)
    const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)

    sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      range: { key: rangeKey, since: since.toISOString(), until: until.toISOString(), timezone: 'UTC' },
      database: { status: 'healthy', latencyMs: dbLatencyMs },
      metrics: {
        totalAccounts: total,
        registrations: Number(metrics.registrations ?? 0),
        verifiedAccounts: verified,
        verifiedRatePercent: pct(verified, total),
        pendingConfirmation: Number(metrics.pending_confirmation ?? 0),
        pendingOver3Days: Number(metrics.pending_over_3_days ?? 0),
        activeAccounts: Number(metrics.active_accounts ?? 0),
        suspendedAccounts: Number(metrics.suspended_accounts ?? 0),
        testsLogged: Number(metrics.tests_logged ?? 0),
        accountsWithTests: withTests,
        trackerAdoptionPercent: pct(withTests, total)
      },
      series: ((seriesResult.data ?? []) as Array<{ day: string; registrations: number | string; verified: number | string }>).map(row => ({
        day: row.day,
        registrations: Number(row.registrations),
        verified: Number(row.verified)
      })),
      recentActivity: auditResult.data ?? [],
      definitions: {
        registrations: 'Accounts created in the selected UTC window.',
        verifiedRatePercent: 'Verified accounts ÷ all accounts (current state, all time).',
        pendingConfirmation: 'Accounts whose email is not yet confirmed (current state).',
        activeAccounts: 'Accounts whose most recent sign-in fell inside the window. Earlier sign-ins are not counted, so this is a lower bound on activity.',
        testsLogged: 'Test journal rows created in the window.',
        trackerAdoptionPercent: 'Accounts with at least one logged test ÷ all accounts (all time).'
      }
    })
  })
}
