import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Exercises the real console endpoints against a scripted Supabase client. The fake client
 * decides which JWT claims, role rows and rate results exist, so every test checks what the
 * server does with them: 401 / 403 / 409 / 429 / 503 and whether a write was attempted.
 */
const world = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  claimsError: null as unknown,
  roles: {} as Record<string, Record<string, unknown> | null>,
  roleError: null as unknown,
  rateAllowed: true,
  users: {} as Record<string, { id: string; email: string; banned_until?: string | null; app_metadata?: Record<string, unknown> }>,
  writes: [] as Array<{ table: string; row: Record<string, unknown> }>,
  updates: [] as Array<{ id: string; attributes: Record<string, unknown> }>,
  updateError: null as unknown
}))

vi.mock('@supabase/supabase-js', () => {
  const admin = {
    rpc: async (name: string) => ({ data: name === 'control_take_rate_slot' ? world.rateAllowed : null, error: null }),
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, value: string) => ({
          maybeSingle: async () => ({ data: table === 'control_roles' ? world.roles[value] ?? null : null, error: table === 'control_roles' ? world.roleError : null })
        }),
        order: () => ({ limit: async () => ({ data: [], error: null }) })
      }),
      insert: async (row: Record<string, unknown>) => {
        world.writes.push({ table, row })
        return { error: null }
      }
    }),
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: world.users[id] ?? null }, error: world.users[id] ? null : { message: 'not found' } }),
        updateUserById: async (id: string, attributes: Record<string, unknown>) => {
          world.updates.push({ id, attributes })
          return { error: world.updateError }
        }
      }
    }
  }
  const authClient = { auth: { getClaims: async () => ({ data: world.claims ? { claims: world.claims } : null, error: world.claimsError }) } }
  return {
    createClient: (_url: string, key: string) => (key === 'service-test-key' ? admin : authClient)
  }
})

vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co')
vi.stubEnv('SUPABASE_ANON_KEY', 'anon-test-key')
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-key')

const OWNER = '11111111-1111-4111-8111-111111111111'
const STUDENT = '22222222-2222-4222-8222-222222222222'
const TARGET = '33333333-3333-4333-8333-333333333333'

interface FakeResponse { statusCode: number; headers: Record<string, string>; body: unknown; setHeader: (k: string, v: string) => void; end: (chunk?: string) => void; headersSent: boolean }

function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: 200,
    headers: {},
    body: undefined,
    headersSent: false,
    setHeader(key, value) { res.headers[key.toLowerCase()] = value },
    end(chunk) { res.headersSent = true; res.body = chunk ? safeParse(chunk) : undefined }
  }
  return res
}
function safeParse(text: string): unknown { try { return JSON.parse(text) } catch { return text } }

function request(method: string, url: string, body?: unknown, token: string | null = 'valid-token') {
  return {
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
    socket: { remoteAddress: '203.0.113.7' }
  } as never
}

const nowSeconds = () => Math.floor(Date.now() / 1000)
const claimsFor = (sub: string, aal: string, totpAgeSeconds: number | null) => ({
  sub,
  role: 'authenticated',
  aal,
  amr: totpAgeSeconds === null ? [{ method: 'password', timestamp: nowSeconds() - 60 }] : [{ method: 'password', timestamp: nowSeconds() - 3600 }, { method: 'totp', timestamp: nowSeconds() - totpAgeSeconds }]
})

async function call(path: string, req: unknown) {
  const mod = (await import(`./${path}.ts`)) as { default: (req: never, res: never) => Promise<void> }
  const res = fakeResponse()
  await mod.default(req as never, res as never)
  return res
}

beforeEach(() => {
  world.claims = null
  world.claimsError = null
  world.roles = { [OWNER]: { role: 'owner', revoked_at: null } }
  world.roleError = null
  world.rateAllowed = true
  world.writes = []
  world.updates = []
  world.updateError = null
  world.users = {
    [OWNER]: { id: OWNER, email: 'dypollabs@gmail.com' },
    [STUDENT]: { id: STUDENT, email: 'student@example.com' },
    [TARGET]: { id: TARGET, email: 'target@example.com' }
  }
})

describe('console authentication and authorization', () => {
  it('answers 401 to a request with no bearer token', async () => {
    const res = await call('session', request('GET', '/api/control/session', undefined, null))
    expect(res.statusCode).toBe(401)
    expect(res.headers['x-robots-tag']).toContain('noindex')
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('answers 401 for a token the Auth server rejects, without any role lookup', async () => {
    world.claimsError = new Error('invalid JWT')
    const res = await call('session', request('GET', '/api/control/session'))
    expect(res.statusCode).toBe(401)
  })

  it('answers 401 for a token whose subject is not a UUID', async () => {
    world.claims = { sub: 'owner', role: 'authenticated', aal: 'aal2', amr: [] }
    const res = await call('session', request('GET', '/api/control/session'))
    expect(res.statusCode).toBe(401)
  })

  it('answers 401 for a token whose role claim is not authenticated', async () => {
    world.claims = { sub: STUDENT, role: 'anon', aal: 'aal2', amr: [] }
    const res = await call('session', request('GET', '/api/control/session'))
    expect(res.statusCode).toBe(401)
  })

  it('denies an ordinary authenticated account with a neutral message and records a bounded denied event', async () => {
    world.claims = claimsFor(STUDENT, 'aal2', 60)
    world.roles = {}
    const res = await call('overview', request('GET', '/api/control/overview'))
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ error: 'access_not_granted', message: 'Access not granted.' })
    expect(JSON.stringify(res.body)).not.toMatch(/owner|admin|role|secret/i)
    const denied = world.writes.find(write => write.table === 'control_audit_events')
    expect(denied?.row).toMatchObject({ action: 'control.access', result: 'denied', actor_id: STUDENT })
  })

  it('treats a revoked owner row exactly like no role', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    world.roles = { [OWNER]: { role: 'owner', revoked_at: '2026-10-01T00:00:00Z' } }
    const res = await call('users', request('GET', '/api/control/users'))
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ error: 'access_not_granted' })
  })

  it('fails closed when the role lookup itself errors', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    world.roleError = { message: 'db down', code: '08006' }
    const res = await call('users', request('GET', '/api/control/users'))
    expect(res.statusCode).toBe(503)
    expect(res.body).toMatchObject({ error: 'control_unavailable' })
  })

  it('lets the owner at aal1 learn only that MFA is required, not any console data', async () => {
    world.claims = claimsFor(OWNER, 'aal1', null)
    const session = await call('session', request('GET', '/api/control/session'))
    expect(session.statusCode).toBe(200)
    expect(session.body).toMatchObject({ status: 'mfa_required', aal: 'aal1' })
    expect(JSON.stringify(session.body)).not.toMatch(/email|displayName|tests|users/)

    const data = await call('users', request('GET', '/api/control/users'))
    expect(data.statusCode).toBe(403)
    expect(data.body).toMatchObject({ error: 'mfa_required' })
  })

  it('grants the console to the owner at aal2', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const session = await call('session', request('GET', '/api/control/session'))
    expect(session.body).toMatchObject({ status: 'granted', role: 'owner', userId: OWNER, recentMfa: true })
  })

  it('rejects a method the endpoint does not support, before any work', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const res = await call('users', request('POST', '/api/control/users', {}))
    expect(res.statusCode).toBe(405)
  })

  it('returns 429 when the account rate limit is exhausted', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    world.rateAllowed = false
    const res = await call('users', request('GET', '/api/control/users'))
    expect(res.statusCode).toBe(429)
    expect(res.body).toMatchObject({ error: 'rate_limited' })
  })
})

describe('account access changes', () => {
  const suspendBody = (overrides: Record<string, unknown> = {}) => ({
    userId: TARGET,
    action: 'suspend',
    reason: 'Repeated abusive sign-up attempts',
    confirmEmail: 'target@example.com',
    ...overrides
  })

  it('refuses a suspension without a recent authenticator verification and makes no change', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 3 * 60 * 60)
    const res = await call('user-access', request('POST', '/api/control/user-access', suspendBody()))
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ error: 'reauthentication_required' })
    expect(world.updates).toHaveLength(0)
  })

  it('refuses a suspension when the session has no TOTP verification at all', async () => {
    world.claims = claimsFor(OWNER, 'aal2', null)
    const res = await call('user-access', request('POST', '/api/control/user-access', suspendBody()))
    expect(res.statusCode).toBe(403)
    expect(world.updates).toHaveLength(0)
  })

  it('refuses an aal1 session even with a recent password sign-in', async () => {
    world.claims = claimsFor(OWNER, 'aal1', null)
    const res = await call('user-access', request('POST', '/api/control/user-access', suspendBody()))
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ error: 'mfa_required' })
  })

  it('suspends with a fresh TOTP, a reason, and a matching typed email, then audits it', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const res = await call('user-access', request('POST', '/api/control/user-access', suspendBody()))
    expect(res.statusCode).toBe(200)
    expect(world.updates).toEqual([{ id: TARGET, attributes: { ban_duration: '876000h' } }])
    const audit = world.writes.find(write => write.table === 'control_audit_events')
    expect(audit?.row).toMatchObject({ action: 'user.suspend', result: 'success', target_id: TARGET, actor_id: OWNER })
    expect(JSON.stringify(audit?.row)).not.toMatch(/token|password|totp/i)
  })

  it('requires the target email to be typed correctly before changing anything', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const res = await call('user-access', request('POST', '/api/control/user-access', suspendBody({ confirmEmail: 'someone-else@example.com' })))
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ error: 'confirmation_mismatch' })
    expect(world.updates).toHaveLength(0)
  })

  it('will not let the owner suspend their own account', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const res = await call('user-access', request('POST', '/api/control/user-access', suspendBody({ userId: OWNER, confirmEmail: 'dypollabs@gmail.com' })))
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ error: 'self_action_blocked' })
    expect(world.updates).toHaveLength(0)
  })

  it('protects other administrator accounts from suspension through the console', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    world.roles[TARGET] = { role: 'administrator', revoked_at: null }
    const res = await call('user-access', request('POST', '/api/control/user-access', suspendBody()))
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ error: 'owner_protected' })
    expect(world.updates).toHaveLength(0)
  })

  it('rejects unexpected body fields such as a role grant attempt', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const res = await call('user-access', request('POST', '/api/control/user-access', { ...suspendBody(), role: 'owner', banned_until: null }))
    expect(res.statusCode).toBe(400)
    expect(world.updates).toHaveLength(0)
  })

  it('rejects a short or missing reason', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const res = await call('user-access', request('POST', '/api/control/user-access', suspendBody({ reason: 'no' })))
    expect(res.statusCode).toBe(400)
    expect(world.updates).toHaveLength(0)
  })

  it('rejects malformed target identifiers', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const res = await call('user-access', request('POST', '/api/control/user-access', suspendBody({ userId: "' OR 1=1 --" })))
    expect(res.statusCode).toBe(400)
  })

  it('does not report success when the authentication service refuses the change', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    world.updateError = { message: 'upstream' }
    const res = await call('user-access', request('POST', '/api/control/user-access', suspendBody()))
    expect(res.statusCode).toBe(502)
    expect(res.body).toMatchObject({ error: 'auth_update_failed' })
    const audit = world.writes.find(write => write.table === 'control_audit_events')
    expect(audit?.row).toMatchObject({ result: 'error' })
  })

  it('reports no-op requests as conflicts instead of re-applying them', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    world.users[TARGET] = { id: TARGET, email: 'target@example.com', banned_until: new Date(Date.now() + 86_400_000).toISOString() }
    const res = await call('user-access', request('POST', '/api/control/user-access', suspendBody()))
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ error: 'no_change' })
  })
})

describe('audit export and reads', () => {
  it('refuses a CSV export without a recent verification', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 2 * 60 * 60)
    const res = await call('audit', request('GET', '/api/control/audit?format=csv'))
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ error: 'reauthentication_required' })
  })

  it('rejects unknown audit filter values instead of passing them to the database', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const res = await call('audit', request('GET', `/api/control/audit?outcome=${encodeURIComponent("success' OR '1'='1")}`))
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ error: 'invalid_filter' })
  })

  it('rejects a malformed target filter', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const res = await call('audit', request('GET', '/api/control/audit?target=%27%20or%201%3D1'))
    expect(res.statusCode).toBe(400)
  })

  it('validates the user detail identifier before any lookup', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const res = await call('user', request('GET', '/api/control/user?id=not-a-uuid'))
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 for an unknown account identifier', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const res = await call('user', request('GET', '/api/control/user?id=99999999-9999-4999-8999-999999999999'))
    expect(res.statusCode).toBe(404)
  })
})
