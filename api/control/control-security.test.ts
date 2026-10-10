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
  /** Per-bucket overrides for the rate limiter (bucket name → allowed). */
  rateByBucket: {} as Record<string, boolean>,
  rateCalls: [] as Array<{ key: string; bucket: string; limit: number; window: number }>,
  users: {} as Record<string, { id: string; email: string; banned_until?: string | null; app_metadata?: Record<string, unknown> }>,
  /** List rows returned for a table (audit reads). */
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  /** Optional read error for a table. */
  readError: {} as Record<string, unknown>,
  /** Every chained query, so tests can assert which filters reached the database. */
  queries: [] as Array<{ table: string; filters: Array<[string, string, string]>; range?: [number, number]; limit?: number }>,
  writes: [] as Array<{ table: string; row: Record<string, unknown> }>,
  writeError: null as unknown,
  updates: [] as Array<{ id: string; attributes: Record<string, unknown> }>,
  updateError: null as unknown
}))

vi.mock('@supabase/supabase-js', () => {
  /** Minimal chainable PostgREST stand-in: records filters, resolves scripted rows. */
  function builder(table: string) {
    const record: { table: string; filters: Array<[string, string, string]>; range?: [number, number]; limit?: number } = { table, filters: [] }
    world.queries.push(record)
    const result = () => ({ data: world.rows[table] ?? [], error: world.readError[table] ?? null, count: (world.rows[table] ?? []).length })
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, {
      select: self,
      order: self,
      range: (from: number, to: number) => { record.range = [from, to]; return chain },
      limit: (value: number) => { record.limit = value; return chain },
      eq: (column: string, value: string) => { record.filters.push(['eq', column, value]); return chain },
      gte: (column: string, value: string) => { record.filters.push(['gte', column, value]); return chain },
      lt: (column: string, value: string) => { record.filters.push(['lt', column, value]); return chain },
      in: self,
      maybeSingle: async () => {
        if (table === 'control_roles') {
          const id = record.filters.find(([, column]) => column === 'user_id')?.[2] ?? ''
          return { data: world.roles[id] ?? null, error: world.roleError }
        }
        return { data: null, error: null }
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
      insert: async (row: Record<string, unknown>) => {
        world.writes.push({ table, row })
        return { error: world.writeError }
      }
    })
    return chain
  }
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'control_take_rate_slot') return { data: null, error: null }
      const bucket = String(args.bucket)
      world.rateCalls.push({ key: String(args.actor_key), bucket, limit: Number(args.per_limit), window: Number(args.window_seconds) })
      const allowed = bucket in world.rateByBucket ? world.rateByBucket[bucket] : world.rateAllowed
      return { data: allowed, error: null }
    },
    from: (table: string) => builder(table),
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
  const mod = (await import(`../_lib/control-routes/${path}.ts`)) as { default: (req: never, res: never) => Promise<void> }
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
  world.rateByBucket = {}
  world.rateCalls = []
  world.rows = {}
  world.readError = {}
  world.queries = []
  world.writes = []
  world.writeError = null
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

  it('grants the console to the owner at aal2 and records the access once per Auth session', async () => {
    world.claims = { ...claimsFor(OWNER, 'aal2', 60), session_id: 'sess-1' }
    const session = await call('session', request('GET', '/api/control/session'))
    expect(session.body).toMatchObject({ status: 'granted', role: 'owner', userId: OWNER, recentMfa: true })
    const granted = world.writes.filter(write => write.row.action === 'control.access' && write.row.result === 'success')
    expect(granted).toHaveLength(1)
    expect(granted[0]?.row).toMatchObject({ actor_id: OWNER, actor_role: 'owner', target_type: 'control_panel' })
    expect(JSON.stringify(granted[0]?.row)).not.toMatch(/sess-1|token|bearer/)

    // The latch refuses a second slot: a token refresh or reload does not duplicate the row.
    world.rateByBucket['console-session'] = false
    await call('session', request('GET', '/api/control/session'))
    expect(world.writes.filter(write => write.row.action === 'control.access' && write.row.result === 'success')).toHaveLength(1)
  })

  it('does not record an access event for the pre-MFA session check, but does for an aal1 data request', async () => {
    world.claims = claimsFor(OWNER, 'aal1', null)
    await call('session', request('GET', '/api/control/session'))
    expect(world.writes).toHaveLength(0)
    const data = await call('audit', request('GET', '/api/control/audit'))
    expect(data.statusCode).toBe(403)
    expect(world.writes.find(write => write.row.action === 'control.access')?.row).toMatchObject({ result: 'denied', error_category: 'mfa_required', actor_id: OWNER })
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

  it('protects other administrator accounts from suspension through the console, and records the refusal', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    world.roles[TARGET] = { role: 'administrator', revoked_at: null }
    const res = await call('user-access', request('POST', '/api/control/user-access', suspendBody()))
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ error: 'owner_protected' })
    expect(world.updates).toHaveLength(0)
    expect(world.writes.find(write => write.row.action === 'user.suspend')?.row).toMatchObject({ result: 'denied', error_category: 'owner_protected', target_id: TARGET, actor_id: OWNER })
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
  it('loads the default audit page when the browser sends every filter empty or as "all"', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const res = await call('audit', request('GET', '/api/control/audit?outcome=all&action=&target=&from=&to=&page=1&pageSize=50'))
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ events: [], total: 0, page: 1, pageSize: 50 })
    const read = world.queries.find(query => query.table === 'control_audit_events')
    expect(read?.filters).toEqual([])
  })

  it('loads the audit page with no query string at all', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const res = await call('audit', request('GET', '/api/control/audit'))
    expect(res.statusCode).toBe(200)
  })

  it('refuses a CSV export without a recent verification', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 2 * 60 * 60)
    const res = await call('audit', request('GET', '/api/control/audit?format=csv'))
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ error: 'reauthentication_required' })
  })

  it('rejects unknown audit filter values instead of passing them to the database, naming the field', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const res = await call('audit', request('GET', `/api/control/audit?outcome=${encodeURIComponent("success' OR '1'='1")}`))
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ error: 'invalid_filter', reason: 'field:outcome' })
    expect(String((res.body as { message: string }).message)).toMatch(/Outcome filter is not valid/)
    expect(JSON.stringify(res.body)).not.toMatch(/stack|postgres|supabase|service/i)
    expect(world.queries.filter(query => query.table === 'control_audit_events')).toHaveLength(0)
    // Validation failures go to the server log, never to the audit table.
    expect(world.writes).toHaveLength(0)
  })

  it('rejects a malformed target filter and an inverted date range with the right field', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const target = await call('audit', request('GET', '/api/control/audit?target=%27%20or%201%3D1'))
    expect(target.statusCode).toBe(400)
    expect(target.body).toMatchObject({ reason: 'field:target' })
    const dates = await call('audit', request('GET', '/api/control/audit?from=2026-10-10&to=2026-10-01'))
    expect(dates.body).toMatchObject({ error: 'invalid_filter', reason: 'field:to' })
    const badDay = await call('audit', request('GET', '/api/control/audit?from=2026-02-30'))
    expect(badDay.body).toMatchObject({ reason: 'field:from' })
  })

  it('applies date filters as whole calendar days in the requested zone, To inclusive', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const res = await call('audit', request('GET', '/api/control/audit?from=2026-10-04&to=2026-10-10&tz=Asia%2FKolkata&outcome=denied'))
    expect(res.statusCode).toBe(200)
    const read = world.queries.find(query => query.table === 'control_audit_events')
    expect(read?.filters).toEqual([
      ['eq', 'result', 'denied'],
      ['gte', 'created_at', '2026-10-03T18:30:00.000Z'],
      ['lt', 'created_at', '2026-10-10T18:30:00.000Z']
    ])
    expect(res.body).toMatchObject({ filters: { timeZone: 'Asia/Kolkata', from: '2026-10-04', to: '2026-10-10' } })
  })

  it('falls back to UTC for an unknown zone instead of failing the request', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    const res = await call('audit', request('GET', '/api/control/audit?to=2026-10-10&tz=Mars%2FOlympus'))
    expect(res.statusCode).toBe(200)
    const read = world.queries.find(query => query.table === 'control_audit_events')
    expect(read?.filters).toEqual([['lt', 'created_at', '2026-10-11T00:00:00.000Z']])
  })

  it('exports exactly the filtered rows with a fresh verification, and records the export', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    world.rows.control_audit_events = [{ id: '1', created_at: '2026-10-10T02:47:03.000Z', action: 'user.viewed', result: 'success', actor_id: OWNER, actor_role: 'owner', target_type: 'user', target_id: TARGET, error_category: null, reason: null, request_id: 'ctl_x', before_summary: null, after_summary: null }]
    const res = await call('audit', request('GET', '/api/control/audit?format=csv&action=user.viewed&tz=Asia%2FKolkata'))
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    const csv = String(res.body)
    expect(csv.split('\r\n')[0]).toBe('occurred_at_utc,occurred_at_local,time_zone,action,outcome,severity,actor_id,actor_role,target_type,target_id,error_code,reason,request_id,summary')
    expect(csv).toContain('2026-10-10T02:47:03.000Z,2026-10-10 08:17:03,Asia/Kolkata,user.viewed,success')
    const read = world.queries.find(query => query.table === 'control_audit_events' && query.limit === 5000)
    expect(read?.filters).toEqual([['eq', 'action', 'user.viewed']])
    const exported = world.writes.find(write => write.row.action === 'audit.export')
    expect(exported?.row).toMatchObject({ result: 'success', actor_id: OWNER, target_type: 'audit_log' })
    expect(JSON.stringify(exported?.row)).not.toMatch(/token|password|totp|bearer/i)
  })

  it('records a failed export when the database read fails, and returns a safe error', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 60)
    world.readError.control_audit_events = { message: 'relation missing', code: '42P01' }
    const res = await call('audit', request('GET', '/api/control/audit?format=csv'))
    expect(res.statusCode).toBe(503)
    expect(res.body).toMatchObject({ error: 'audit_unavailable' })
    expect(JSON.stringify(res.body)).not.toMatch(/relation|42P01/)
    expect(world.writes.find(write => write.row.action === 'audit.export')?.row).toMatchObject({ result: 'error', error_category: 'audit_unavailable' })
  })

  it('records a refused export (stale verification) as a bounded denied event', async () => {
    world.claims = claimsFor(OWNER, 'aal2', 2 * 60 * 60)
    const res = await call('audit', request('GET', '/api/control/audit?format=csv'))
    expect(res.statusCode).toBe(403)
    expect(world.writes.find(write => write.row.action === 'audit.export')?.row).toMatchObject({ result: 'denied', error_category: 'recent_mfa_required', actor_id: OWNER })
    expect(world.rateCalls.some(call => call.bucket === 'denied-access')).toBe(true)
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
