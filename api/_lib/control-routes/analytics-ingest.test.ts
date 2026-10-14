import { describe, expect, it } from 'vitest'
import { clampTimestamp, ingestBatch, sanitizeUnknownEventDetail, userRef } from './analytics-ingest.js'

const session = '3f2c9d1e-1111-4222-8333-444455556666'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function fakeAdmin(existing: Set<string> = new Set()) {
  const calls: { rpc: [string, Record<string, unknown>][]; rows: Record<string, unknown>[] } = { rpc: [], rows: [] }
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => { calls.rpc.push([name, args]); return { data: true, error: null } },
    from: () => ({
      upsert: (rows: Record<string, unknown>[]) => ({
        select: async () => {
          const fresh = rows.filter(row => !existing.has(String(row.id)))
          fresh.forEach(row => existing.add(String(row.id)))
          calls.rows.push(...fresh)
          return { data: fresh.map(row => ({ id: row.id })), error: null }
        }
      })
    })
  }
  return { admin: admin as never, calls }
}

const batch = (events: Record<string, unknown>[], context: Record<string, unknown> = {}) => ({ context: { session_id: session, ...context }, events })
const event = (n: number, name = 'page_view', props: Record<string, unknown> = { title: 'Home' }) => ({ id: id(n), name, ts: new Date().toISOString(), source: 'public', route: '/', props })

describe('analytics ingest', () => {
  it('stores allowlisted events, counts unknown ones, and never stores the raw user id', async () => {
    const { admin, calls } = fakeAdmin()
    const user = '9f2c9d1e-1111-4222-8333-444455556666'
    const result = await ingestBatch(admin, batch([event(1), event(2, 'evil_event')], { user_id: user }))
    expect(result).toEqual({ stored: 1, duplicates: 0, unknown: 1 })
    expect(calls.rows[0]?.user_ref).toHaveLength(32)
    expect(JSON.stringify(calls.rows)).not.toContain(user)
    expect(calls.rpc).toContainEqual(['analytics_bump_stat', { p_kind: 'unknown_event', p_detail: 'evil_event', p_count: 1 }])
  })

  it('buckets malformed or HTML/control-character unknown event names under malformed_event_name', async () => {
    const { admin, calls } = fakeAdmin()
    expect(sanitizeUnknownEventDetail('<script>alert(1)</script>')).toBe('malformed_event_name')
    expect(sanitizeUnknownEventDetail('bad name with spaces')).toBe('malformed_event_name')
    await ingestBatch(admin, batch([event(1, '<img src=x onerror=alert(1)>'), event(2, 'bad space')]))
    expect(calls.rpc).toEqual([
      ['analytics_bump_stat', { p_kind: 'unknown_event', p_detail: 'malformed_event_name', p_count: 2 }]
    ])
  })

  it('caps distinct unknown event detail keys per batch to prevent table pollution', async () => {
    const { admin, calls } = fakeAdmin()
    const events = Array.from({ length: 12 }, (_, idx) => event(idx + 1, `unknown_kind_${idx + 1}`))
    await ingestBatch(admin, batch(events))
    const unknownCalls = calls.rpc.filter(([name, args]) => name === 'analytics_bump_stat' && args.p_kind === 'unknown_event')
    expect(unknownCalls.length).toBeLessThanOrEqual(6)
    expect(unknownCalls.some(([, args]) => args.p_detail === 'malformed_event_name')).toBe(true)
  })

  it('strips spoofed context.user_id when Authorization Bearer token fails verification', async () => {
    const { admin, calls } = fakeAdmin()
    const spoofedUser = '9f2c9d1e-1111-4222-8333-444455556666'
    await ingestBatch(admin, batch([event(1)], { user_id: spoofedUser }), Date.now(), {
      hasAuthorizationHeader: true,
      verifiedUserId: null
    })
    expect(calls.rows[0]?.user_ref).toBeNull()
  })

  it('is idempotent: a re-sent event id is a duplicate, not a second row', async () => {
    const { admin, calls } = fakeAdmin()
    await ingestBatch(admin, batch([event(1)]))
    const again = await ingestBatch(admin, batch([event(1), event(3)]))
    expect(again).toEqual({ stored: 1, duplicates: 1, unknown: 0 })
    expect(calls.rows).toHaveLength(2)
  })

  it('rejects malformed batches and oversize batches', async () => {
    const { admin } = fakeAdmin()
    expect(await ingestBatch(admin, { context: { session_id: 'x' }, events: [] })).toBeNull()
    expect(await ingestBatch(admin, batch(Array.from({ length: 26 }, (_, n) => event(n + 1))))).toBeNull()
  })

  it('tags test sessions and groups errors', async () => {
    const { admin, calls } = fakeAdmin()
    await ingestBatch(admin, batch([event(5, 'app_error', { kind: 'error', fingerprint: 'eabc', message: 'Boom' })], { test: true }))
    expect(calls.rows[0]?.is_test).toBe(true)
    expect(calls.rpc.some(([name]) => name === 'analytics_record_error')).toBe(true)
  })

  it('clamps untrustworthy timestamps and hashes ids consistently', () => {
    const now = Date.parse('2026-10-11T00:00:00Z')
    expect(clampTimestamp('2020-01-01T00:00:00Z', now)).toBe('2026-10-11T00:00:00.000Z')
    expect(clampTimestamp('2026-10-10T23:00:00Z', now)).toBe('2026-10-10T23:00:00.000Z')
    expect(userRef('ABC', 's')).toBe(userRef('abc', 's'))
    expect(userRef('abc', 's')).not.toBe(userRef('abc', 't'))
  })
})
