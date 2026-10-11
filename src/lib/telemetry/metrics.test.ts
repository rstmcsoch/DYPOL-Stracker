import { describe, expect, it } from 'vitest'
import { activeUsers, channel, dailySeries, dedupe, delta, evaluateAlert, funnel, paths, percentile, resolvePeriod, retentionCohorts, totals, vitalRating, writeOutcomes, type EventRow } from './metrics'

let n = 0
const ev = (name: string, at: string, extra: Partial<EventRow> = {}): EventRow => ({
  id: `id-${++n}`, name, ts: at, source: 'public', route: '/', session_id: 's1', user_ref: null, props: {}, device: 'desktop', browser: 'chrome',
  referrer_domain: null, utm_source: null, utm_medium: null, utm_campaign: null, is_test: false, env: 'production', ...extra
})

describe('periods', () => {
  it('resolves IST whole days and an equal-length previous window', () => {
    const now = new Date('2026-10-11T04:00:00Z') // 09:30 IST on 11 Oct
    const p = resolvePeriod('7d', now, 'Asia/Kolkata')
    expect(p.fromDay).toBe('2026-10-05'); expect(p.toDay).toBe('2026-10-11'); expect(p.days).toBe(7)
    expect(p.from.toISOString()).toBe('2026-10-04T18:30:00.000Z')
    expect(p.to.toISOString()).toBe('2026-10-11T18:30:00.000Z')
    expect(p.prevTo.toISOString()).toBe(p.from.toISOString())
    expect(p.prevFrom.toISOString()).toBe('2026-09-27T18:30:00.000Z')
    const y = resolvePeriod('yesterday', now, 'Asia/Kolkata')
    expect([y.fromDay, y.toDay, y.days]).toEqual(['2026-10-10', '2026-10-10', 1])
    const c = resolvePeriod('custom', now, 'UTC', { from: '2026-10-01', to: '2026-10-03' })
    expect([c.days, c.prevFrom.toISOString()]).toEqual([3, '2026-09-28T00:00:00.000Z'])
  })
  it('reports no % change from zero', () => {
    expect(delta(5, 0)).toEqual({ abs: 5, pct: null })
    expect(delta(15, 10)).toEqual({ abs: 5, pct: 50 })
  })
})

describe('counting', () => {
  it('dedupes by event id and computes sessions, bounce, visitors', () => {
    const a = ev('page_view', '2026-10-10T10:00:00Z')
    const rows = dedupe([a, a, ev('page_view', '2026-10-10T10:01:00Z', { session_id: 's2', user_ref: 'u1' }), ev('page_view', '2026-10-10T10:02:00Z', { session_id: 's2', user_ref: 'u1' })])
    expect(rows).toHaveLength(3)
    const t = totals(rows)
    expect([t.pageViews, t.sessions, t.visitors, t.signedInUsers, t.bounceRate]).toEqual([3, 2, 2, 1, 50])
  })
  it('zero-fills days and buckets by local day', () => {
    const period = resolvePeriod('custom', new Date(), 'Asia/Kolkata', { from: '2026-10-09', to: '2026-10-10' })
    const series = dailySeries([ev('page_view', '2026-10-09T20:00:00Z')], period, 'Asia/Kolkata')
    expect(series).toEqual([{ day: '2026-10-09', value: 0 }, { day: '2026-10-10', value: 1 }])
  })
  it('never counts failed or attempted writes as saves', () => {
    const rows = [
      ev('student_record_write_attempted', '2026-10-10T10:00:00Z', { props: { feature: 'tests', op: 'create', count: 2 } }),
      ev('student_record_write_succeeded', '2026-10-10T10:00:01Z', { props: { feature: 'tests', op: 'create', count: 2 } }),
      ev('student_record_write_failed', '2026-10-10T10:00:02Z', { props: { feature: 'tests', op: 'create', count: 1, reason: 'server' } })
    ]
    expect(writeOutcomes(rows)).toEqual([{ feature: 'tests', op: 'create', succeeded: 2, failed: 1, attempted: 2, failureRate: 33.3 }])
  })
  it('classifies channels', () => {
    expect(channel({ referrer_domain: null, utm_medium: null, utm_source: null })).toBe('Direct')
    expect(channel({ referrer_domain: 'google.com', utm_medium: null, utm_source: null })).toBe('Organic search')
    expect(channel({ referrer_domain: 'instagram.com', utm_medium: null, utm_source: null })).toBe('Social')
    expect(channel({ referrer_domain: 'x.org', utm_medium: 'cpc', utm_source: 'g' })).toBe('Paid')
  })
})

describe('funnels', () => {
  it('requires steps in order and joins anonymous steps to the account that signs in', () => {
    const rows = [
      ev('cta_clicked', '2026-10-10T10:00:00Z', { session_id: 'a' }),
      ev('signup_started', '2026-10-10T10:01:00Z', { session_id: 'a' }),
      ev('signup_completed', '2026-10-10T10:03:00Z', { session_id: 'a', user_ref: 'u1' }),
      // visitor b completes step 2 before step 1: does not count beyond step 1
      ev('signup_started', '2026-10-10T09:00:00Z', { session_id: 'b' }),
      ev('cta_clicked', '2026-10-10T09:05:00Z', { session_id: 'b' })
    ]
    const result = funnel(rows, [{ name: 'cta_clicked' }, { name: 'signup_started' }, { name: 'signup_completed' }])
    expect(result.map(step => step.count)).toEqual([2, 1, 1])
    expect(result[1]?.fromPrevious).toBe(50)
    expect(result[2]?.medianSecondsFromPrevious).toBe(120)
    expect(funnel([], [{ name: 'cta_clicked' }, { name: 'signup_started' }])[0]?.conversion).toBeNull()
  })
  it('matches route/source step filters', () => {
    const rows = [ev('page_view', '2026-10-10T10:00:00Z', { source: 'app' }), ev('page_view', '2026-10-10T10:00:00Z', { session_id: 'z', source: 'public' })]
    expect(funnel(rows, [{ name: 'page_view', match: { prop: 'source', value: 'public' } }, { name: 'x' }])[0]?.count).toBe(1)
  })
})

describe('retention', () => {
  it('leaves immature cohort cells blank instead of zero', () => {
    const activity = [
      { user: 'a', day: '2026-09-28' }, { user: 'a', day: '2026-10-06' },
      { user: 'b', day: '2026-09-29' },
      { user: 'c', day: '2026-10-06' }
    ]
    const cohorts = retentionCohorts(activity, '2026-10-12', 4)
    const sep = cohorts.find(row => row.cohort === '2026-09-28')!
    expect(sep.size).toBe(2)
    expect(sep.cells).toEqual([100, 50, null, null]) // week starting 12 Oct has not finished
    const oct = cohorts.find(row => row.cohort === '2026-10-05')!
    expect(oct.cells[0]).toBe(100)
    expect(oct.cells[1]).toBeNull()
  })
  it('computes DAU/WAU/MAU and stickiness', () => {
    const activity = [{ user: 'a', day: '2026-10-11' }, { user: 'b', day: '2026-10-06' }, { user: 'c', day: '2026-09-20' }]
    expect(activeUsers(activity, '2026-10-11')).toEqual({ dau: 1, wau: 2, mau: 3, stickiness: 33.3 })
  })
})

describe('performance, paths and alerts', () => {
  it('uses nearest-rank p75 and standard thresholds', () => {
    expect(percentile([100, 200, 300, 400], 75)).toBe(300)
    expect(percentile([], 75)).toBeNull()
    expect(vitalRating('LCP', 2500)).toBe('good'); expect(vitalRating('LCP', 4001)).toBe('poor'); expect(vitalRating('CLS', 0.2)).toBe('needs-improvement')
  })
  it('finds events before and after a pivot within sessions', () => {
    const rows = [ev('page_view', '2026-10-10T10:00:00Z', { route: '/signup' }), ev('signup_started', '2026-10-10T10:01:00Z'), ev('signup_completed', '2026-10-10T10:02:00Z')]
    const result = paths(rows, 'signup_started')
    expect(result.before).toEqual([{ key: 'page_view /signup', count: 1 }])
    expect(result.after).toEqual([{ key: 'signup_completed', count: 1 }])
  })
  it('evaluates alert thresholds over the window only', () => {
    const now = new Date('2026-10-10T12:00:00Z')
    const rows = [ev('app_error', '2026-10-10T11:50:00Z'), ev('app_error', '2026-10-10T09:00:00Z')]
    expect(evaluateAlert({ id: 'x', label: 'x', metric: 'errors', comparator: 'above', threshold: 0, windowMinutes: 60 }, rows, now)).toEqual({ value: 1, breached: true })
    expect(evaluateAlert({ id: 'y', label: 'y', metric: 'no_events_minutes', comparator: 'above', threshold: 30, windowMinutes: 60 }, rows, now)).toEqual({ value: 10, breached: false })
  })
})
