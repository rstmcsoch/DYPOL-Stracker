import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError, readJson, sendJson } from '../http.js'
import { controlHandler, recordAuditEvent, recordBoundedDenial, requireStepUp, type ControlContext } from '../control.js'
import { deleteAllPasskeys } from '../control-passkeys.js'
import { cleanText, isUuid } from '../control-policy.js'
import {
  deleteAllFactors,
  reconcileRoleRemovals,
  type RoleRemovalRow
} from '../control-role-removals.js'
import {
  CONTROL_ROLES,
  EDITABLE_ROLES,
  PERMISSIONS,
  assignableRoles,
  isControlRole,
  type ControlRole,
  type Permission
} from '../../../src/lib/control-permissions.js'
import {
  MEMBER_REMOVAL_COUNTDOWN_DAYS,
  OWNER_REMOVAL_COUNTDOWN_DAYS,
  OWNER_RESTORE_REVIEW_DAYS,
  addIstDays,
  hasAllOwnerApprovals,
  istDaysRemaining,
  type RoleRemovalView
} from '../../../src/lib/control-role-governance.js'
import { MIN_PASSWORD_LENGTH } from '../../../src/lib/auth-rules.js'
import { BUILT_IN_ALLOWED_DOMAINS, isBuiltInAllowedDomain, normalizeDomainInput } from '../../../src/lib/email-domains.js'

export { deleteAllFactors } from '../control-role-removals.js'

/**
 * Control Centre → Settings.
 *   GET  /api/control/settings      what the signed-in role holder may see (site status, access
 *                                   switches, email domains, members, pending/scheduled removals,
 *                                   permission matrix, settings activity, passkeys)
 *   POST /api/control/settings      { action, ... } one change. EVERY save requires:
 *                                   session + active role + aal2 + the action's permission + a
 *                                   fresh single-use confirmation (requireStepUp).
 *
 * Owner & role-removal governance:
 *   - Owners cannot change another owner's role (403 owner_protected).
 *   - Removing another owner requires explicit self-consent from that targeted owner, which starts
 *     a 30-day IST countdown with full Control Centre read-only lockout. During those 30 days, the
 *     locked owner may submit an unstoppable 2-day restore review (`role.removal.restore_review`).
 *   - Removing any non-owner role requires unanimous approval from every active unrestricted owner,
 *     then starts a 7-day IST countdown before automatic revocation.
 *
 * Never returns or logs passwords, codes, tokens or factor secrets.
 */

const SITE_COLUMNS = 'maintenance_enabled, maintenance_message, site_down, signup_enabled, signin_enabled, updated_at'
const SETTINGS_ACTIVITY = [
  'settings.site',
  'settings.access',
  'role.assign',
  'role.remove',
  'role.removal.request',
  'role.removal.approve',
  'role.removal.restore_review',
  'role.removal.restored',
  'role.removal.cancel',
  'permissions.role',
  'permissions.member',
  'security.password',
  'security.passkey_add',
  'security.passkey_remove',
  'settings.email_domain'
]
const DEFAULT_DOWN_MESSAGE = 'Stracker is down for maintenance. Please check back soon.'

const permissionMap = z.partialRecord(z.enum(PERMISSIONS), z.boolean())
const overrideMap = z.partialRecord(z.enum(PERMISSIONS), z.enum(['inherit', 'allow', 'deny']))

const actionBody = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('site.update'),
    maintenanceEnabled: z.boolean(),
    maintenanceMessage: z.string().max(500),
    siteDown: z.boolean()
  }).strict(),
  z.object({ action: z.literal('access.update'), signupEnabled: z.boolean(), signinEnabled: z.boolean() }).strict(),
  z.object({ action: z.literal('role.assign'), email: z.string().trim().min(3).max(320), role: z.enum(CONTROL_ROLES) }).strict(),
  z.object({ action: z.literal('role.remove'), userId: z.uuid() }).strict(),
  z.object({ action: z.literal('role.removal.approve'), removalId: z.uuid() }).strict(),
  z.object({ action: z.literal('role.removal.restore_review'), removalId: z.uuid() }).strict(),
  z.object({ action: z.literal('role.removal.cancel'), removalId: z.uuid() }).strict(),
  z.object({ action: z.literal('permissions.role'), role: z.enum(EDITABLE_ROLES), permissions: permissionMap }).strict(),
  z.object({ action: z.literal('permissions.member'), userId: z.uuid(), overrides: overrideMap }).strict(),
  z.object({ action: z.literal('password.change'), password: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`).max(72, 'Use at most 72 characters.') }).strict(),
  z.object({ action: z.literal('passkey.authorize') }).strict(),
  z.object({ action: z.literal('domains.add'), domain: z.string().trim().min(1).max(260), kind: z.enum(['allow', 'block']) }).strict(),
  z.object({ action: z.literal('domains.remove'), domain: z.string().trim().min(1).max(260) }).strict(),
  z.object({ action: z.literal('passkey.delete'), passkeyId: z.string().trim().min(1).max(100) }).strict()
])
type ActionBody = z.infer<typeof actionBody>

interface RoleRow { user_id: string; role: string; granted_at: string; revoked_at: string | null }

function requirePermission(context: ControlContext, permission: Permission): void {
  if (!context.permissions.has(permission)) throw new ApiError(403, 'permission_denied', 'Your role does not include this setting.', { reason: permission })
}

async function refuse(context: ControlContext, action: string, errorCode: string, status: number, message: string, targetId?: string): Promise<never> {
  await recordBoundedDenial(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action, targetType: 'settings', targetId, errorCode })
  throw new ApiError(status, errorCode, message)
}

function ownerOnly(context: ControlContext, action: string): Promise<void> {
  return context.role === 'owner' ? Promise.resolve() : refuse(context, action, 'owner_only', 403, 'Only the owner can change this.')
}

async function emailOf(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.auth.admin.getUserById(userId)
  return data?.user?.email ?? ''
}

/**
 * Active owners who are NOT currently locked in a 30-day removal countdown or 2-day restore review.
 * Only unrestricted active owners can approve non-owner removals or count toward the last-owner floor.
 */
async function activeUnrestrictedOwnerIds(admin: SupabaseClient, openRemovals: readonly RoleRemovalRow[]): Promise<string[]> {
  const { data, error } = await admin.from('control_roles').select('user_id, role, revoked_at')
  if (error) throw new ApiError(503, 'control_unavailable', 'Owners could not be verified right now.')
  const restricted = new Set(
    openRemovals
      .filter(row => row.target_role === 'owner' && (row.status === 'countdown' || row.status === 'review_restore'))
      .map(row => row.target_user_id)
  )
  return ((data ?? []) as Array<{ user_id: string; role: string; revoked_at: string | null }>)
    .filter(row => row.role === 'owner' && !row.revoked_at && !restricted.has(row.user_id))
    .map(row => row.user_id)
}

async function readSite(admin: SupabaseClient) {
  const { data, error } = await admin.from('site_settings').select(SITE_COLUMNS).eq('id', 1).maybeSingle()
  if (error) throw new ApiError(503, 'control_unavailable', 'Settings could not be loaded right now.')
  const row = (data ?? {}) as Record<string, unknown>
  return {
    maintenanceEnabled: row.maintenance_enabled === true,
    maintenanceMessage: typeof row.maintenance_message === 'string' ? row.maintenance_message : '',
    siteDown: row.site_down === true,
    signupEnabled: row.signup_enabled !== false,
    signinEnabled: row.signin_enabled !== false,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null
  }
}

async function readMembers(admin: SupabaseClient) {
  const { data, error } = await admin.from('control_roles').select('user_id, role, granted_at, revoked_at').order('granted_at', { ascending: true })
  if (error) throw new ApiError(503, 'control_unavailable', 'Team members could not be loaded right now.')
  const { data: overrides, error: overridesError } = await admin.from('control_member_permissions').select('user_id, permission, allowed')
  if (overridesError) throw new ApiError(503, 'control_unavailable', 'Team permissions could not be loaded right now.')
  return Promise.all(((data ?? []) as RoleRow[]).map(async row => {
    const active = !row.revoked_at
    let mfaEnrolled = false
    if (active) {
      const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: row.user_id })
      mfaEnrolled = (factors?.factors ?? []).some(factor => factor.status === 'verified')
    }
    return {
      userId: row.user_id,
      email: await emailOf(admin, row.user_id),
      role: row.role,
      grantedAt: row.granted_at,
      revokedAt: row.revoked_at,
      active,
      mfaEnrolled,
      overrides: Object.fromEntries(((overrides ?? []) as Array<{ user_id: string; permission: string; allowed: boolean }>)
        .filter(item => item.user_id === row.user_id)
        .map(item => [item.permission, item.allowed ? 'allow' : 'deny']))
    }
  }))
}

async function readRemovals(
  admin: SupabaseClient,
  context: ControlContext,
  openRows: readonly RoleRemovalRow[]
): Promise<RoleRemovalView[]> {
  if (openRows.length === 0) return []
  const activeOwnerIds = await activeUnrestrictedOwnerIds(admin, openRows)
  const now = new Date()
  return Promise.all(openRows.map(async row => {
    const isOwnerTarget = row.target_role === 'owner'
    const approvedBy = Array.isArray(row.approved_by) ? row.approved_by : []
    const requiredApprovers = isOwnerTarget ? 1 : Math.max(1, activeOwnerIds.length)
    const approvedCount = isOwnerTarget
      ? (approvedBy.includes(row.target_user_id) ? 1 : 0)
      : activeOwnerIds.filter(ownerId => approvedBy.includes(ownerId)).length
    const canApprove = row.status === 'pending_approval' && (
      isOwnerTarget
        ? context.userId === row.target_user_id && !context.ownerReadOnly
        : context.role === 'owner' && !context.ownerReadOnly && !approvedBy.includes(context.userId)
    )
    const canRequestRestore = isOwnerTarget && row.status === 'countdown' && context.userId === row.target_user_id
    const [targetEmail, initiatedByEmail] = await Promise.all([
      emailOf(admin, row.target_user_id),
      row.initiated_by ? emailOf(admin, row.initiated_by) : Promise.resolve('')
    ])
    return {
      id: row.id,
      targetUserId: row.target_user_id,
      targetEmail,
      targetRole: row.target_role,
      status: row.status,
      initiatedBy: row.initiated_by,
      initiatedByEmail,
      initiatedAt: row.initiated_at,
      approvedBy,
      requiredApprovers,
      approvedCount,
      canApprove,
      canRequestRestore,
      countdownStartedAt: row.countdown_started_at,
      effectiveOnIst: row.effective_on_ist,
      daysRemaining: row.status === 'countdown' && row.effective_on_ist ? istDaysRemaining(row.effective_on_ist, now) : null,
      restoreRequestedAt: row.restore_requested_at,
      restoreOnIst: row.restore_on_ist,
      restoreDaysRemaining: row.status === 'review_restore' && row.restore_on_ist ? istDaysRemaining(row.restore_on_ist, now) : null
    }
  }))
}

async function readMatrix(admin: SupabaseClient) {
  const { data, error } = await admin.from('control_role_permissions').select('role, permission, allowed')
  if (error) throw new ApiError(503, 'control_unavailable', 'Permissions could not be loaded right now.')
  const matrix: Record<string, Record<string, boolean>> = {}
  for (const role of EDITABLE_ROLES) matrix[role] = Object.fromEntries(PERMISSIONS.map(permission => [permission, false]))
  for (const row of (data ?? []) as Array<{ role: string; permission: string; allowed: boolean }>) {
    if (matrix[row.role] && (PERMISSIONS as readonly string[]).includes(row.permission)) matrix[row.role]![row.permission] = row.allowed
  }
  return matrix
}

async function readActivity(admin: SupabaseClient) {
  const { data, error } = await admin.from('control_audit_events')
    .select('id, created_at, actor_id, actor_role, action, target_type, target_id, result, error_category, reason, before_summary, after_summary')
    .in('action', SETTINGS_ACTIVITY)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new ApiError(503, 'control_unavailable', 'Settings activity could not be loaded right now.')
  return (data ?? []) as Array<Record<string, unknown>>
}

export interface EmailDomainsView {
  builtIn: readonly string[]
  allowed: Array<{ domain: string; createdAt: string }>
  blocked: Array<{ domain: string; createdAt: string }>
  list: { count: number; refreshedAt: string | null }
}

async function readEmailDomains(admin: SupabaseClient): Promise<EmailDomainsView> {
  const [rules, count, refresh] = await Promise.all([
    admin.from('email_domain_rules').select('domain, kind, created_at').order('domain', { ascending: true }),
    admin.from('disposable_email_domains').select('domain', { count: 'exact', head: true }),
    admin.from('disposable_email_domain_refreshes').select('applied_at').eq('outcome', 'applied').order('applied_at', { ascending: false }).limit(1).maybeSingle()
  ])
  if (rules.error) throw new ApiError(503, 'control_unavailable', 'Email domain rules could not be loaded right now.')
  const rows = (rules.data ?? []) as Array<{ domain: string; kind: string; created_at: string }>
  return {
    builtIn: BUILT_IN_ALLOWED_DOMAINS,
    allowed: rows.filter(row => row.kind === 'allow').map(row => ({ domain: row.domain, createdAt: row.created_at })),
    blocked: rows.filter(row => row.kind === 'block').map(row => ({ domain: row.domain, createdAt: row.created_at })),
    list: { count: count.count ?? 0, refreshedAt: (refresh.data as { applied_at?: string } | null)?.applied_at ?? null }
  }
}

async function readPasskeys(admin: SupabaseClient, userId: string): Promise<{ available: boolean; items: Array<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }> }> {
  try {
    const { data, error } = await admin.auth.admin.passkey.listPasskeys({ userId })
    if (error) return { available: false, items: [] }
    return { available: true, items: (data ?? []).map(item => ({ id: item.id, name: item.friendly_name ?? 'Passkey', createdAt: item.created_at, lastUsedAt: item.last_used_at ?? null })) }
  } catch {
    return { available: false, items: [] }
  }
}

async function handleGet(context: ControlContext, res: ApiResponse): Promise<void> {
  const can = (permission: Permission) => context.permissions.has(permission)
  const admin = context.admin
  // Reconcile due countdowns & 2-day restores before reading members so UI always reflects reality.
  const openRemovals = can('roles.manage') ? await reconcileRoleRemovals(admin, context.requestId) : []
  const [site, members, removals, matrix, activity, passkeys, emailDomains] = await Promise.all([
    readSite(admin),
    can('roles.manage') ? readMembers(admin) : Promise.resolve(null),
    can('roles.manage') ? readRemovals(admin, context, openRemovals) : Promise.resolve(null),
    can('roles.manage') ? readMatrix(admin) : Promise.resolve(null),
    can('audit.view') ? readActivity(admin) : Promise.resolve(null),
    context.role === 'owner' ? readPasskeys(admin, context.userId) : Promise.resolve(null),
    can('settings.domains') ? readEmailDomains(admin) : Promise.resolve(null)
  ])
  sendJson(res, 200, {
    me: {
      userId: context.userId,
      role: context.role,
      permissions: [...context.permissions],
      assignableRoles: can('roles.manage') ? assignableRoles(context.role) : [],
      ownerReadOnly: context.ownerReadOnly,
      ownerRemovalStatus: context.ownerRemovalStatus
    },
    site,
    members,
    removals,
    matrix,
    activity,
    passkeys,
    emailDomains
  })
}

async function audit(context: ControlContext, action: string, targetType: string, targetId: string | undefined, summary: Record<string, unknown>, reason?: string, severity: 'info' | 'notice' | 'warning' | 'critical' = 'notice'): Promise<boolean> {
  return recordAuditEvent(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action, targetType, targetId, outcome: 'success', severity, summary, reason })
}

async function handlePost(req: ApiRequest, context: ControlContext, res: ApiResponse): Promise<void> {
  const parsed = actionBody.safeParse(await readJson(req, 8_000))
  if (!parsed.success) throw new ApiError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Check the setting and try again.')
  const body: ActionBody = parsed.data
  const admin = context.admin

  // Hardcore read-only gate: an owner in 30-day removal countdown or 2-day restore review
  // can ONLY submit `role.removal.restore_review`. Every other Settings mutation is blocked.
  if (context.ownerReadOnly && body.action !== 'role.removal.restore_review') {
    await refuse(
      context,
      body.action,
      'owner_removal_readonly',
      403,
      'Your Control Centre access is read-only during your owner removal countdown. You can only submit a restore review in Settings → Roles.'
    )
  }

  switch (body.action) {
    case 'site.update': {
      requirePermission(context, 'settings.site')
      const message = cleanText(body.maintenanceMessage, 500)
      const before = await readSite(admin)
      await requireStepUp(context, { action: 'settings.site', targetType: 'site_settings' })
      const next = {
        maintenance_enabled: body.maintenanceEnabled,
        site_down: body.siteDown,
        maintenance_message: message || (body.siteDown || body.maintenanceEnabled ? DEFAULT_DOWN_MESSAGE : ''),
        updated_by: context.userId,
        updated_at: new Date().toISOString()
      }
      const { error } = await admin.from('site_settings').update(next).eq('id', 1)
      if (error) throw new ApiError(502, 'save_failed', 'The site status could not be saved. Nothing changed.')
      await audit(context, 'settings.site', 'site_settings', 'site', { before: `${before.maintenanceEnabled ? 'notice' : 'no-notice'}/${before.siteDown ? 'down' : 'up'}`, maintenance: body.maintenanceEnabled, site_down: body.siteDown }, undefined, body.siteDown ? 'critical' : 'warning')
      sendJson(res, 200, { ok: true, site: await readSite(admin) })
      return
    }
    case 'access.update': {
      requirePermission(context, 'settings.access')
      const before = await readSite(admin)
      await requireStepUp(context, { action: 'settings.access', targetType: 'site_settings' })
      const { error } = await admin.from('site_settings').update({ signup_enabled: body.signupEnabled, signin_enabled: body.signinEnabled, updated_by: context.userId, updated_at: new Date().toISOString() }).eq('id', 1)
      if (error) throw new ApiError(502, 'save_failed', 'The sign-up and sign-in switches could not be saved. Nothing changed.')
      await audit(context, 'settings.access', 'site_settings', 'access', { before: `signup:${before.signupEnabled ? 'on' : 'off'}/signin:${before.signinEnabled ? 'on' : 'off'}`, signup: body.signupEnabled, signin: body.signinEnabled }, undefined, 'warning')
      sendJson(res, 200, { ok: true, site: await readSite(admin) })
      return
    }
    case 'role.assign': {
      requirePermission(context, 'roles.manage')
      if (!assignableRoles(context.role).includes(body.role)) await refuse(context, 'role.assign', 'owner_only', 403, 'Only the owner can give the Owner or Admin role.')
      const email = body.email.toLowerCase()
      if (email.includes('%') || !email.includes('@')) throw new ApiError(404, 'user_not_found', 'No Stracker account uses that email. The person must sign up first.')
      const { data: profile, error: profileError } = await admin.from('profiles').select('user_id, email').ilike('email', email).limit(2)
      if (profileError) throw new ApiError(503, 'control_unavailable', 'Accounts could not be searched right now.')
      const match = ((profile ?? []) as Array<{ user_id: string; email: string }>).filter(row => (row.email ?? '').toLowerCase() === email)
      if (match.length !== 1 || !isUuid(match[0]!.user_id)) throw new ApiError(404, 'user_not_found', 'No Stracker account uses that email. The person must sign up first.')
      const targetId = match[0]!.user_id
      if ((await emailOf(admin, targetId)).toLowerCase() !== email) throw new ApiError(404, 'user_not_found', 'No Stracker account uses that email. The person must sign up first.')
      if (targetId === context.userId) await refuse(context, 'role.assign', 'self_action_blocked', 409, 'You cannot change your own role.', targetId)
      const openRemovals = await reconcileRoleRemovals(admin, context.requestId)
      const { data: existing, error: existingError } = await admin.from('control_roles').select('role, revoked_at').eq('user_id', targetId).maybeSingle()
      if (existingError) throw new ApiError(503, 'control_unavailable', 'Roles could not be checked. Nothing changed.')
      const wasActive = Boolean(existing && !existing.revoked_at)
      const previousRole = wasActive && isControlRole(existing?.role) ? existing!.role as ControlRole : null
      // Hardcore owner protection: one owner can NEVER change another owner's role.
      if (previousRole === 'owner') {
        await refuse(context, 'role.assign', 'owner_protected', 403, 'An owner cannot change another owner’s role.', targetId)
      }
      if (previousRole === body.role) throw new ApiError(409, 'no_change', 'This person already has that role.')
      if (previousRole && !assignableRoles(context.role).includes(previousRole)) await refuse(context, 'role.assign', 'owner_only', 403, 'Only the owner can change an Owner or Admin.', targetId)
      if (openRemovals.some(row => row.target_user_id === targetId)) {
        await refuse(context, 'role.assign', 'removal_in_progress', 409, 'This person has an active removal request or countdown. Resolve it before changing their role.', targetId)
      }
      await requireStepUp(context, { action: 'role.assign', targetType: 'user', targetId })
      let mfaReset = 0
      if (!wasActive) {
        // A new role holder always sets up their own authenticator from scratch on first console access.
        const reset = await deleteAllFactors(admin, targetId)
        if (!reset.ok) throw new ApiError(502, 'auth_update_failed', 'The person’s old authenticator could not be cleared. Nothing changed; try again.')
        mfaReset = reset.removed
        await admin.from('control_member_permissions').delete().eq('user_id', targetId)
      }
      // Passkeys are the owner's alone: anyone given a non-owner role keeps none.
      const passkeysRemoved = body.role === 'owner' ? 0 : await deleteAllPasskeys(admin, targetId)
      const now = new Date().toISOString()
      const write = existing
        ? admin.from('control_roles').update({ role: body.role, revoked_at: null, granted_by: context.userId, grant_source: 'console', updated_at: now, ...(wasActive ? {} : { granted_at: now }) }).eq('user_id', targetId)
        : admin.from('control_roles').insert({ user_id: targetId, role: body.role, revoked_at: null, granted_by: context.userId, grant_source: 'console', reason: 'Given in Control Centre → Settings' })
      const { error } = await write
      if (error) {
        if (/last_owner/.test(error.message ?? '')) await refuse(context, 'role.assign', 'last_owner', 409, 'Stracker must always keep at least one owner.', targetId)
        throw new ApiError(502, 'save_failed', 'The role could not be saved. Nothing changed.')
      }
      await audit(context, 'role.assign', 'user', targetId, { before: previousRole ?? 'none', after: body.role, mfa_reset: mfaReset, passkeys_removed: passkeysRemoved }, undefined, 'warning')
      sendJson(res, 200, { ok: true, userId: targetId, role: body.role, mfaSetupRequired: !wasActive })
      return
    }
    case 'role.remove': {
      requirePermission(context, 'roles.manage')
      const targetId = body.userId
      if (targetId === context.userId) await refuse(context, 'role.remove', 'self_action_blocked', 409, 'You cannot remove your own role.', targetId)
      const openRemovals = await reconcileRoleRemovals(admin, context.requestId)
      if (openRemovals.some(row => row.target_user_id === targetId)) {
        throw new ApiError(409, 'removal_already_pending', 'A removal request or countdown is already active for this person.')
      }
      const { data: existing, error: existingError } = await admin.from('control_roles').select('role, revoked_at').eq('user_id', targetId).maybeSingle()
      if (existingError) throw new ApiError(503, 'control_unavailable', 'Roles could not be checked. Nothing changed.')
      if (!existing || existing.revoked_at || !isControlRole(existing.role)) throw new ApiError(409, 'no_change', 'This person has no active role.')
      const targetRole = existing.role as ControlRole
      if (!assignableRoles(context.role).includes(targetRole)) await refuse(context, 'role.remove', 'owner_only', 403, 'Only the owner can remove an Owner or Admin.', targetId)

      const activeOwnerIds = await activeUnrestrictedOwnerIds(admin, openRemovals)
      const now = new Date()
      const nowIso = now.toISOString()
      const removalId = randomUUID()

      if (targetRole === 'owner') {
        if (context.role !== 'owner') await refuse(context, 'role.remove', 'owner_only', 403, 'Only an owner can request removal of another owner.', targetId)
        if (!activeOwnerIds.includes(targetId)) throw new ApiError(409, 'removal_already_pending', 'This owner already has a removal countdown active.')
        if (activeOwnerIds.length < 2) {
          await refuse(context, 'role.remove', 'last_owner', 409, 'Stracker must always keep at least one active owner.', targetId)
        }
        await requireStepUp(context, { action: 'role.removal.request', targetType: 'user', targetId })
        const { error } = await admin.from('control_role_removals').insert({
          id: removalId,
          target_user_id: targetId,
          target_role: 'owner',
          status: 'pending_approval',
          initiated_by: context.userId,
          initiated_at: nowIso,
          approved_by: [],
          countdown_started_at: null,
          effective_on_ist: null,
          restore_requested_at: null,
          restore_on_ist: null,
          resolved_at: null,
          updated_at: nowIso
        })
        if (error) {
          if (error.code === '23505') throw new ApiError(409, 'removal_already_pending', 'A removal request is already active for this owner.')
          throw new ApiError(502, 'save_failed', 'The owner removal request could not be created. Nothing changed.')
        }
        await audit(context, 'role.removal.request', 'user', targetId, { target_role: 'owner', status: 'pending_approval', removal_id: removalId }, undefined, 'critical')
        sendJson(res, 200, { ok: true, removalId, userId: targetId, targetRole: 'owner', status: 'pending_approval', requiresTargetConsent: true })
        return
      }

      // Non-owner authority removal: requires unanimous approval from ALL active unrestricted owners,
      // then starts a 7-day IST countdown before automatic revocation.
      await requireStepUp(context, { action: 'role.removal.request', targetType: 'user', targetId })
      const initialApprovedBy = context.role === 'owner' && !context.ownerReadOnly ? [context.userId] : []
      const allApproved = hasAllOwnerApprovals(activeOwnerIds, initialApprovedBy)
      const status = allApproved ? 'countdown' : 'pending_approval'
      const effectiveOnIst = allApproved ? addIstDays(now, MEMBER_REMOVAL_COUNTDOWN_DAYS) : null
      const { error } = await admin.from('control_role_removals').insert({
        id: removalId,
        target_user_id: targetId,
        target_role: targetRole,
        status,
        initiated_by: context.userId,
        initiated_at: nowIso,
        approved_by: initialApprovedBy,
        countdown_started_at: allApproved ? nowIso : null,
        effective_on_ist: effectiveOnIst,
        restore_requested_at: null,
        restore_on_ist: null,
        resolved_at: null,
        updated_at: nowIso
      })
      if (error) {
        if (error.code === '23505') throw new ApiError(409, 'removal_already_pending', 'A removal request is already active for this person.')
        throw new ApiError(502, 'save_failed', 'The removal request could not be created. Nothing changed.')
      }
      await audit(context, 'role.removal.request', 'user', targetId, {
        target_role: targetRole,
        status,
        removal_id: removalId,
        approved_count: initialApprovedBy.length,
        required_approvers: Math.max(1, activeOwnerIds.length),
        ...(effectiveOnIst ? { effective_on_ist: effectiveOnIst, countdown_days: MEMBER_REMOVAL_COUNTDOWN_DAYS } : {})
      }, undefined, 'warning')
      sendJson(res, 200, {
        ok: true,
        removalId,
        userId: targetId,
        targetRole,
        status,
        approvedCount: initialApprovedBy.length,
        requiredApprovers: Math.max(1, activeOwnerIds.length),
        effectiveOnIst,
        daysRemaining: allApproved ? MEMBER_REMOVAL_COUNTDOWN_DAYS : null
      })
      return
    }
    case 'role.removal.approve': {
      const openRemovals = await reconcileRoleRemovals(admin, context.requestId)
      const row = openRemovals.find(item => item.id === body.removalId)
      if (!row) throw new ApiError(404, 'not_found', 'That removal request was not found or is already finished.')
      if (row.status !== 'pending_approval') throw new ApiError(409, 'no_change', 'This removal request is no longer awaiting approval.')

      const activeOwnerIds = await activeUnrestrictedOwnerIds(admin, openRemovals)
      const now = new Date()
      const nowIso = now.toISOString()

      if (row.target_role === 'owner') {
        if (context.userId !== row.target_user_id) {
          await refuse(context, 'role.removal.approve', 'target_owner_only', 403, 'Only the targeted owner can approve their own removal.', row.target_user_id)
        }
        const otherActiveOwners = activeOwnerIds.filter(id => id !== row.target_user_id)
        if (otherActiveOwners.length < 1) {
          await refuse(context, 'role.removal.approve', 'last_owner', 409, 'Stracker must always keep at least one active owner.', row.target_user_id)
        }
        await requireStepUp(context, { action: 'role.removal.approve', targetType: 'user', targetId: row.target_user_id })
        const effectiveOnIst = addIstDays(now, OWNER_REMOVAL_COUNTDOWN_DAYS)
        const { error } = await admin
          .from('control_role_removals')
          .update({
            status: 'countdown',
            approved_by: [context.userId],
            countdown_started_at: nowIso,
            effective_on_ist: effectiveOnIst,
            updated_at: nowIso
          })
          .eq('id', row.id)
        if (error) throw new ApiError(502, 'save_failed', 'The removal approval could not be saved. Nothing changed.')
        await audit(context, 'role.removal.approve', 'user', row.target_user_id, {
          target_role: 'owner',
          status: 'countdown',
          removal_id: row.id,
          effective_on_ist: effectiveOnIst,
          countdown_days: OWNER_REMOVAL_COUNTDOWN_DAYS
        }, undefined, 'critical')
        sendJson(res, 200, {
          ok: true,
          removalId: row.id,
          status: 'countdown',
          effectiveOnIst,
          daysRemaining: OWNER_REMOVAL_COUNTDOWN_DAYS,
          ownerReadOnly: true
        })
        return
      }

      // Non-owner removal approval: EVERY active unrestricted owner must approve.
      if (context.role !== 'owner' || context.ownerReadOnly) {
        await refuse(context, 'role.removal.approve', 'owner_only', 403, 'Only active owners can approve a role removal.', row.target_user_id)
      }
      const currentApproved = Array.isArray(row.approved_by) ? row.approved_by : []
      if (currentApproved.includes(context.userId)) {
        throw new ApiError(409, 'already_approved', 'You have already approved this removal request.')
      }
      await requireStepUp(context, { action: 'role.removal.approve', targetType: 'user', targetId: row.target_user_id })
      const nextApproved = [...currentApproved, context.userId]
      const allApproved = hasAllOwnerApprovals(activeOwnerIds, nextApproved)
      const nextStatus = allApproved ? 'countdown' : 'pending_approval'
      const effectiveOnIst = allApproved ? addIstDays(now, MEMBER_REMOVAL_COUNTDOWN_DAYS) : null
      const { error } = await admin
        .from('control_role_removals')
        .update({
          status: nextStatus,
          approved_by: nextApproved,
          ...(allApproved ? { countdown_started_at: nowIso, effective_on_ist: effectiveOnIst } : {}),
          updated_at: nowIso
        })
        .eq('id', row.id)
      if (error) throw new ApiError(502, 'save_failed', 'Your approval could not be saved. Nothing changed.')
      const approvedCount = activeOwnerIds.filter(ownerId => nextApproved.includes(ownerId)).length
      await audit(context, 'role.removal.approve', 'user', row.target_user_id, {
        target_role: row.target_role,
        status: nextStatus,
        removal_id: row.id,
        approved_count: approvedCount,
        required_approvers: Math.max(1, activeOwnerIds.length),
        ...(effectiveOnIst ? { effective_on_ist: effectiveOnIst, countdown_days: MEMBER_REMOVAL_COUNTDOWN_DAYS } : {})
      }, undefined, allApproved ? 'warning' : 'notice')
      sendJson(res, 200, {
        ok: true,
        removalId: row.id,
        status: nextStatus,
        approvedCount,
        requiredApprovers: Math.max(1, activeOwnerIds.length),
        effectiveOnIst,
        daysRemaining: allApproved ? MEMBER_REMOVAL_COUNTDOWN_DAYS : null
      })
      return
    }
    case 'role.removal.restore_review': {
      const openRemovals = await reconcileRoleRemovals(admin, context.requestId)
      const row = openRemovals.find(item => item.id === body.removalId)
      if (!row) throw new ApiError(404, 'not_found', 'That removal countdown was not found or has already finished.')
      if (row.target_role !== 'owner' || context.userId !== row.target_user_id) {
        await refuse(context, 'role.removal.restore_review', 'target_owner_only', 403, 'Only the targeted owner can submit a restore review for their own account.', row.target_user_id)
      }
      if (row.status === 'review_restore') {
        throw new ApiError(409, 'no_change', 'Your 2-day restore review is already running and cannot be paused or cancelled.')
      }
      if (row.status !== 'countdown') {
        throw new ApiError(409, 'no_change', 'A restore review can only be submitted during the 30-day removal countdown.')
      }
      await requireStepUp(context, { action: 'role.removal.restore_review', targetType: 'user', targetId: row.target_user_id })
      const now = new Date()
      const nowIso = now.toISOString()
      const restoreOnIst = addIstDays(now, OWNER_RESTORE_REVIEW_DAYS)
      const { error } = await admin
        .from('control_role_removals')
        .update({
          status: 'review_restore',
          restore_requested_at: nowIso,
          restore_on_ist: restoreOnIst,
          updated_at: nowIso
        })
        .eq('id', row.id)
      if (error) throw new ApiError(502, 'save_failed', 'The restore review could not be started. Try again.')
      await audit(context, 'role.removal.restore_review', 'user', row.target_user_id, {
        status: 'review_restore',
        removal_id: row.id,
        restore_on_ist: restoreOnIst,
        restore_days: OWNER_RESTORE_REVIEW_DAYS
      }, undefined, 'critical')
      sendJson(res, 200, {
        ok: true,
        removalId: row.id,
        status: 'review_restore',
        restoreOnIst,
        restoreDaysRemaining: OWNER_RESTORE_REVIEW_DAYS
      })
      return
    }
    case 'role.removal.cancel': {
      requirePermission(context, 'roles.manage')
      const openRemovals = await reconcileRoleRemovals(admin, context.requestId)
      const row = openRemovals.find(item => item.id === body.removalId)
      if (!row) throw new ApiError(404, 'not_found', 'That removal request was not found.')
      if (row.status === 'review_restore') {
        await refuse(context, 'role.removal.cancel', 'owner_restore_unstoppable', 409, 'An owner restore review cannot be paused, cancelled, or stepped down.', row.target_user_id)
      }
      if (row.status !== 'pending_approval') {
        await refuse(context, 'role.removal.cancel', 'countdown_locked', 409, 'A removal countdown cannot be cancelled once started.', row.target_user_id)
      }
      if (context.role !== 'owner' && row.initiated_by !== context.userId) {
        await refuse(context, 'role.removal.cancel', 'owner_only', 403, 'Only an active owner or the initiator can cancel a pending removal request.', row.target_user_id)
      }
      await requireStepUp(context, { action: 'role.removal.cancel', targetType: 'user', targetId: row.target_user_id })
      const nowIso = new Date().toISOString()
      const { error } = await admin
        .from('control_role_removals')
        .update({ status: 'cancelled', resolved_at: nowIso, updated_at: nowIso })
        .eq('id', row.id)
      if (error) throw new ApiError(502, 'save_failed', 'The pending removal request could not be cancelled.')
      await audit(context, 'role.removal.cancel', 'user', row.target_user_id, { target_role: row.target_role, status: 'cancelled', removal_id: row.id }, undefined, 'notice')
      sendJson(res, 200, { ok: true, removalId: row.id, status: 'cancelled' })
      return
    }
    case 'permissions.role': {
      await ownerOnly(context, 'permissions.role')
      const before = await readMatrix(admin)
      const changes = Object.entries(body.permissions).filter(([permission, allowed]) => before[body.role]?.[permission] !== allowed)
      if (changes.length === 0) throw new ApiError(409, 'no_change', 'Nothing changed.')
      await requireStepUp(context, { action: 'permissions.role', targetType: 'role', targetId: body.role })
      const now = new Date().toISOString()
      const { error } = await admin.from('control_role_permissions').upsert(changes.map(([permission, allowed]) => ({ role: body.role, permission, allowed, updated_by: context.userId, updated_at: now })), { onConflict: 'role,permission' })
      if (error) throw new ApiError(502, 'save_failed', 'The permissions could not be saved. Nothing changed.')
      await audit(context, 'permissions.role', 'role', body.role, { changed: changes.length, granted: changes.filter(([, allowed]) => allowed).length, revoked: changes.filter(([, allowed]) => !allowed).length }, changes.map(([permission, allowed]) => `${permission}: ${allowed ? 'on' : 'off'}`).join('; '))
      sendJson(res, 200, { ok: true, matrix: await readMatrix(admin) })
      return
    }
    case 'permissions.member': {
      await ownerOnly(context, 'permissions.member')
      const targetId = body.userId
      const { data: existing, error: existingError } = await admin.from('control_roles').select('role, revoked_at').eq('user_id', targetId).maybeSingle()
      if (existingError) throw new ApiError(503, 'control_unavailable', 'Roles could not be checked. Nothing changed.')
      if (!existing || existing.revoked_at) throw new ApiError(409, 'no_change', 'This person has no active role.')
      if (existing.role === 'owner') throw new ApiError(409, 'owner_protected', 'The owner always has every permission.')
      await requireStepUp(context, { action: 'permissions.member', targetType: 'user', targetId })
      const rows = Object.entries(body.overrides).filter(([, value]) => value !== 'inherit').map(([permission, value]) => ({ user_id: targetId, permission, allowed: value === 'allow', updated_by: context.userId, updated_at: new Date().toISOString() }))
      const { error: deleteError } = await admin.from('control_member_permissions').delete().eq('user_id', targetId)
      if (deleteError) throw new ApiError(502, 'save_failed', 'The personal permissions could not be saved.')
      if (rows.length) {
        const { error } = await admin.from('control_member_permissions').insert(rows)
        if (error) throw new ApiError(502, 'save_failed', 'The personal permissions could not be saved.')
      }
      await audit(context, 'permissions.member', 'user', targetId, { allow: rows.filter(row => row.allowed).length, deny: rows.filter(row => !row.allowed).length }, rows.map(row => `${row.permission}: ${row.allowed ? 'allow' : 'deny'}`).join('; ') || 'all inherited from role')
      sendJson(res, 200, { ok: true })
      return
    }
    case 'password.change': {
      await requireStepUp(context, { action: 'security.password', targetType: 'user', targetId: context.userId })
      const { error } = await admin.auth.admin.updateUserById(context.userId, { password: body.password })
      if (error) {
        await recordAuditEvent(admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action: 'security.password', targetType: 'user', targetId: context.userId, outcome: 'failed', severity: 'warning', errorCode: 'auth_update_failed' })
        throw new ApiError(400, 'password_rejected', 'Supabase did not accept this password. Use a longer or less common one.')
      }
      await audit(context, 'security.password', 'user', context.userId, {}, undefined, 'warning')
      sendJson(res, 200, { ok: true })
      return
    }
    case 'domains.add': {
      requirePermission(context, 'settings.domains')
      const domain = normalizeDomainInput(body.domain)
      if (!domain) throw new ApiError(400, 'invalid_domain', 'Enter a domain like example.com: lowercase letters, numbers, dots and dashes, without @.')
      if (isBuiltInAllowedDomain(domain)) {
        throw new ApiError(409, 'built_in_domain', body.kind === 'block' ? 'This provider is on the built-in always-allowed list and cannot be blocked.' : 'This provider is already always allowed.')
      }
      const { data: existing, error: existingError } = await admin.from('email_domain_rules').select('kind').eq('domain', domain).maybeSingle()
      if (existingError) throw new ApiError(503, 'control_unavailable', 'Email domain rules could not be checked. Nothing changed.')
      if (existing?.kind === body.kind) throw new ApiError(409, 'no_change', body.kind === 'allow' ? 'This domain is already always allowed.' : 'This domain is already blocked.')
      await requireStepUp(context, { action: 'settings.email_domain', targetType: 'email_domain', targetId: domain })
      const now = new Date().toISOString()
      const { error } = await admin.from('email_domain_rules').upsert({ domain, kind: body.kind, created_by: context.userId, updated_at: now, ...(existing ? {} : { created_at: now }) }, { onConflict: 'domain' })
      if (error) throw new ApiError(502, 'save_failed', 'The domain could not be saved. Nothing changed.')
      await audit(context, 'settings.email_domain', 'email_domain', domain, { before: existing?.kind ?? 'none', after: body.kind })
      sendJson(res, 200, { ok: true, emailDomains: await readEmailDomains(admin) })
      return
    }
    case 'domains.remove': {
      requirePermission(context, 'settings.domains')
      const domain = normalizeDomainInput(body.domain)
      if (!domain) throw new ApiError(400, 'invalid_domain', 'That is not a valid domain.')
      const { data: existing, error: existingError } = await admin.from('email_domain_rules').select('kind').eq('domain', domain).maybeSingle()
      if (existingError) throw new ApiError(503, 'control_unavailable', 'Email domain rules could not be checked. Nothing changed.')
      if (!existing) throw new ApiError(409, 'no_change', 'This domain has no custom rule.')
      await requireStepUp(context, { action: 'settings.email_domain', targetType: 'email_domain', targetId: domain })
      const { error } = await admin.from('email_domain_rules').delete().eq('domain', domain)
      if (error) throw new ApiError(502, 'save_failed', 'The domain could not be removed. Nothing changed.')
      await audit(context, 'settings.email_domain', 'email_domain', domain, { before: existing.kind, after: 'none' })
      sendJson(res, 200, { ok: true, emailDomains: await readEmailDomains(admin) })
      return
    }
    case 'passkey.authorize': {
      await ownerOnly(context, 'security.passkey_add')
      await requireStepUp(context, { action: 'security.passkey_add', targetType: 'user', targetId: context.userId })
      await audit(context, 'security.passkey_add', 'user', context.userId, {}, undefined, 'warning')
      sendJson(res, 200, { ok: true })
      return
    }
    case 'passkey.delete': {
      await ownerOnly(context, 'security.passkey_remove')
      await requireStepUp(context, { action: 'security.passkey_remove', targetType: 'user', targetId: context.userId })
      const { error } = await admin.auth.admin.passkey.deletePasskey({ userId: context.userId, passkeyId: body.passkeyId })
      if (error) throw new ApiError(502, 'save_failed', 'The passkey could not be removed.')
      await audit(context, 'security.passkey_remove', 'user', context.userId, {}, undefined, 'warning')
      sendJson(res, 200, { ok: true })
      return
    }
  }
}

export async function settingsHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  // permission null: any active role holder at aal2 may open Settings (own password, own passkey);
  // every section and every save checks its own permission inside.
  // allowDuringOwnerReadOnly: true lets an owner in removal countdown submit ONLY `role.removal.restore_review`.
  await controlHandler(req, res, ['GET', 'POST'], { requireAal2: true, permission: null, allowDuringOwnerReadOnly: true }, async context => {
    if (req.method === 'GET') await handleGet(context, res)
    else await handlePost(req, context, res)
  })
}
