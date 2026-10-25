import { describe, expect, it } from 'vitest'
import { istDayStart, strackerUsedToday, takeStrackerSlot, DEFAULT_SITE_AI_SETTINGS } from './stracker-default.js'

const USER = '00000000-0000-4000-8000-000000000001'
const ist = (local: string) => Date.parse(`${local}+05:30`)

/** In-memory ai_rate_events + the two rate RPCs, mirroring the SQL (IST calendar day for the daily cap). */
function fakeAdmin(clock: () => number) {
  const events: Array<{ user_id: string; bucket: string; created_at: string }> = []
  return {
    events,
    rpc: async (name: string, args: Record<string, unknown>) => {
      const now = clock()
      const since = name === 'ai_take_daily_slot' ? istDayStart(now).getTime() : now - Number(args.window_seconds) * 1000
      const taken = events.filter(event => event.user_id === args.owner && event.bucket === args.bucket && Date.parse(event.created_at) >= since).length
      if (taken >= Number(args.per_user_limit)) return { data: false, error: null }
      events.push({ user_id: String(args.owner), bucket: String(args.bucket), created_at: new Date(now).toISOString() })
      return { data: true, error: null }
    },
    from: () => {
      const filters: Array<(row: Record<string, string>) => boolean> = []
      const query = {
        select: () => query,
        eq: (key: string, value: string) => { filters.push(row => row[key] === value); return query },
        gte: (key: string, value: string) => { filters.push(row => Date.parse(row[key]!) >= Date.parse(value)); return query },
        then: (resolve: (value: { count: number }) => void) => resolve({ count: events.filter(row => filters.every(filter => filter(row as unknown as Record<string, string>))).length })
      }
      return query
    }
  }
}

describe('Stracker AI daily limit resets at 12:00 AM IST', () => {
  it('computes the IST day start around midnight', () => {
    expect(istDayStart(ist('2026-10-26T23:59:59')).toISOString()).toBe('2026-10-25T18:30:00.000Z')
    expect(istDayStart(ist('2026-10-27T00:00:00')).toISOString()).toBe('2026-10-26T18:30:00.000Z')
    // 05:00 IST is still the same IST day (a UTC bucket would wrongly start at 05:30 IST).
    expect(istDayStart(ist('2026-10-27T05:00:00')).toISOString()).toBe('2026-10-26T18:30:00.000Z')
  })

  it('yesterday’s requests do not carry over: 23:59 IST counts, 00:00 IST starts fresh', async () => {
    let now = ist('2026-10-26T23:58:00')
    const admin = fakeAdmin(() => now)
    const settings = { ...DEFAULT_SITE_AI_SETTINGS, perUserPerMinute: 60, perUserDaily: 3 }
    expect(await takeStrackerSlot(admin as never, USER, settings)).toBe('ok')
    now = ist('2026-10-26T23:59:30')
    expect(await takeStrackerSlot(admin as never, USER, settings)).toBe('ok')
    expect(await strackerUsedToday(admin as never, USER, now)).toBe(2)
    now = ist('2026-10-27T00:00:00')
    expect(await strackerUsedToday(admin as never, USER, now)).toBe(0)
    for (let index = 0; index < 3; index += 1) {
      now += 61_000
      expect(await takeStrackerSlot(admin as never, USER, settings)).toBe('ok')
    }
    now += 61_000
    expect(await takeStrackerSlot(admin as never, USER, settings)).toBe('day')
    expect(await strackerUsedToday(admin as never, USER, now)).toBe(3)
    expect(admin.events.filter(event => event.bucket === 'stracker_day')).toHaveLength(5) // nothing deleted
  })

  it('reports unavailable when the counter cannot be reached', async () => {
    const admin = { rpc: async () => ({ data: null, error: { message: 'down' } }) }
    expect(await takeStrackerSlot(admin as never, USER, DEFAULT_SITE_AI_SETTINGS)).toBe('unavailable')
  })
})
