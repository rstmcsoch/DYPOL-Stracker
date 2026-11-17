import { beforeEach, describe, expect, it, vi } from 'vitest'

const world = vi.hoisted(() => ({
  bans: [] as Array<{ user_id: string; banned_until: string | null }>,
  banError: null as { code: string; message: string } | null,
  user: { id: '11111111-1111-4111-8111-111111111111' } as { id: string } | null
}))

vi.mock('./server-config.js', () => ({
  supabaseServerConfig: () => ({ ok: true, config: { url: 'https://example.supabase.co', anonKey: 'anon', serviceRoleKey: 'service' } })
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => world.user ? { data: { user: world.user }, error: null } : { data: { user: null }, error: { message: 'bad' } } },
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => { filters[column] = value; return chain },
        maybeSingle: async () => {
          if (table !== 'account_bans') return { data: null, error: null }
          if (world.banError) return { data: null, error: world.banError }
          return { data: world.bans.find(row => row.user_id === filters.user_id) ?? null, error: null }
        }
      }
      return chain
    }
  })
}))

import { authenticateRequest, banIsActive } from './supabase.js'

const req = { headers: { authorization: 'Bearer token' } } as unknown as Parameters<typeof authenticateRequest>[0]
const USER = '11111111-1111-4111-8111-111111111111'

describe('AI endpoints refuse banned accounts', () => {
  beforeEach(() => { world.bans = []; world.banError = null; world.user = { id: USER } })

  it('banIsActive handles permanent, future, past and missing bans', () => {
    const now = Date.parse('2026-11-17T00:00:00Z')
    expect(banIsActive(null, now)).toBe(false)
    expect(banIsActive({ banned_until: null }, now)).toBe(true)
    expect(banIsActive({ banned_until: '2026-11-18T00:00:00Z' }, now)).toBe(true)
    expect(banIsActive({ banned_until: '2026-11-16T00:00:00Z' }, now)).toBe(false)
    expect(banIsActive({ banned_until: 'not-a-date' }, now)).toBe(true)
  })

  it('lets an account without a ban through', async () => {
    await expect(authenticateRequest(req)).resolves.toMatchObject({ userId: USER })
  })

  it('lets an account whose ban has ended through', async () => {
    world.bans = [{ user_id: USER, banned_until: '2000-01-01T00:00:00Z' }]
    await expect(authenticateRequest(req)).resolves.toMatchObject({ userId: USER })
  })

  it('refuses a permanently banned account with 403', async () => {
    world.bans = [{ user_id: USER, banned_until: null }]
    await expect(authenticateRequest(req)).rejects.toMatchObject({ status: 403, code: 'account_restricted' })
  })

  it('refuses a temporarily banned account with 403', async () => {
    world.bans = [{ user_id: USER, banned_until: new Date(Date.now() + 3_600_000).toISOString() }]
    await expect(authenticateRequest(req)).rejects.toMatchObject({ status: 403, code: 'account_restricted' })
  })

  it('fails closed when the ban lookup errors', async () => {
    world.banError = { code: 'XX000', message: 'down' }
    await expect(authenticateRequest(req)).rejects.toMatchObject({ status: 503, code: 'auth_unavailable' })
  })

  it('still refuses a missing or invalid session first', async () => {
    world.user = null
    await expect(authenticateRequest(req)).rejects.toMatchObject({ status: 401, code: 'unauthenticated' })
  })
})
