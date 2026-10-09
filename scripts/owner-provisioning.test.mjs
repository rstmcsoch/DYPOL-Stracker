import { describe, expect, it } from 'vitest'
import { provisionOwner, findAccountByEmail } from './owner-provisioning.mjs'

/** In-memory stand-in for the Supabase admin client, covering only the calls the script makes. */
function fakeAdmin({ users = [], profiles = [], roles = [], failAudit = false } = {}) {
  const state = { users, profiles, roles: [...roles], audit: [], upserts: 0 }
  const from = table => {
    if (table === 'profiles') {
      return { select: () => ({ eq: (_c, v) => ({ maybeSingle: async () => ({ data: profiles.find(p => p.user_id === v) ?? null, error: null }) }) }) }
    }
    if (table === 'admin_roles') {
      return {
        select: () => ({ eq: (_c, v) => ({ maybeSingle: async () => ({ data: state.roles.find(r => r.user_id === v) ?? null, error: null }) }) }),
        upsert: async row => {
          state.upserts += 1
          const index = state.roles.findIndex(r => r.user_id === row.user_id)
          if (index >= 0) state.roles[index] = row
          else state.roles.push(row)
          return { error: null }
        }
      }
    }
    if (table === 'admin_audit_events') {
      return { insert: async row => { if (failAudit) return { error: { message: 'boom' } }; state.audit.push(row); return { error: null } } }
    }
    throw new Error(`unexpected table ${table}`)
  }
  const admin = {
    from,
    auth: { admin: { listUsers: async ({ page }) => ({ data: { users: page === 1 ? state.users : [] }, error: null }) } }
  }
  return { admin, state }
}

const owner = { id: '11111111-1111-4111-8111-111111111111', email: 'DYPOLLABS@gmail.com', email_confirmed_at: '2026-01-01T00:00:00Z', banned_until: null }
const unverified = { id: '22222222-2222-4222-8222-222222222222', email: 'dypollabs@gmail.com', email_confirmed_at: null }

describe('owner provisioning', () => {
  it('grants the owner role once, with an audit entry, and verifies it', async () => {
    const { admin, state } = fakeAdmin({ users: [owner], profiles: [{ user_id: owner.id }] })
    const first = await provisionOwner(admin, { email: 'dypollabs@gmail.com' })
    expect(first).toEqual({ status: 'granted', userId: owner.id })
    expect(state.roles).toHaveLength(1)
    expect(state.roles[0]).toMatchObject({ user_id: owner.id, role: 'owner', revoked_at: null })
    expect(state.audit[0]).toMatchObject({ action: 'owner.provisioned', target_id: owner.id, outcome: 'success' })
  })

  it('is idempotent: a second run changes nothing and writes no duplicate', async () => {
    const { admin, state } = fakeAdmin({ users: [owner], profiles: [{ user_id: owner.id }] })
    await provisionOwner(admin, { email: 'dypollabs@gmail.com' })
    const second = await provisionOwner(admin, { email: 'dypollabs@gmail.com' })
    expect(second.status).toBe('already_owner')
    expect(state.upserts).toBe(1)
    expect(state.audit).toHaveLength(1)
  })

  it('refuses unverified accounts and never changes verification', async () => {
    const { admin, state } = fakeAdmin({ users: [unverified] })
    await expect(provisionOwner(admin, { email: 'dypollabs@gmail.com' })).rejects.toThrow(/not verified/)
    expect(state.roles).toHaveLength(0)
  })

  it('refuses when no account exists rather than creating one', async () => {
    const { admin } = fakeAdmin({ users: [] })
    await expect(findAccountByEmail(admin, 'nobody@example.com')).rejects.toThrow(/never creates accounts/)
  })

  it('refuses ambiguous matches', async () => {
    const { admin } = fakeAdmin({ users: [owner, { ...owner, id: '33333333-3333-4333-8333-333333333333' }] })
    await expect(findAccountByEmail(admin, 'dypollabs@gmail.com')).rejects.toThrow(/More than one/)
  })

  it('dry run reports eligibility without writing', async () => {
    const { admin, state } = fakeAdmin({ users: [owner] })
    const result = await provisionOwner(admin, { email: 'dypollabs@gmail.com', dryRun: true })
    expect(result.status).toBe('would_grant')
    expect(state.upserts).toBe(0)
    expect(state.audit).toHaveLength(0)
  })

  it('reports an audit failure instead of silently succeeding', async () => {
    const { admin } = fakeAdmin({ users: [owner], failAudit: true })
    await expect(provisionOwner(admin, { email: 'dypollabs@gmail.com' })).rejects.toThrow(/audit entry failed/)
  })
})
