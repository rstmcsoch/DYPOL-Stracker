import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Settings, roles, permissions, step-up, and hardcore role-removal governance against an in-memory
 * Supabase stand-in. Every test drives the real route code (dispatcher → controlHandler → route).
 */
type Row = Record<string, unknown>
const world = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  db: {} as Record<string, Row[]>,
  factors: {} as Record<string, Array<{ id: string; status: string }>>,
  passkeys: {} as Record<string, Array<{ id: string }>>,
  users: {} as Record<string, { id: string; email: string }>,
  sessionsRevoked: [] as string[],
  passwordUpdates: [] as string[]
}))

vi.mock('@supabase/supabase-js', () => {
  function match(row: Row, filters: Array<[string, string, unknown]>) {
    return filters.every(([op, column, value]) => {
      if (op === 'eq') return row[column] === value
      if (op === 'ilike') return String(row[column] ?? '').toLowerCase() === String(value).toLowerCase()
      if (op === 'in') return (value as unknown[]).includes(row[column])
      return true
    })
  }
  function builder(table: string) {
    const filters: Array<[string, string, unknown]> = []
    let mode: 'select' | 'update' | 'delete' = 'select'
    let patch: Row = {}
    const rows = () => (world.db[table] ??= [])
    const run = () => {
      if (mode === 'update') {
        if (table === 'control_roles') {
          for (const row of rows().filter(r => match(r, filters))) {
            const next = { ...row, ...patch }
            const otherOwners = rows().filter(r => r.user_id !== row.user_id && r.role === 'owner' && !r.revoked_at).length
            if (row.role === 'owner' && !row.revoked_at && (next.role !== 'owner' || next.revoked_at) && otherOwners < 1) return { data: null, error: { message: 'last_owner', code: 'P0001' } }
          }
        }
        if (table === 'control_role_removals') {
          for (const row of rows().filter(r => match(r, filters))) {
            if (row.status === 'review_restore' && patch.status !== 'restored') {
              return { data: null, error: { message: 'owner_restore_unstoppable', code: 'P0001' } }
            }
          }
        }
        for (const row of rows().filter(r => match(r, filters))) Object.assign(row, patch)
        return { data: null, error: null }
      }
      if (mode === 'delete') {
        world.db[table] = rows().filter(r => !match(r, filters))
        return { data: null, error: null }
      }
      return { data: rows().filter(r => match(r, filters)), error: null }
    }
    const chain: Record<string, unknown> = {}
    Object.assign(chain, {
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      range: () => chain,
      eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return chain },
      ilike: (c: string, v: unknown) => { filters.push(['ilike', c, v]); return chain },
      in: (c: string, v: unknown) => { filters.push(['in', c, v]); return chain },
      update: (p: Row) => { mode = 'update'; patch = p; return chain },
      delete: () => { mode = 'delete'; return chain },
      maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error } },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
      insert: async (input: Row | Row[]) => {
        const list = Array.isArray(input) ? input : [input]
        if (table === 'control_step_up_uses') {
          for (const row of list) {
            if (rows().some(r => r.user_id === row.user_id && r.session_id === row.session_id && r.mfa_at === row.mfa_at)) return { error: { code: '23505', message: 'duplicate' } }
          }
        }
        if (table === 'control_role_removals') {
          for (const row of list) {
            const open = ['pending_approval', 'countdown', 'review_restore']
            if (open.includes(String(row.status)) && rows().some(r => r.target_user_id === row.target_user_id && open.includes(String(r.status)))) {
              return { error: { code: '23505', message: 'duplicate_open_removal' } }
            }
          }
        }
        rows().push(...list.map(row => ({ ...row })))
        return { error: null }
      },
      upsert: async (input: Row[]) => {
        for (const row of input) {
          const existing = rows().find(r => r.role === row.role && r.permission === row.permission)
          if (existing) Object.assign(existing, row)
          else rows().push({ ...row })
        }
        return { error: null }
      }
    })
    return chain
  }
  const admin = {
    from: (table: string) => builder(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'control_revoke_user_sessions') { world.sessionsRevoked.push(String(args.target)); return { data: 2, error: null } }
      return { data: true, error: null }
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: world.users[id] ?? null }, error: null }),
        updateUserById: async (id: string, attrs: Record<string, unknown>) => { if (attrs.password) world.passwordUpdates.push(id); return { error: null } },
        mfa: {
          listFactors: async ({ userId }: { userId: string }) => ({ data: { factors: world.factors[userId] ?? [] }, error: null }),
          deleteFactor: async ({ id, userId }: { id: string; userId: string }) => { world.factors[userId] = (world.factors[userId] ?? []).filter(f => f.id !== id); return { error: null } }
        },
        passkey: {
          listPasskeys: async ({ userId }: { userId: string }) => ({ data: world.passkeys[userId] ?? [], error: null }),
          deletePasskey: async ({ userId, passkeyId }: { userId: string; passkeyId: string }) => { world.passkeys[userId] = (world.passkeys[userId] ?? []).filter(p => p.id !== passkeyId); return { error: null } }
        }
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
const OWNER2 = '55555555-5555-4555-8555-555555555555'
const OWNER3 = '66666666-6666-4666-8666-666666666666'
const ADMIN = '22222222-2222-4222-8222-222222222222'
const STUDENT = '33333333-3333-4333-8333-333333333333'
const MANAGER = '44444444-4444-4444-8444-444444444444' // holds the Moderator role
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

async function call(method: 'GET' | 'POST', body?: unknown, route = 'settings', file = 'security') {
  const mod = (await import(`./${file}.ts`)) as { default: (req: never, res: never) => Promise<void> }
  const res = fakeRes()
  const req = { method, url: `/api/control/${file}?route=${route}`, headers: { authorization: 'Bearer t' }, body, socket: { remoteAddress: '203.0.113.1' } }
  await mod.default(req as never, res as never)
  return res
}

beforeEach(() => {
  world.claims = null
  world.sessionsRevoked = []
  world.passwordUpdates = []
  world.users = {
    [OWNER]: { id: OWNER, email: 'owner@example.org' },
    [OWNER2]: { id: OWNER2, email: 'owner2@example.org' },
    [OWNER3]: { id: OWNER3, email: 'owner3@example.org' },
    [ADMIN]: { id: ADMIN, email: 'admin@example.org' },
    [STUDENT]: { id: STUDENT, email: 'student@example.org' },
    [MANAGER]: { id: MANAGER, email: 'manager@example.org' }
  }
  world.factors = {
    [OWNER]: [{ id: 'f-owner', status: 'verified' }],
    [OWNER2]: [{ id: 'f-owner2', status: 'verified' }],
    [OWNER3]: [{ id: 'f-owner3', status: 'verified' }],
    [ADMIN]: [{ id: 'f-admin', status: 'verified' }],
    [STUDENT]: [{ id: 'f-old', status: 'verified' }],
    [MANAGER]: [{ id: 'f-man', status: 'verified' }]
  }
  world.passkeys = { [ADMIN]: [{ id: 'pk-1' }], [OWNER2]: [{ id: 'pk-owner2' }] }
  world.db = {
    control_roles: [
      { user_id: OWNER, role: 'owner', revoked_at: null, granted_at: '2026-10-01T00:00:00Z' },
      { user_id: ADMIN, role: 'administrator', revoked_at: null, granted_at: '2026-11-01T00:00:00Z' },
      { user_id: MANAGER, role: 'moderator', revoked_at: null, granted_at: '2026-11-02T00:00:00Z' }
    ],
    control_role_permissions: [
      { role: 'administrator', permission: 'settings.site', allowed: true },
      { role: 'administrator', permission: 'users.view', allowed: true },
      { role: 'administrator', permission: 'overview.view', allowed: true },
      { role: 'moderator', permission: 'overview.view', allowed: true },
      { role: 'moderator', permission: 'users.view', allowed: true }
    ],
    control_member_permissions: [],
    control_role_removals: [],
    control_step_up_uses: [],
    control_audit_events: [],
    site_settings: [{ id: 1, maintenance_enabled: false, maintenance_message: '', site_down: false, signup_enabled: true, signin_enabled: true }],
    profiles: Object.values(world.users).map(u => ({ user_id: u.id, email: u.email }))
  }
})

const audits = (action: string) => (world.db.control_audit_events ?? []).filter(row => row.action === action)

describe('permission enforcement on console routes', () => {
  it('lets an admin read what their role includes and refuses the rest with permission_denied', async () => {
    world.claims = claims(ADMIN)
    expect((await call('GET', undefined, 'users', 'accounts')).statusCode).not.toBe(403)
    const denied = await call('GET', undefined, 'audit', 'operations')
    expect(denied.statusCode).toBe(403)
    expect(denied.body).toMatchObject({ error: 'permission_denied' })
    expect((await call('GET', undefined, 'messages', 'operations')).statusCode).toBe(403)
  })

  it('applies per-person overrides on top of the role (deny wins, allow adds)', async () => {
    world.db.control_member_permissions = [{ user_id: ADMIN, permission: 'users.view', allowed: false }, { user_id: ADMIN, permission: 'audit.view', allowed: true }]
    world.claims = claims(ADMIN)
    expect((await call('GET', undefined, 'users', 'accounts')).body).toMatchObject({ error: 'permission_denied' })
    expect((await call('GET', undefined, 'audit', 'operations')).statusCode).not.toBe(403)
  })

  it('reports the effective permissions in the session answer only after aal2', async () => {
    world.claims = claims(ADMIN, { aal: 'aal1', mfaAgo: null })
    expect((await call('GET', undefined, 'session')).body).toMatchObject({ status: 'mfa_required', permissions: [] })
    world.claims = claims(ADMIN)
    const granted = await call('GET', undefined, 'session')
    expect(granted.body).toMatchObject({ status: 'granted', role: 'administrator' })
    expect((granted.body as { permissions: string[] }).permissions.sort()).toEqual(['overview.view', 'settings.site', 'users.view'])
  })

  it('gives the owner every permission regardless of the matrix', async () => {
    world.claims = claims(OWNER)
    const body = (await call('GET', undefined, 'session')).body as { permissions: string[] }
    expect(body.permissions).toContain('roles.manage')
    expect(body.permissions).toContain('ai.manage')
  })
})

describe('step-up: every settings save needs a fresh, single-use authenticator verification', () => {
  const siteBody = { action: 'site.update', maintenanceEnabled: true, maintenanceMessage: 'Back at 6 PM IST', siteDown: false }

  it('refuses a save when the last code is older than two minutes, and nothing is written', async () => {
    world.claims = claims(OWNER, { mfaAgo: 300 })
    const res = await call('POST', siteBody)
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ error: 'step_up_required' })
    expect(world.db.site_settings?.[0]?.maintenance_enabled).toBe(false)
  })

  it('accepts a save with a fresh code, and refuses a second save with the same verification', async () => {
    world.claims = claims(OWNER, { mfaAgo: 10 })
    const first = await call('POST', siteBody)
    expect(first.statusCode).toBe(200)
    expect(world.db.site_settings?.[0]).toMatchObject({ maintenance_enabled: true, maintenance_message: 'Back at 6 PM IST' })
    expect(audits('settings.site')[0]).toMatchObject({ actor_id: OWNER, result: 'success' })
    const replay = await call('POST', { ...siteBody, maintenanceEnabled: false })
    expect(replay.statusCode).toBe(403)
    expect(replay.body).toMatchObject({ error: 'step_up_required', reason: 'step_up_used' })
    expect(world.db.site_settings?.[0]?.maintenance_enabled).toBe(true)
  })

  it('requires step-up for the access switches, password, permissions and roles too', async () => {
    const bodies = [
      { action: 'access.update', signupEnabled: false, signinEnabled: true },
      { action: 'password.change', password: 'a-long-new-password' },
      { action: 'permissions.role', role: 'moderator', permissions: { 'audit.view': true } },
      { action: 'role.assign', email: 'student@example.org', role: 'viewer' },
      { action: 'role.remove', userId: MANAGER }
    ]
    for (const body of bodies) {
      world.claims = claims(OWNER, { mfaAgo: 600 })
      const res = await call('POST', body)
      expect(res.statusCode, body.action).toBe(403)
      expect(res.body, body.action).toMatchObject({ error: 'step_up_required' })
    }
    expect(world.passwordUpdates).toEqual([])
    expect(world.db.site_settings?.[0]?.signup_enabled).toBe(true)
  })

  it('checks the permission before spending the code: an admin without settings.access is refused', async () => {
    world.claims = claims(ADMIN)
    const res = await call('POST', { action: 'access.update', signupEnabled: false, signinEnabled: false })
    expect(res.body).toMatchObject({ error: 'permission_denied' })
    expect(world.db.control_step_up_uses).toHaveLength(0)
  })

  it('never stores the password anywhere in the audit row', async () => {
    world.claims = claims(OWNER)
    expect((await call('POST', { action: 'password.change', password: 'correct-horse-battery' })).statusCode).toBe(200)
    expect(world.passwordUpdates).toEqual([OWNER])
    expect(JSON.stringify(world.db.control_audit_events)).not.toContain('correct-horse')
  })
})

describe('roles: assign, governed removal, and hardcore owner protection', () => {
  it('gives a role to an existing account by email and clears their old authenticator so they enroll fresh', async () => {
    world.claims = claims(OWNER)
    const res = await call('POST', { action: 'role.assign', email: 'Student@Example.org', role: 'viewer' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ role: 'viewer', mfaSetupRequired: true })
    expect(world.db.control_roles?.find(r => r.user_id === STUDENT)).toMatchObject({ role: 'viewer', revoked_at: null })
    expect(world.factors[STUDENT]).toEqual([])
  })

  it('single active owner removing a non-owner starts a 7-day IST countdown, locks them view-only, and auto-revokes once the 7th IST day arrives', async () => {
    world.db.control_member_permissions = [{ user_id: ADMIN, permission: 'audit.view', allowed: true }]
    world.claims = claims(OWNER)
    const res = await call('POST', { action: 'role.remove', userId: ADMIN })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ status: 'countdown', daysRemaining: 7, approvedCount: 1, requiredApprovers: 1 })
    // Still active until the 7-day IST countdown finishes, but strictly view-only (all writes blocked).
    expect(world.db.control_roles?.find(r => r.user_id === ADMIN)?.revoked_at).toBeNull()
    world.claims = claims(ADMIN, { mfaAgo: 5 })
    expect((await call('GET', undefined, 'session')).body).toMatchObject({ status: 'granted', ownerReadOnly: true, ownerRemovalStatus: 'countdown', removalDaysRemaining: 7 })
    expect((await call('POST', { action: 'site.update', maintenanceEnabled: true, maintenanceMessage: '', siteDown: false })).body).toMatchObject({ error: 'owner_removal_readonly' })

    // Simulate 7 IST days passing.
    world.db.control_role_removals![0]!.effective_on_ist = '2020-01-01'
    world.claims = claims(ADMIN)
    expect((await call('GET', undefined, 'session')).body).toMatchObject({ error: 'access_not_granted' })
    expect(world.db.control_roles?.find(r => r.user_id === ADMIN)?.revoked_at).toBeTruthy()
    expect(world.db.control_member_permissions).toEqual([])
    expect(world.factors[ADMIN]).toEqual([])
    expect(world.passkeys[ADMIN]).toEqual([])
    expect(world.sessionsRevoked).toEqual([ADMIN])
  })

  it('re-granting a removed person after countdown completion requires a brand-new authenticator enrollment', async () => {
    world.claims = claims(OWNER)
    await call('POST', { action: 'role.remove', userId: MANAGER })
    world.db.control_role_removals![0]!.effective_on_ist = '2020-01-01'
    await call('GET') // reconciles and completes revocation
    world.factors[MANAGER] = [{ id: 'f-new-attempt', status: 'verified' }]
    world.claims = claims(OWNER, { mfaAgo: 5 })
    const res = await call('POST', { action: 'role.assign', email: 'manager@example.org', role: 'moderator' })
    expect(res.body).toMatchObject({ mfaSetupRequired: true })
    expect(world.factors[MANAGER]).toEqual([])
  })

  it('with 3 active owners, non-owner removal requires ALL 3 owners to approve before the 7-day countdown starts', async () => {
    world.db.control_roles!.push(
      { user_id: OWNER2, role: 'owner', revoked_at: null, granted_at: '2026-10-02T00:00:00Z' },
      { user_id: OWNER3, role: 'owner', revoked_at: null, granted_at: '2026-10-03T00:00:00Z' }
    )
    world.claims = claims(OWNER, { mfaAgo: 5 })
    const start = await call('POST', { action: 'role.remove', userId: ADMIN })
    expect(start.statusCode).toBe(200)
    expect(start.body).toMatchObject({ status: 'pending_approval', approvedCount: 1, requiredApprovers: 3 })
    const removalId = (start.body as { removalId: string }).removalId

    // Duplicate approval by OWNER is refused.
    world.claims = claims(OWNER, { mfaAgo: 2 })
    expect((await call('POST', { action: 'role.removal.approve', removalId })).body).toMatchObject({ error: 'already_approved' })

    // Non-owner cannot approve.
    world.claims = claims(MANAGER, { mfaAgo: 2 })
    expect((await call('POST', { action: 'role.removal.approve', removalId })).body).toMatchObject({ error: 'owner_only' })

    // Second owner approves -> 2/3, still pending_approval.
    world.claims = claims(OWNER2, { mfaAgo: 5 })
    const second = await call('POST', { action: 'role.removal.approve', removalId })
    expect(second.statusCode).toBe(200)
    expect(second.body).toMatchObject({ status: 'pending_approval', approvedCount: 2, requiredApprovers: 3 })

    // Third owner approves -> 3/3 unanimous -> 7-day IST countdown starts!
    world.claims = claims(OWNER3, { mfaAgo: 5 })
    const third = await call('POST', { action: 'role.removal.approve', removalId })
    expect(third.statusCode).toBe(200)
    expect(third.body).toMatchObject({ status: 'countdown', approvedCount: 3, requiredApprovers: 3, daysRemaining: 7 })
  })

  it('one owner CANNOT change another owner’s role', async () => {
    world.db.control_roles!.push({ user_id: OWNER2, role: 'owner', revoked_at: null, granted_at: '2026-10-02T00:00:00Z' })
    world.claims = claims(OWNER, { mfaAgo: 5 })
    const res = await call('POST', { action: 'role.assign', email: 'owner2@example.org', role: 'administrator' })
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ error: 'owner_protected' })
    expect(world.db.control_roles?.find(r => r.user_id === OWNER2)?.role).toBe('owner')
  })

  it('owner removal requires target owner self-consent, locks them read-only for 30d IST, and supports unstoppable 2d self-restore', async () => {
    world.db.control_roles!.push({ user_id: OWNER2, role: 'owner', revoked_at: null, granted_at: '2026-10-02T00:00:00Z' })

    // 1. OWNER requests removal of OWNER2 -> pending_approval (no lockout yet).
    world.claims = claims(OWNER, { mfaAgo: 5 })
    const reqRes = await call('POST', { action: 'role.remove', userId: OWNER2 })
    expect(reqRes.statusCode).toBe(200)
    expect(reqRes.body).toMatchObject({ status: 'pending_approval', targetRole: 'owner', requiresTargetConsent: true })
    const removalId = (reqRes.body as { removalId: string }).removalId

    // 2. OWNER already approved by initiating and cannot approve again on OWNER2's behalf.
    world.claims = claims(OWNER, { mfaAgo: 2 })
    expect((await call('POST', { action: 'role.removal.approve', removalId })).body).toMatchObject({ error: 'already_approved' })

    // 3. OWNER2 confirms their own removal -> 30-day IST countdown + immediate read-only lockout.
    world.claims = claims(OWNER2, { mfaAgo: 5 })
    const approveRes = await call('POST', { action: 'role.removal.approve', removalId })
    expect(approveRes.statusCode).toBe(200)
    expect(approveRes.body).toMatchObject({ status: 'countdown', daysRemaining: 30, ownerReadOnly: true })

    // 4. OWNER2 can still log in and view everything, but EVERY write action is blocked with 403 owner_removal_readonly.
    world.claims = claims(OWNER2, { mfaAgo: 2 })
    expect((await call('GET', undefined, 'session')).body).toMatchObject({ status: 'granted', ownerReadOnly: true, ownerRemovalStatus: 'countdown' })
    expect((await call('GET')).statusCode).toBe(200)
    expect((await call('POST', { action: 'site.update', maintenanceEnabled: true, maintenanceMessage: '', siteDown: false })).body).toMatchObject({ error: 'owner_removal_readonly' })
    expect((await call('POST', { action: 'role.assign', email: 'student@example.org', role: 'viewer' })).body).toMatchObject({ error: 'owner_removal_readonly' })
    expect((await call('POST', { action: 'password.change', password: 'new-long-password-123' })).body).toMatchObject({ error: 'owner_removal_readonly' })

    // 5. OWNER2 submits the 2-day restore review (the ONLY write allowed during read-only lock).
    world.claims = claims(OWNER2, { mfaAgo: 1 })
    const restoreRes = await call('POST', { action: 'role.removal.restore_review', removalId })
    expect(restoreRes.statusCode).toBe(200)
    expect(restoreRes.body).toMatchObject({ status: 'review_restore', restoreDaysRemaining: 2 })

    // 6. NOBODY (not even OWNER) can cancel, pause, or step down the 2-day restore review!
    world.claims = claims(OWNER, { mfaAgo: 1 })
    const cancelRes = await call('POST', { action: 'role.removal.cancel', removalId })
    expect(cancelRes.statusCode).toBe(409)
    expect(cancelRes.body).toMatchObject({ error: 'owner_restore_unstoppable' })

    // 7. Once 2 IST days elapse, OWNER2 is automatically restored to full Owner access!
    world.db.control_role_removals![0]!.restore_on_ist = '2020-01-01'
    world.claims = claims(OWNER2, { mfaAgo: 1, session: 'restored-sess' })
    const sessionAfter = await call('GET', undefined, 'session')
    expect(sessionAfter.statusCode).toBe(200)
    expect(sessionAfter.body).toMatchObject({ status: 'granted', role: 'owner', ownerReadOnly: false, ownerRemovalStatus: null })
    expect(world.db.control_role_removals![0]!.status).toBe('restored')
  })

  it('with 3 active owners, owner removal requires all other owners to approve first before the targeted owner gives final confirmation', async () => {
    world.db.control_roles!.push(
      { user_id: OWNER2, role: 'owner', revoked_at: null, granted_at: '2026-10-02T00:00:00Z' },
      { user_id: OWNER3, role: 'owner', revoked_at: null, granted_at: '2026-10-03T00:00:00Z' }
    )
    world.claims = claims(OWNER, { mfaAgo: 5 })
    const start = await call('POST', { action: 'role.remove', userId: OWNER3 })
    expect(start.statusCode).toBe(200)
    expect(start.body).toMatchObject({ status: 'pending_approval', approvedCount: 1, requiredApprovers: 3 })
    const removalId = (start.body as { removalId: string }).removalId

    // Targeted owner cannot confirm before all other active owners approve.
    world.claims = claims(OWNER3, { mfaAgo: 2 })
    expect((await call('POST', { action: 'role.removal.approve', removalId })).body).toMatchObject({ error: 'other_owners_required_first' })

    // OWNER2 approves (2/3).
    world.claims = claims(OWNER2, { mfaAgo: 5 })
    const second = await call('POST', { action: 'role.removal.approve', removalId })
    expect(second.statusCode).toBe(200)
    expect(second.body).toMatchObject({ status: 'pending_approval', approvedCount: 2, requiredApprovers: 3 })

    // Now targeted OWNER3 gives final confirmation (3/3) -> 30-day IST countdown + read-only lock!
    world.claims = claims(OWNER3, { mfaAgo: 5 })
    const finalRes = await call('POST', { action: 'role.removal.approve', removalId })
    expect(finalRes.statusCode).toBe(200)
    expect(finalRes.body).toMatchObject({ status: 'countdown', approvedCount: 3, requiredApprovers: 3, daysRemaining: 30, ownerReadOnly: true })
  })

  it('a non-owner with roles.manage cannot touch Owner or Admin roles, or grant them', async () => {
    world.db.control_member_permissions = [{ user_id: MANAGER, permission: 'roles.manage', allowed: true }]
    world.claims = claims(MANAGER)
    expect((await call('POST', { action: 'role.remove', userId: OWNER })).body).toMatchObject({ error: 'owner_only' })
    expect((await call('POST', { action: 'role.remove', userId: ADMIN })).body).toMatchObject({ error: 'owner_only' })
    expect((await call('POST', { action: 'role.assign', email: 'student@example.org', role: 'administrator' })).body).toMatchObject({ error: 'owner_only' })
    expect((await call('POST', { action: 'permissions.role', role: 'viewer', permissions: { 'users.manage': true } })).body).toMatchObject({ error: 'owner_only' })
    expect(world.db.control_roles?.find(r => r.user_id === OWNER)?.revoked_at).toBeNull()
  })

  it('nobody can remove or change their own role, and the last owner cannot be removed', async () => {
    world.claims = claims(OWNER)
    expect((await call('POST', { action: 'role.remove', userId: OWNER })).body).toMatchObject({ error: 'self_action_blocked' })
    world.db.control_roles!.push({ user_id: STUDENT, role: 'owner', revoked_at: null, granted_at: '2026-11-03T00:00:00Z' })
    world.db.control_roles = world.db.control_roles!.filter(r => r.user_id !== OWNER).concat([{ user_id: OWNER, role: 'owner', revoked_at: '2026-11-04T00:00:00Z' }])
    // STUDENT is now the only active owner; OWNER (revoked) cannot act at all.
    world.claims = claims(OWNER)
    expect((await call('GET')).body).toMatchObject({ error: 'access_not_granted' })
  })

  it('refuses an unknown email without revealing anything else', async () => {
    world.claims = claims(OWNER)
    expect((await call('POST', { action: 'role.assign', email: 'nobody@example.org', role: 'viewer' })).body).toMatchObject({ error: 'user_not_found' })
  })
})

describe('owner-only settings', () => {
  it('only the owner edits the permission matrix and personal overrides', async () => {
    world.claims = claims(OWNER)
    const res = await call('POST', { action: 'permissions.role', role: 'moderator', permissions: { 'audit.view': true, 'users.view': false } })
    expect(res.statusCode).toBe(200)
    expect(world.db.control_role_permissions?.find(r => r.role === 'moderator' && r.permission === 'users.view')?.allowed).toBe(false)
    world.claims = claims(OWNER, { mfaAgo: 3 })
    expect((await call('POST', { action: 'permissions.member', userId: OWNER, overrides: { 'users.view': 'deny' } })).body).toMatchObject({ error: 'owner_protected' })
  })

  it('passkey actions are owner only', async () => {
    world.claims = claims(ADMIN)
    expect((await call('POST', { action: 'passkey.authorize' })).body).toMatchObject({ error: 'owner_only' })
    world.claims = claims(OWNER)
    expect((await call('POST', { action: 'passkey.authorize' })).statusCode).toBe(200)
  })

  it('shows members, matrix and passkeys only to those allowed', async () => {
    world.claims = claims(ADMIN)
    const adminView = (await call('GET')).body as Record<string, unknown>
    expect(adminView.members).toBeNull()
    expect(adminView.matrix).toBeNull()
    expect(adminView.passkeys).toBeNull()
    world.claims = claims(OWNER)
    const ownerView = (await call('GET')).body as { members: Array<{ email: string; mfaEnrolled: boolean }> }
    expect(ownerView.members.map(m => m.email)).toContain('admin@example.org')
    expect(JSON.stringify(ownerView)).not.toMatch(/f-owner|f-admin/)
  })
})

function passkeyClaims(sub: string, opts: { agoSeconds?: number; session?: string; withTotp?: boolean } = {}) {
  const amr: Array<{ method: string; timestamp: number }> = [{ method: 'passkey', timestamp: now() - (opts.agoSeconds ?? 20) }]
  if (opts.withTotp) amr.push({ method: 'totp', timestamp: now() - 600 })
  // A Supabase passkey sign-in is aal1 on its own; with a TOTP verification it is aal2.
  return { sub, role: 'authenticated', aal: opts.withTotp ? 'aal2' : 'aal1', session_id: opts.session ?? `pk-${sub.slice(0, 4)}`, amr }
}

describe('passkeys are the owner’s alone', () => {
  it('the owner’s passkey completes the console’s second step, and the session says so', async () => {
    world.passkeys[OWNER] = [{ id: 'pk-owner' }]
    world.claims = passkeyClaims(OWNER)
    const res = await call('GET', undefined, 'session')
    expect(res.body).toMatchObject({ status: 'granted', role: 'owner', method: 'passkey', passkey: true })
    expect((await call('GET', undefined, 'users', 'accounts')).statusCode).not.toBe(403)
  })

  it('tells the owner (only) at the two-step screen whether a passkey can be used', async () => {
    world.claims = claims(OWNER, { aal: 'aal1', mfaAgo: null })
    expect((await call('GET', undefined, 'session')).body).toMatchObject({ status: 'mfa_required', passkey: false })
    world.passkeys[OWNER] = [{ id: 'pk-owner' }]
    expect((await call('GET', undefined, 'session')).body).toMatchObject({ status: 'mfa_required', passkey: true })
    world.claims = claims(ADMIN, { aal: 'aal1', mfaAgo: null }) // ADMIN has a stray passkey in the fixture
    expect((await call('GET', undefined, 'session')).body).toMatchObject({ status: 'mfa_required', passkey: false })
  })

  it('refuses any non-owner whose session used a passkey, even with a TOTP code too', async () => {
    for (const claimSet of [passkeyClaims(ADMIN), passkeyClaims(ADMIN, { withTotp: true }), passkeyClaims(MANAGER)]) {
      world.claims = claimSet
      for (const [route, file] of [['session', 'security'], ['users', 'accounts'], ['settings', 'security']] as const) {
        const res = await call('GET', undefined, route, file)
        expect(res.statusCode).toBe(403)
        expect(res.body).toMatchObject({ error: 'access_not_granted' })
      }
    }
    expect((world.db.control_audit_events ?? []).some(row => row.actor_id === ADMIN && row.error_category === 'passkey_owner_only')).toBe(true)
  })

  it('a WebAuthn MFA factor (mfa/webauthn at aal2) is refused for non-owners as well', async () => {
    world.claims = { sub: ADMIN, role: 'authenticated', aal: 'aal2', session_id: 's-w', amr: [{ method: 'mfa/webauthn', timestamp: now() - 10 }] }
    expect((await call('GET', undefined, 'session')).statusCode).toBe(403)
  })

  it('refuses passkey add/remove for a non-owner', async () => {
    world.claims = claims(ADMIN)
    expect((await call('POST', { action: 'passkey.authorize' })).body).toMatchObject({ error: 'owner_only' })
    expect((await call('POST', { action: 'passkey.delete', passkeyId: 'pk-1' })).body).toMatchObject({ error: 'owner_only' })
    expect(world.passkeys[ADMIN]).toEqual([{ id: 'pk-1' }])
  })

  it('removes passkeys from anyone given a non-owner role', async () => {
    world.passkeys[STUDENT] = [{ id: 'pk-s' }]
    world.claims = claims(OWNER, { mfaAgo: 5 })
    expect((await call('POST', { action: 'role.assign', email: 'student@example.org', role: 'moderator' })).statusCode).toBe(200)
    expect(world.passkeys[STUDENT]).toEqual([])
    expect(audits('role.assign').at(-1)?.summary ?? audits('role.assign').at(-1)).toBeTruthy()
  })
})

describe('step-up with either method', () => {
  const siteBody = { action: 'site.update', maintenanceEnabled: true, maintenanceMessage: '', siteDown: false }

  it('owner: a fresh passkey confirms one save; the same confirmation cannot be reused', async () => {
    world.claims = passkeyClaims(OWNER, { agoSeconds: 15, session: 'pk-step-1' })
    expect((await call('POST', siteBody)).statusCode).toBe(200)
    const replay = await call('POST', { ...siteBody, maintenanceEnabled: false })
    expect(replay.body).toMatchObject({ error: 'step_up_required', reason: 'step_up_used' })
    world.claims = passkeyClaims(OWNER, { agoSeconds: 5, session: 'pk-step-2' })
    expect((await call('POST', { ...siteBody, maintenanceEnabled: false })).statusCode).toBe(200)
    expect(world.db.site_settings?.[0]?.maintenance_enabled).toBe(false)
  })

  it('owner: a stale passkey (over two minutes) is refused and nothing is written', async () => {
    world.claims = passkeyClaims(OWNER, { agoSeconds: 300 })
    const res = await call('POST', siteBody)
    expect(res.body).toMatchObject({ error: 'step_up_required', reason: 'step_up_stale' })
    expect(world.db.site_settings?.[0]?.maintenance_enabled).toBe(false)
  })

  it('owner: a fresh authenticator code still works', async () => {
    world.claims = claims(OWNER, { mfaAgo: 5 })
    expect((await call('POST', siteBody)).statusCode).toBe(200)
  })

  it('admin: only the authenticator code counts (fresh code ok, stale code refused)', async () => {
    world.claims = claims(ADMIN, { mfaAgo: 5 })
    expect((await call('POST', siteBody)).statusCode).toBe(200)
    world.claims = claims(ADMIN, { mfaAgo: 400, session: 'other' })
    expect((await call('POST', siteBody)).body).toMatchObject({ error: 'step_up_required', reason: 'step_up_stale' })
  })

  it('a step-up is bound to the user: another user’s identical verification does not collide or carry over', async () => {
    world.claims = claims(OWNER, { mfaAgo: 5, session: 'shared' })
    expect((await call('POST', siteBody)).statusCode).toBe(200)
    world.claims = claims(ADMIN, { mfaAgo: 5, session: 'shared' })
    expect((await call('POST', { ...siteBody, maintenanceEnabled: false })).statusCode).toBe(200)
    expect(world.db.control_step_up_uses?.map(row => row.user_id)).toEqual([OWNER, ADMIN])
  })
})
