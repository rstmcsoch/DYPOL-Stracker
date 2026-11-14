import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError, readJson, sendJson } from '../http.js'
import { controlHandler, recordAuditEvent, recordBoundedDenial, requireStepUp, type ControlContext } from '../control.js'
import { deleteAllPasskeys } from '../control-passkeys.js'
import { cleanText, isUuid } from '../control-policy.js'
import {
  CONTROL_ROLES,
  EDITABLE_ROLES,
  PERMISSIONS,
  assignableRoles,
  isControlRole,
  type ControlRole,
  type Permission
} from '../../../src/lib/control-permissions.js'
import { MIN_PASSWORD_LENGTH } from '../../../src/lib/auth-rules.js'
import { BUILT_IN_ALLOWED_DOMAINS, isBuiltInAllowedDomain, normalizeDomainInput } from '../../../src/lib/email-domains.js'

/**
 * Control Center → Settings.
 *   GET  /api/control/settings      what the signed-in role holder may see (site status, access
 *                                   switches, members, permission matrix, settings activity, passkeys)
 *   POST /api/control/settings      { action, ... } one change. EVERY save requires:
 *                                   session + active role + aal2 + the action's permission + a
 *                                   fresh single-use authenticator verification (requireStepUp).
 * Never returns or logs passwords, codes, tokens or factor secrets.
 */

const SITE_COLUMNS = 'maintenance_enabled, maintenance_message, site_down, signup_enabled, signin_enabled, updated_at'
const SETTINGS_ACTIVITY = ['settings.site', 'settings.access', 'role.assign', 'role.remove', 'permissions.role', 'permissions.member', 'security.password', 'security.passkey_add', 'security.passkey_remove', 'settings.email_domain']
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

/** Removes every MFA factor of an account (so a new or removed role holder must enroll again). */
export async function deleteAllFactors(admin: SupabaseClient, userId: string): Promise<{ removed: number; ok: boolean }> {
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId })
  if (error) return { removed: 0, ok: false }
  let removed = 0
  let ok = true
  for (const factor of data?.factors ?? []) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId })
    if (deleteError) ok = false
    else removed += 1
  }
  return { removed, ok }
}

async function emailOf(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.auth.admin.getUserById(userId)
  return data?.user?.email ?? ''
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
  const { data: overrides } = await admin.from('control_member_permissions').select('user_id, permission, allowed')
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
  const { data } = await admin.from('control_audit_events')
    .select('id, created_at, actor_id, actor_role, action, target_type, target_id, result, error_category, reason, before_summary, after_summary')
    .in('action', SETTINGS_ACTIVITY)
    .order('created_at', { ascending: false })
    .limit(50)
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
  const [site, members, matrix, activity, passkeys, emailDomains] = await Promise.all([
    readSite(admin),
    can('roles.manage') ? readMembers(admin) : Promise.resolve(null),
    can('roles.manage') ? readMatrix(admin) : Promise.resolve(null),
    can('audit.view') ? readActivity(admin) : Promise.resolve(null),
    context.role === 'owner' ? readPasskeys(admin, context.userId) : Promise.resolve(null),
    can('settings.domains') ? readEmailDomains(admin) : Promise.resolve(null)
  ])
  sendJson(res, 200, {
    me: { userId: context.userId, role: context.role, permissions: [...context.permissions], assignableRoles: can('roles.manage') ? assignableRoles(context.role) : [] },
    site,
    members,
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
      const { data: profile, error: profileError } = await admin.from('profiles').select('user_id, email').ilike('email', email).limit(2)
      if (profileError) throw new ApiError(503, 'control_unavailable', 'Accounts could not be searched right now.')
      const match = ((profile ?? []) as Array<{ user_id: string; email: string }>).filter(row => (row.email ?? '').toLowerCase() === email)
      if (match.length !== 1 || !isUuid(match[0]!.user_id)) throw new ApiError(404, 'user_not_found', 'No Stracker account uses that email. The person must sign up first.')
      const targetId = match[0]!.user_id
      if ((await emailOf(admin, targetId)).toLowerCase() !== email) throw new ApiError(404, 'user_not_found', 'No Stracker account uses that email. The person must sign up first.')
      if (targetId === context.userId) await refuse(context, 'role.assign', 'self_action_blocked', 409, 'You cannot change your own role.', targetId)
      const { data: existing, error: existingError } = await admin.from('control_roles').select('role, revoked_at').eq('user_id', targetId).maybeSingle()
      if (existingError) throw new ApiError(503, 'control_unavailable', 'Roles could not be checked. Nothing changed.')
      const wasActive = Boolean(existing && !existing.revoked_at)
      const previousRole = wasActive && isControlRole(existing?.role) ? existing!.role as ControlRole : null
      if (previousRole === body.role) throw new ApiError(409, 'no_change', 'This person already has that role.')
      if (previousRole && !assignableRoles(context.role).includes(previousRole)) await refuse(context, 'role.assign', 'owner_only', 403, 'Only the owner can change an Owner or Admin.', targetId)
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
      const { data: existing, error: existingError } = await admin.from('control_roles').select('role, revoked_at').eq('user_id', targetId).maybeSingle()
      if (existingError) throw new ApiError(503, 'control_unavailable', 'Roles could not be checked. Nothing changed.')
      if (!existing || existing.revoked_at || !isControlRole(existing.role)) throw new ApiError(409, 'no_change', 'This person has no active role.')
      if (!assignableRoles(context.role).includes(existing.role as ControlRole)) await refuse(context, 'role.remove', 'owner_only', 403, 'Only the owner can remove an Owner or Admin.', targetId)
      await requireStepUp(context, { action: 'role.remove', targetType: 'user', targetId })
      const now = new Date().toISOString()
      const { error } = await admin.from('control_roles').update({ revoked_at: now, updated_at: now }).eq('user_id', targetId)
      if (error) {
        if (/last_owner/.test(error.message ?? '')) await refuse(context, 'role.remove', 'last_owner', 409, 'Stracker must always keep at least one owner.', targetId)
        throw new ApiError(502, 'save_failed', 'The role could not be removed. Nothing changed.')
      }
      // The role is gone (every console request now answers 403). Then end everything else at once.
      await admin.from('control_member_permissions').delete().eq('user_id', targetId)
      const factors = await deleteAllFactors(admin, targetId)
      const passkeys = await deleteAllPasskeys(admin, targetId)
      const { data: sessions, error: sessionError } = await admin.rpc('control_revoke_user_sessions', { target: targetId })
      await audit(context, 'role.remove', 'user', targetId, { before: existing.role, after: 'none', factors_removed: factors.removed, factors_ok: factors.ok, passkeys_removed: passkeys, sessions_ended: typeof sessions === 'number' ? sessions : 0, sessions_ok: !sessionError }, undefined, 'warning')
      sendJson(res, 200, { ok: true, userId: targetId, factorsRemoved: factors.removed, factorsOk: factors.ok, sessionsEnded: typeof sessions === 'number' ? sessions : 0, sessionsOk: !sessionError })
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
      const { data: existing } = await admin.from('control_roles').select('role, revoked_at').eq('user_id', targetId).maybeSingle()
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
  await controlHandler(req, res, ['GET', 'POST'], { requireAal2: true, permission: null }, async context => {
    if (req.method === 'GET') await handleGet(context, res)
    else await handlePost(req, context, res)
  })
}
