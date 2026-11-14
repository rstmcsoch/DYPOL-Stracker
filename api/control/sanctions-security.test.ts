import { beforeEach, describe, expect, it, vi } from 'vitest'
import { banDuration, PERMANENT_BAN_DURATION } from '../_lib/control-routes/user-sanction.js'

/**
 * Warn / ban / unban / delete against an in-memory Supabase stand-in. Every test drives the real
 * route code (accounts dispatcher → controlHandler → user-sanction route).
 */
type Row = Record<string, unknown>
const world = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  db: {} as Record<string, Row[]>,
  users: {} as Record<string, { id: string; email: string } | undefined>,
  authBans: [] as Array<{ id: string; duration: string }>,
  authFail: false,
  deletedUsers: [] as string[],
  sessionsRevoked: [] as string[],
  storage: {} as Record<string, string[]>,
  removed: [] as Array<{ bucket: string; paths: string[] }>,
  failTable: null as string | null
}))

vi.mock('@supabase/supabase-js', () => {
  function match(row: Row, filters: Array<[string, string, unknown]>) {
    return filters.every(([op, column, value]) => op === 'eq' ? row[column] === value : op === 'in' ? (value as unknown[]).includes(row[column]) : true)
  }
  function builder(table: string) {
    const filters: Array<[string, string, unknown]> = []
    let mode: 'select' | 'delete' = 'select'
    let inserted: Row[] | null = null
    const rows = () => (world.db[table] ??= [])
    const failing = () => world.failTable === table ? { message: 'down', code: 'XX000' } : null
    const run = () => {
      if (failing()) return { data: null, error: failing() }
      if (inserted) return { data: inserted, error: null }
      if (mode === 'delete') { world.db[table] = rows().filter(r => !match(r, filters)); return { data: null, error: null } }
      return { data: rows().filter(r => match(r, filters)), error: null }
    }
    const chain: Record<string, unknown> = {}
    Object.assign(chain, {
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return chain },
      in: (c: string, v: unknown) => { filters.push(['in', c, v]); return chain },
      delete: () => { mode = 'delete'; return chain },
      maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error } },
      single: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error } },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
      insert: (input: Row | Row[]) => {
        const list = (Array.isArray(input) ? input : [input]).map((row, i): Row => ({ id: `${table}-${rows().length + i}`, ...row }))
        if (table === 'control_step_up_uses' && list.some(row => rows().some(r => r.user_id === row.user_id && r.session_id === row.session_id && r.mfa_at === row.mfa_at))) {
          return Object.assign(Promise.resolve({ error: { code: '23505', message: 'duplicate' } }), {})
        }
        const error = failing()
        if (!error) rows().push(...list)
        inserted = list
        const result = Promise.resolve({ error })
        return Object.assign(result, { select: () => ({ single: async () => ({ data: error ? null : list[0], error }) }) })
      },
      upsert: async (row: Row) => {
        const error = failing()
        if (error) return { error }
        world.db[table] = rows().filter(r => r.user_id !== row.user_id)
        rows().push({ ...row })
        return { error: null }
      }
    })
    return chain
  }
  const admin = {
    from: (table: string) => builder(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'control_revoke_user_sessions') { world.sessionsRevoked.push(String(args.target)); return { data: 1, error: null } }
      return { data: true, error: null }
    },
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string) => ({
          data: (world.storage[bucket] ?? []).filter(path => path.startsWith(`${prefix}/`)).map(path => ({ id: path, name: path.slice(prefix.length + 1) })),
          error: null
        }),
        remove: async (paths: string[]) => { world.removed.push({ bucket, paths }); world.storage[bucket] = (world.storage[bucket] ?? []).filter(p => !paths.includes(p)); return { error: null } }
      })
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: world.users[id] ?? null }, error: world.users[id] ? null : { message: 'nf' } }),
        updateUserById: async (id: string, attrs: Record<string, unknown>) => {
          if (world.authFail) return { error: { message: 'auth down' } }
          world.authBans.push({ id, duration: String(attrs.ban_duration) })
          return { error: null }
        },
        deleteUser: async (id: string) => { world.deletedUsers.push(id); world.users[id] = undefined; return { error: null } }
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
const STUDENT = '33333333-3333-4333-8333-333333333333'
const MODERATOR = '44444444-4444-4444-8444-444444444444'
const VIEWER = '55555555-5555-4555-8555-555555555555'
const ADMIN2 = '66666666-6666-4666-8666-666666666666'
const now = () => Math.floor(Date.now() / 1000)

function claims(sub: string, opts: { mfaAgo?: number; session?: string } = {}) {
  return {
    sub, role: 'authenticated', aal: 'aal2', session_id: opts.session ?? `sess-${sub.slice(0, 4)}-${Math.random()}`,
    amr: [{ method: 'password', timestamp: now() - 4000 }, { method: 'totp', timestamp: now() - (opts.mfaAgo ?? 20) }]
  }
}

function fakeRes() {
  const res = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string>, headersSent: false,
    setHeader(k: string, v: string) { res.headers[k.toLowerCase()] = v },
    end(chunk?: string) { res.body = chunk ? JSON.parse(chunk) : undefined } }
  return res
}

async function act(actor: string, action: string, body: Row, opts: { mfaAgo?: number; session?: string; queryAction?: string } = {}) {
  world.claims = claims(actor, opts)
  const mod = (await import('./accounts.js')) as { default: (req: never, res: never) => Promise<void> }
  const res = fakeRes()
  const req = { method: 'POST', url: `/api/control/accounts?route=user-sanction&action=${opts.queryAction ?? action}`, headers: { authorization: 'Bearer t' }, body: { action, ...body }, socket: { remoteAddress: '203.0.113.1' } }
  await mod.default(req as never, res as never)
  return res as { statusCode: number; body: Record<string, unknown> }
}

const audits = (action: string, result?: string) => (world.db.control_audit_events ?? []).filter(row => row.action === action && (!result || row.result === result))
const inTwoHours = () => new Date(Date.now() + 2 * 3600 * 1000).toISOString()

beforeEach(() => {
  world.claims = null
  world.authBans = []
  world.authFail = false
  world.deletedUsers = []
  world.sessionsRevoked = []
  world.removed = []
  world.failTable = null
  world.storage = {
    'mistake-images': [`${STUDENT}/a.webp`, `${STUDENT}/b.webp`, `${ADMIN}/keep.webp`],
    'contact-attachments': ['msg-1/0-shot.png', 'msg-other/0-x.png']
  }
  world.users = {
    [OWNER]: { id: OWNER, email: 'owner@example.org' },
    [ADMIN]: { id: ADMIN, email: 'admin@example.org' },
    [ADMIN2]: { id: ADMIN2, email: 'admin2@example.org' },
    [STUDENT]: { id: STUDENT, email: 'student@example.org' },
    [MODERATOR]: { id: MODERATOR, email: 'mod@example.org' },
    [VIEWER]: { id: VIEWER, email: 'viewer@example.org' }
  }
  world.db = {
    control_roles: [
      { user_id: OWNER, role: 'owner', revoked_at: null },
      { user_id: ADMIN, role: 'administrator', revoked_at: null },
      { user_id: ADMIN2, role: 'administrator', revoked_at: null },
      { user_id: MODERATOR, role: 'moderator', revoked_at: null },
      { user_id: VIEWER, role: 'viewer', revoked_at: null }
    ],
    // Phase 5 defaults: Admin warn + ban, Moderator warn, Viewer nothing, delete owner-only.
    control_role_permissions: [
      { role: 'administrator', permission: 'users.view', allowed: true },
      { role: 'administrator', permission: 'users.warn', allowed: true },
      { role: 'administrator', permission: 'users.ban', allowed: true },
      { role: 'administrator', permission: 'users.delete', allowed: false },
      { role: 'moderator', permission: 'users.view', allowed: true },
      { role: 'moderator', permission: 'users.warn', allowed: true },
      { role: 'moderator', permission: 'users.ban', allowed: false },
      { role: 'viewer', permission: 'users.warn', allowed: false }
    ],
    control_member_permissions: [],
    control_step_up_uses: [],
    control_audit_events: [],
    account_bans: [],
    account_sanctions: [],
    contact_messages: [{ id: 'msg-1', user_id: STUDENT }, { id: 'msg-other', user_id: ADMIN }]
  }
})

describe('permissions for account actions', () => {
  it('refuses actions the role does not include (moderator ban, viewer warn, admin delete)', async () => {
    expect((await act(MODERATOR, 'ban', { userId: STUDENT, reason: 'Spamming the forum', permanent: true })).body).toMatchObject({ error: 'permission_denied' })
    expect((await act(VIEWER, 'warn', { userId: STUDENT, reason: 'Please be kind' })).body).toMatchObject({ error: 'permission_denied' })
    expect((await act(ADMIN, 'delete', { userId: STUDENT, confirmEmail: 'student@example.org' })).body).toMatchObject({ error: 'permission_denied' })
    expect(world.authBans).toEqual([])
    expect(world.deletedUsers).toEqual([])
    expect(world.db.account_sanctions).toEqual([])
  })

  it('checks the permission named by the URL, and refuses a body that names another action', async () => {
    const res = await act(MODERATOR, 'ban', { userId: STUDENT, reason: 'Spamming the forum', permanent: true }, { queryAction: 'warn' })
    expect(res.statusCode).toBe(400)
    expect(world.authBans).toEqual([])
  })

  it('lets a moderator warn a student: one pending notice, audited, access untouched', async () => {
    const res = await act(MODERATOR, 'warn', { userId: STUDENT, reason: 'Please keep messages respectful' })
    expect(res.statusCode).toBe(200)
    expect(world.db.account_sanctions).toEqual([expect.objectContaining({ user_id: STUDENT, kind: 'warning', reason: 'Please keep messages respectful', created_by: MODERATOR })])
    expect(world.db.account_sanctions?.[0]?.acknowledged_at).toBeUndefined()
    expect(world.authBans).toEqual([])
    expect(audits('user.warn', 'success')).toHaveLength(1)
  })

  it('requires a reason of at least 5 characters for warnings and bans', async () => {
    expect((await act(ADMIN, 'warn', { userId: STUDENT, reason: 'no' })).statusCode).toBe(400)
    expect((await act(ADMIN, 'ban', { userId: STUDENT, permanent: true })).statusCode).toBe(400)
  })
})

describe('rank and owner protection', () => {
  it('never acts on the owner, even for another privileged role', async () => {
    const res = await act(ADMIN, 'ban', { userId: OWNER, reason: 'Trying to ban the owner', permanent: true })
    expect(res.body).toMatchObject({ error: 'owner_protected' })
    expect(world.authBans).toEqual([])
    expect(audits('user.ban', 'denied')).toHaveLength(1)
  })

  it('refuses acting on yourself', async () => {
    expect((await act(OWNER, 'ban', { userId: OWNER, reason: 'Self ban attempt', permanent: true })).body).toMatchObject({ error: 'self_action_blocked' })
  })

  it('refuses equal or higher roles for non-owners', async () => {
    expect((await act(ADMIN, 'ban', { userId: ADMIN2, reason: 'Peer admin ban', permanent: true })).body).toMatchObject({ error: 'rank_protected' })
    expect((await act(MODERATOR, 'warn', { userId: ADMIN, reason: 'Warning an admin' })).body).toMatchObject({ error: 'rank_protected' })
    expect((await act(MODERATOR, 'warn', { userId: '77777777-7777-4777-8777-777777777777', reason: 'Unknown user' })).statusCode).toBe(404)
  })

  it('lets an admin act on a lower role, and the owner act on an admin', async () => {
    expect((await act(ADMIN, 'warn', { userId: MODERATOR, reason: 'Late on reviews' })).statusCode).toBe(200)
    expect((await act(OWNER, 'ban', { userId: ADMIN, reason: 'Compromised account', permanent: true })).statusCode).toBe(200)
  })

  it('refuses rank violations before asking for step-up (no step-up is consumed)', async () => {
    await act(ADMIN, 'ban', { userId: ADMIN2, reason: 'Peer admin ban', permanent: true })
    expect(world.db.control_step_up_uses).toEqual([])
  })
})

describe('step-up', () => {
  it('requires a fresh confirmation (≤ 2 minutes) for every action', async () => {
    const res = await act(ADMIN, 'ban', { userId: STUDENT, reason: 'Abusive messages', permanent: true }, { mfaAgo: 400 })
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ error: 'step_up_required' })
    expect(world.authBans).toEqual([])
  })

  it('accepts one confirmation for one action only', async () => {
    const session = 'sess-fixed'
    world.claims = null
    const first = await act(ADMIN, 'warn', { userId: STUDENT, reason: 'First warning' }, { session, mfaAgo: 10 })
    expect(first.statusCode).toBe(200)
    const replay = await act(ADMIN, 'warn', { userId: STUDENT, reason: 'Second warning' }, { session, mfaAgo: 10 })
    expect(replay.body).toMatchObject({ error: 'step_up_required' })
    expect(world.db.account_sanctions).toHaveLength(1)
  })
})

describe('ban and unban', () => {
  it('permanent ban: Supabase Auth ban, ban row, sessions revoked, pending notice, audit', async () => {
    const res = await act(ADMIN, 'ban', { userId: STUDENT, reason: 'Repeated abuse', permanent: true })
    expect(res.statusCode).toBe(200)
    expect(world.authBans).toEqual([{ id: STUDENT, duration: PERMANENT_BAN_DURATION }])
    expect(world.db.account_bans).toEqual([expect.objectContaining({ user_id: STUDENT, banned_until: null, reason: 'Repeated abuse' })])
    expect(world.db.account_sanctions).toEqual([expect.objectContaining({ kind: 'ban', permanent: true, banned_until: null })])
    expect(world.sessionsRevoked).toEqual([STUDENT])
    const [audit] = audits('user.ban', 'success')
    expect(audit?.after_summary).toMatchObject({ after: 'banned', permanent: true, sessions_revoked: true })
    expect(JSON.stringify(audit)).not.toContain('student@example.org')
  })

  it('temporary ban: duration in seconds matching the chosen end time', async () => {
    const until = inTwoHours()
    expect((await act(ADMIN, 'ban', { userId: STUDENT, reason: 'Cool-off period', permanent: false, until })).statusCode).toBe(200)
    const seconds = Number(world.authBans[0]?.duration.replace('s', ''))
    expect(seconds).toBeGreaterThan(7190)
    expect(seconds).toBeLessThanOrEqual(7201)
    expect(String(world.db.account_bans?.[0]?.banned_until)).toMatch(/^\d{4}-/)
  })

  it('refuses a temporary ban without a future end time', async () => {
    expect((await act(ADMIN, 'ban', { userId: STUDENT, reason: 'Cool-off period', permanent: false })).statusCode).toBe(400)
    expect((await act(ADMIN, 'ban', { userId: STUDENT, reason: 'Cool-off period', permanent: false, until: new Date(Date.now() - 1000).toISOString() })).statusCode).toBe(400)
    expect(world.authBans).toEqual([])
  })

  it('writes nothing when Supabase Auth refuses the ban', async () => {
    world.authFail = true
    expect((await act(ADMIN, 'ban', { userId: STUDENT, reason: 'Repeated abuse', permanent: true })).statusCode).toBe(502)
    expect(world.db.account_bans).toEqual([])
    expect(world.db.account_sanctions).toEqual([])
  })

  it('undoes the Auth ban when the database record cannot be written', async () => {
    world.failTable = 'account_sanctions'
    expect((await act(ADMIN, 'ban', { userId: STUDENT, reason: 'Repeated abuse', permanent: true })).statusCode).toBe(503)
    expect(world.authBans.map(b => b.duration)).toEqual([PERMANENT_BAN_DURATION, 'none'])
  })

  it('unban: refuses when not banned; otherwise lifts the Auth ban, clears the row and queues a notice', async () => {
    expect((await act(ADMIN, 'unban', { userId: STUDENT })).body).toMatchObject({ error: 'no_change' })
    world.db.account_bans = [{ user_id: STUDENT, banned_until: null, reason: 'x' }]
    const res = await act(ADMIN, 'unban', { userId: STUDENT, reason: 'Appeal accepted' })
    expect(res.statusCode).toBe(200)
    expect(world.authBans).toEqual([{ id: STUDENT, duration: 'none' }])
    expect(world.db.account_bans).toEqual([])
    expect(world.db.account_sanctions).toEqual([expect.objectContaining({ kind: 'unban' })])
  })

  it('a banned role holder loses console access at once, even with a valid token', async () => {
    world.db.account_bans = [{ user_id: ADMIN, banned_until: null, reason: 'x' }]
    const res = await act(ADMIN, 'warn', { userId: STUDENT, reason: 'Anything here' })
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ error: 'access_not_granted' })
  })
})

describe('delete', () => {
  it('refuses when the typed email does not match, deleting nothing', async () => {
    const res = await act(OWNER, 'delete', { userId: STUDENT, confirmEmail: 'someone@example.org' })
    expect(res.body).toMatchObject({ error: 'confirmation_mismatch' })
    expect(world.deletedUsers).toEqual([])
    expect(world.removed).toEqual([])
  })

  it('removes the account’s files and messages, then the Auth user (rows cascade), and audits counts only', async () => {
    const res = await act(OWNER, 'delete', { userId: STUDENT, confirmEmail: 'Student@Example.org' })
    expect(res.statusCode).toBe(200)
    expect(world.storage['mistake-images']).toEqual([`${ADMIN}/keep.webp`])
    expect(world.storage['contact-attachments']).toEqual(['msg-other/0-x.png'])
    expect(world.db.contact_messages).toEqual([{ id: 'msg-other', user_id: ADMIN }])
    expect(world.deletedUsers).toEqual([STUDENT])
    const [audit] = audits('user.delete', 'success')
    expect(audit?.after_summary).toMatchObject({ files_removed: 3, messages_removed: 1 })
    expect(JSON.stringify(audit)).not.toContain('student@example.org')
  })

  it('an owner-granted per-person delete right lets an admin delete a student, never the owner', async () => {
    world.db.control_member_permissions = [{ user_id: ADMIN, permission: 'users.delete', allowed: true }]
    expect((await act(ADMIN, 'delete', { userId: OWNER, confirmEmail: 'owner@example.org' })).body).toMatchObject({ error: 'owner_protected' })
    expect((await act(ADMIN, 'delete', { userId: STUDENT, confirmEmail: 'student@example.org' })).statusCode).toBe(200)
  })
})

describe('banDuration', () => {
  it('maps permanent to the long Auth duration and temporary to whole seconds', () => {
    expect(banDuration(true, undefined)).toEqual({ duration: PERMANENT_BAN_DURATION, untilIso: null })
    const base = Date.parse('2026-11-14T10:00:00Z')
    expect(banDuration(false, '2026-11-14T11:00:00Z', base)).toEqual({ duration: '3600s', untilIso: '2026-11-14T11:00:00.000Z' })
    expect(() => banDuration(false, '2026-11-14T10:00:30Z', base)).toThrow()
    expect(() => banDuration(false, '2040-11-14T10:00:00Z', base)).toThrow()
  })
})
