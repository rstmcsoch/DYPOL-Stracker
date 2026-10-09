/**
 * Owner bootstrap for the Stracker Control Center.
 *
 * It grants the `owner` role to an EXISTING, email-verified Supabase Auth account. It never
 * creates an account, changes a password, re-verifies an email, or edits profile, settings
 * or study rows. It is idempotent: running it again changes nothing and writes no duplicate.
 *
 * Required environment (server-only, never prefixed with VITE_, never committed):
 *   SUPABASE_URL (or VITE_SUPABASE_URL)   project URL
 *   SUPABASE_SERVICE_ROLE_KEY             service-role secret, used only in this process
 * Optional:
 *   CONTROL_OWNER_EMAIL                   defaults to dypollabs@gmail.com
 *
 * Usage:
 *   node scripts/owner-provisioning.mjs --dry-run   verify the target and report, no writes
 *   node scripts/owner-provisioning.mjs             grant (or confirm) the owner role
 */
import { createClient } from '@supabase/supabase-js'
import { pathToFileURL } from 'node:url'

export const DEFAULT_OWNER_EMAIL = 'dypollabs@gmail.com'
const PAGE_SIZE = 200
const MAX_PAGES = 500

/** Finds the single auth account whose email matches exactly (case-insensitive). */
export async function findAccountByEmail(admin, email) {
  const wanted = email.trim().toLowerCase()
  const matches = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE })
    if (error) throw new Error(`Could not list Auth accounts: ${error.message}`)
    const users = data?.users ?? []
    for (const user of users) {
      if ((user.email ?? '').toLowerCase() === wanted) matches.push(user)
    }
    if (users.length < PAGE_SIZE) break
  }
  if (matches.length === 0) throw new Error('No Stracker account exists for that email. Create it through normal sign-up first; this script never creates accounts.')
  if (matches.length > 1) throw new Error('More than one account matches that email. Resolve the duplicate before provisioning.')
  return matches[0]
}

/**
 * Returns { status, userId }. status is one of:
 *   'would_grant' | 'granted' | 'already_owner'
 * Throws for any unsafe precondition, so a failed check never leaves a partial grant.
 */
export async function provisionOwner(admin, { email, dryRun = false, now = () => new Date().toISOString() } = {}) {
  if (!email || typeof email !== 'string' || !email.includes('@')) throw new Error('A valid owner email is required.')
  const user = await findAccountByEmail(admin, email)
  if (!user.id) throw new Error('The matched account has no identifier.')
  if (!user.email_confirmed_at) throw new Error('The matched account has not verified its email. Verify it through the normal flow first; provisioning will not change verification.')
  if (user.banned_until && Date.parse(user.banned_until) > Date.now()) throw new Error('The matched account is currently suspended. Restore it before granting owner access.')

  const { data: profile, error: profileError } = await admin.from('profiles').select('id').eq('user_id', user.id).maybeSingle()
  if (profileError) throw new Error(`Could not read the Stracker profile: ${profileError.message}`)
  if (!profile) console.warn('Warning: the account has no Stracker profile row yet. The owner role is still granted; the profile is not created here.')

  const { data: existing, error: readError } = await admin.from('admin_roles').select('role, revoked_at').eq('user_id', user.id).maybeSingle()
  if (readError) throw new Error(`Could not read admin_roles: ${readError.message}. Apply the Control Center migration first.`)

  if (existing && existing.role === 'owner' && !existing.revoked_at) {
    await verifyOwner(admin, user.id)
    return { status: 'already_owner', userId: user.id }
  }
  if (dryRun) return { status: 'would_grant', userId: user.id }

  const timestamp = now()
  const { error: upsertError } = await admin.from('admin_roles').upsert(
    { user_id: user.id, role: 'owner', granted_by: null, granted_at: timestamp, revoked_at: null, reason: 'Initial owner bootstrap (scripts/owner-provisioning.mjs)' },
    { onConflict: 'user_id' }
  )
  if (upsertError) throw new Error(`Could not write the owner role: ${upsertError.message}`)

  const { error: auditError } = await admin.from('admin_audit_events').insert({
    request_id: 'bootstrap',
    actor_id: null,
    actor_role: 'operator',
    action: 'owner.provisioned',
    target_type: 'user',
    target_id: user.id,
    outcome: 'success',
    severity: 'critical',
    reason: 'Initial owner bootstrap',
    summary: { before: existing ? existing.role : 'none', after: 'owner' }
  })
  if (auditError) throw new Error(`The role was written but the audit entry failed: ${auditError.message}. Check admin_audit_events before retrying.`)

  await verifyOwner(admin, user.id)
  return { status: 'granted', userId: user.id }
}

/** Reads the role back through the same table and columns the server authorization uses. */
async function verifyOwner(admin, userId) {
  const { data, error } = await admin.from('admin_roles').select('role, revoked_at').eq('user_id', userId).maybeSingle()
  if (error || !data || data.role !== 'owner' || data.revoked_at) throw new Error('Verification failed: the owner role is not active for this account.')
}

function clientFromEnvironment(env = process.env) {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim()
  const key = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in this shell. Values are never printed.')
  try { new URL(url) } catch { throw new Error('SUPABASE_URL is not a valid URL.') }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const email = (process.env.CONTROL_OWNER_EMAIL || DEFAULT_OWNER_EMAIL).trim()
  const admin = clientFromEnvironment()
  const result = await provisionOwner(admin, { email, dryRun })
  const messages = {
    would_grant: 'Dry run: the account is eligible. Run again without --dry-run to grant the owner role.',
    granted: 'Owner role granted and verified.',
    already_owner: 'Owner role already active. No changes were made.'
  }
  console.log(`${messages[result.status]} (user id ${result.userId})`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Owner provisioning stopped: ${error instanceof Error ? error.message : 'unknown error'}`)
    process.exitCode = 1
  })
}
