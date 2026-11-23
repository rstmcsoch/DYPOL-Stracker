import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { authenticateCredential, SupabaseCredentialStore } from '../_lib/mcp/credentials.js'
import { IMPLEMENTED_MASTER_TOOL_NAMES } from '../_lib/mcp/registry.js'

/**
 * Owner-only Master MCP connection management against an in-memory Supabase stand-in.
 * The update builder returns the patched row so revoke() can detect success.
 */
type Row = Record<string, unknown>
const world = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  db: {} as Record<string, Row[]>,
  missing: new Set<string>(),
  users: {} as Record<string, { id: string; email: string }>
}))

vi.mock('@supabase/supabase-js', () => {
  function match(row: Row, filters: Array<[string, string, unknown]>) {
    return filters.every(([op, column, value]) => {
      if (op === 'eq') return row[column] === value
      if (op === 'neq') return row[column] !== value
      if (op === 'in') return (value as unknown[]).includes(row[column])
      if (op === 'gte') return String(row[column] ?? '') >= String(value)
      if (op === 'lte') return String(row[column] ?? '') <= String(value)
      return true
    })
  }
  function builder(table: string) {
    const filters: Array<[string, string, unknown]> = []
    let mode: 'select' | 'update' | 'delete' = 'select'
    let patch: Row = {}
    const rows = () => (world.db[table] ??= [])
    const missing = () => world.missing.has(table)
    const run = () => {
      if (missing()) return { data: null, error: { code: '42P01', message: 'relation "public.' + table + '" does not exist' } }
      if (mode === 'update') {
        const updated: Row[] = []
        for (const row of rows().filter(item => match(item, filters))) {
          Object.assign(row, patch)
          updated.push(row)
        }
        return { data: updated, error: null }
      }
      if (mode === 'delete') {
        world.db[table] = rows().filter(item => !match(item, filters))
        return { data: null, error: null }
      }
      return { data: rows().filter(item => match(item, filters)), error: null }
    }
    const chain: Record<string, unknown> = {}
    Object.assign(chain, {
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      range: () => chain,
      eq: (column: string, value: unknown) => { filters.push(['eq', column, value]); return chain },
      neq: (column: string, value: unknown) => { filters.push(['neq', column, value]); return chain },
      in: (column: string, value: unknown) => { filters.push(['in', column, value]); return chain },
      gte: (column: string, value: unknown) => { filters.push(['gte', column, value]); return chain },
      lte: (column: string, value: unknown) => { filters.push(['lte', column, value]); return chain },
      update: (value: Row) => { mode = 'update'; patch = value; return chain },
      delete: () => { mode = 'delete'; return chain },
      maybeSingle: async () => {
        const result = run()
        if (result.error) return { data: null, error: result.error }
        const data = result.data as Row[] | null
        return { data: data?.[0] ?? null, error: null }
      },
      then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
      insert: async (input: Row | Row[]) => {
        if (missing()) return { error: { code: '42P01', message: 'relation does not exist' } }
        const list = Array.isArray(input) ? input : [input]
        if (table === 'control_step_up_uses') {
          for (const row of list) {
            if (rows().some(item => item.user_id === row.user_id && item.session_id === row.session_id && item.mfa_at === row.mfa_at)) {
              return { error: { code: '23505', message: 'duplicate' } }
            }
          }
        }
        rows().push(...list.map(row => ({ ...row })))
        return { error: null }
      }
    })
    return chain
  }
  const admin = {
    from: (table: string) => builder(table),
    rpc: async () => ({ data: true, error: null }),
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: world.users[id] ?? null }, error: null })
      }
    }
  }
  const authClient = { auth: { getClaims: async () => ({ data: world.claims ? { claims: world.claims } : null, error: world.claims ? null : new Error('no') }) } }
  return { createClient: (_url: string, key: string) => (key === 'service-test-key' ? admin : authClient) }
})

vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co')
vi.stubEnv('SUPABASE_ANON_KEY', 'anon-test-key')
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-key')

const OWNER = '11111111-1111-4111-8111-111111111111'
const ADMIN = '22222222-2222-4222-8222-222222222222'
const now = () => Math.floor(Date.now() / 1000)

function claims(sub: string, opts: { aal?: string; mfaAgo?: number | null; session?: string } = {}) {
  const mfaAgo = opts.mfaAgo === undefined ? 30 : opts.mfaAgo
  return {
    sub, role: 'authenticated', aal: opts.aal ?? 'aal2', session_id: opts.session ?? `sess-${sub.slice(0, 4)}`,
    amr: mfaAgo === null ? [{ method: 'password', timestamp: now() - 4000 }] : [{ method: 'password', timestamp: now() - 4000 }, { method: 'totp', timestamp: now() - mfaAgo }]
  }
}

function fakeRes() {
  const res = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string>, headersSent: false,
    setHeader(k: string, v: string) { res.headers[k.toLowerCase()] = v },
    end(chunk?: string) { res.body = chunk ? JSON.parse(chunk) : undefined } }
  return res
}

async function call(method: 'GET' | 'POST', body?: unknown, headers: Record<string, string> = {}) {
  const file = 'security'
  const mod = (await import(`./${file}.ts`)) as { default: (req: never, res: never) => Promise<void> }
  const res = fakeRes()
  const req = {
    method,
    url: '/api/control/security?route=master-mcp',
    headers: {
      authorization: 'Bearer t',
      host: 'stracker-git-feat-master-mcp-dypollabs.vercel.app',
      'x-forwarded-proto': 'https',
      ...headers
    },
    body,
    socket: { remoteAddress: '203.0.113.1' }
  }
  await mod.default(req as never, res as never)
  return res
}

function store() {
  return new SupabaseCredentialStore(createClient('https://project.supabase.co', 'service-test-key'))
}

function seed() {
  world.claims = null
  world.missing = new Set()
  world.users = {
    [OWNER]: { id: OWNER, email: 'owner@example.org' },
    [ADMIN]: { id: ADMIN, email: 'admin@example.org' }
  }
  world.db = {
    control_roles: [
      { user_id: OWNER, role: 'owner', revoked_at: null, granted_at: '2026-10-01T00:00:00Z' },
      { user_id: ADMIN, role: 'administrator', revoked_at: null, granted_at: '2026-11-01T00:00:00Z' }
    ],
    control_role_permissions: [{ role: 'administrator', permission: 'settings.site', allowed: true }],
    control_member_permissions: [],
    control_role_removals: [],
    control_step_up_uses: [],
    control_audit_events: [],
    master_mcp_credentials: [],
    master_mcp_audit_events: [],
    master_mcp_rate_events: []
  }
}

beforeEach(() => { seed() })

describe('GET /api/control/master-mcp', () => {
  it('returns the preview endpoint, capability overview, and connections without hashes or raw tokens', async () => {
    world.claims = claims(OWNER)
    const res = await call('GET')
    expect(res.statusCode).toBe(200)
    const body = res.body as Record<string, unknown>
    expect(body.endpointUrl).toBe('https://stracker-git-feat-master-mcp-dypollabs.vercel.app/api/mcp')
    expect(body.transport).toBe('Streamable HTTP (JSON-RPC)')
    expect(body.implementedTools).toEqual([...IMPLEMENTED_MASTER_TOOL_NAMES])
    expect(body.capabilities).toEqual(expect.objectContaining({ studentData: expect.any(String) }))
    expect(body.restricted).toEqual(expect.objectContaining({ rolesAndPermissions: expect.any(String) }))
    expect(Array.isArray(body.securityNotes)).toBe(true)
    expect(JSON.stringify(body)).not.toMatch(/tokenHash|token_hash|stmcp_/)
    expect((body.rateLimits as { authenticatedPerMinute: number }).authenticatedPerMinute).toBe(120)
  })

  it('returns 503 master_mcp_unavailable when the migration is not applied', async () => {
    world.claims = claims(OWNER)
    world.missing.add('master_mcp_credentials')
    const res = await call('GET')
    expect(res.statusCode).toBe(503)
    expect(res.body).toMatchObject({ error: 'master_mcp_unavailable' })
    expect(JSON.stringify(res.body)).not.toMatch(/42P01|does not exist/)
  })

  it('refuses a non-owner with owner_only', async () => {
    world.claims = claims(ADMIN)
    const res = await call('GET')
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ error: 'owner_only' })
  })
})

describe('POST /api/control/master-mcp', () => {
  it('refuses a Master MCP bearer token with 401', async () => {
    const res = await call('POST', { action: 'create', displayName: 'Ops' }, { authorization: 'Bearer stmcp_abcdefghijklmnopqrstuvwx0123456789abcd' })
    expect(res.statusCode).toBe(401)
  })

  it('refuses a non-owner with owner_only and does not issue a token', async () => {
    world.claims = claims(ADMIN)
    const res = await call('POST', { action: 'create', displayName: 'Ops' })
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ error: 'owner_only' })
    expect(JSON.stringify(res.body)).not.toMatch(/stmcp_/)
    expect(world.db.master_mcp_credentials).toHaveLength(0)
  })

  it('requires a fresh step-up before creating a connection', async () => {
    world.claims = claims(OWNER, { mfaAgo: 180 })
    const res = await call('POST', { action: 'create', displayName: 'Ops' })
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ error: 'step_up_required' })
    expect(world.db.master_mcp_credentials).toHaveLength(0)
  })

  it('creates a connection, returns the raw token once, and never lists the hash or token afterwards', async () => {
    world.claims = claims(OWNER)
    const created = await call('POST', { action: 'create', displayName: 'Laptop Claude' })
    expect(created.statusCode).toBe(200)
    const issued = created.body as { ok: true; token: string; tokenHint: string; connection: { id: string; displayName: string } }
    expect(issued.ok).toBe(true)
    expect(issued.token).toMatch(/^stmcp_/)
    expect(issued.connection.displayName).toBe('Laptop Claude')
    expect(JSON.stringify(issued.connection)).not.toMatch(/tokenHash|token_hash/)
    expect(issued.connection).not.toHaveProperty('token')

    const listed = await call('GET')
    expect(listed.statusCode).toBe(200)
    const payload = JSON.stringify(listed.body)
    expect(payload).not.toContain(issued.token)
    expect(payload).not.toMatch(/tokenHash|token_hash/)
    const connections = (listed.body as { connections: Array<{ tokenHint: string; displayName: string }> }).connections
    expect(connections).toEqual([expect.objectContaining({ displayName: 'Laptop Claude', tokenHint: issued.tokenHint, status: 'active' })])

    const audits = (world.db.control_audit_events ?? []).filter(row => row.action === 'master_mcp.create')
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits)).not.toContain(issued.token)
    expect(JSON.stringify(audits)).not.toMatch(/token_hash|tokenHash/)

    expect(await authenticateCredential(store(), issued.token)).toMatchObject({ id: issued.connection.id, status: 'active' })
  })

  it('revokes a connection so the previous token can no longer authenticate', async () => {
    world.claims = claims(OWNER)
    const created = await call('POST', { action: 'create', displayName: 'Rotate me' })
    const issued = created.body as { token: string; connection: { id: string } }
    world.db.control_step_up_uses = []
    const revoked = await call('POST', { action: 'revoke', id: issued.connection.id })
    expect(revoked.statusCode).toBe(200)
    expect((revoked.body as { connection: { status: string } }).connection.status).toBe('revoked')
    expect(JSON.stringify(revoked.body)).not.toContain(issued.token)
    expect(await authenticateCredential(store(), issued.token)).toBeNull()
    expect((world.db.control_audit_events ?? []).some(row => row.action === 'master_mcp.revoke')).toBe(true)
  })

  it('rotates a connection: the old token fails and the new token works', async () => {
    world.claims = claims(OWNER)
    const created = await call('POST', { action: 'create', displayName: 'Keep name' })
    const issued = created.body as { token: string; tokenHint: string; connection: { id: string } }
    world.db.control_step_up_uses = []
    const rotated = await call('POST', { action: 'rotate', id: issued.connection.id })
    expect(rotated.statusCode).toBe(200)
    const next = rotated.body as { token: string; tokenHint: string; connection: { displayName: string; id: string }; revokedId: string }
    expect(next.connection.displayName).toBe('Keep name')
    expect(next.token).toMatch(/^stmcp_/)
    expect(next.token).not.toBe(issued.token)
    expect(next.revokedId).toBe(issued.connection.id)
    expect(await authenticateCredential(store(), issued.token)).toBeNull()
    expect(await authenticateCredential(store(), next.token)).toMatchObject({ id: next.connection.id, status: 'active' })
  })

  it('blocks mutations during owner removal read-only but still allows GET', async () => {
    world.db.control_role_removals = [{
      id: 'r1',
      target_user_id: OWNER,
      target_role: 'owner',
      status: 'countdown',
      initiated_by: ADMIN,
      initiated_at: '2026-11-01T00:00:00Z',
      approved_by: null,
      countdown_started_at: '2026-11-01T00:00:00Z',
      effective_on_ist: '2027-01-01',
      restore_requested_at: null,
      restore_on_ist: null,
      resolved_at: null,
      updated_at: '2026-11-01T00:00:00Z'
    }]
    world.claims = claims(OWNER)
    const get = await call('GET')
    expect(get.statusCode).toBe(200)
    const post = await call('POST', { action: 'create', displayName: 'Blocked' })
    expect(post.statusCode).toBe(403)
    expect(post.body).toMatchObject({ error: 'owner_removal_readonly' })
    expect(world.db.master_mcp_credentials).toHaveLength(0)
  })
})
