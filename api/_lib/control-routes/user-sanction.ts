import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError, readJson, sendJson } from '../http.js'
import { controlHandler, recordAuditEvent, recordBoundedDenial, requireStepUp, type ControlContext } from '../control.js'
import { logAIEvent } from '../diagnostics.js'
import { isControlRole, sanctionRefusal, type ControlRole, type Permission } from '../../../src/lib/control-permissions.js'

/** Supabase Auth has no "forever"; 100 years is the conventional permanent ban. */
export const PERMANENT_BAN_DURATION = '876000h'
const MIN_BAN_SECONDS = 60
const MAX_BAN_SECONDS = 10 * 366 * 24 * 60 * 60

export const SANCTION_ACTIONS = ['warn', 'ban', 'unban', 'delete'] as const
export type SanctionAction = (typeof SANCTION_ACTIONS)[number]

const PERMISSION_FOR: Record<SanctionAction, Permission> = {
  warn: 'users.warn',
  ban: 'users.ban',
  unban: 'users.ban',
  delete: 'users.delete'
}

const reason = z.string().trim().min(5, 'Give a reason of at least 5 characters.').max(500)

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('warn'), userId: z.uuid(), reason }).strict(),
  z.object({
    action: z.literal('ban'),
    userId: z.uuid(),
    reason,
    permanent: z.boolean(),
    /** End of a temporary ban (ISO 8601 with zone). Ignored for permanent bans. */
    until: z.iso.datetime({ offset: true }).optional()
  }).strict(),
  z.object({ action: z.literal('unban'), userId: z.uuid(), reason: z.string().trim().max(500).optional() }).strict(),
  z.object({
    action: z.literal('delete'),
    userId: z.uuid(),
    /** The account's email, typed by the operator, to confirm the target. */
    confirmEmail: z.string().trim().min(3).max(320),
    reason: z.string().trim().max(500).optional()
  }).strict()
])

function actionFromRequest(req: ApiRequest): SanctionAction | null {
  const value = new URL(req.url ?? '/', 'http://localhost').searchParams.get('action')
  return (SANCTION_ACTIONS as readonly string[]).includes(value ?? '') ? value as SanctionAction : null
}

/** Ban length for Supabase Auth: permanent, or whole seconds until the chosen end time. */
export function banDuration(permanent: boolean, until: string | undefined, nowMs = Date.now()): { duration: string; untilIso: string | null } {
  if (permanent) return { duration: PERMANENT_BAN_DURATION, untilIso: null }
  const end = until ? Date.parse(until) : Number.NaN
  if (!Number.isFinite(end)) throw new ApiError(400, 'invalid_request', 'Choose when the ban ends, or make it permanent.')
  const seconds = Math.ceil((end - nowMs) / 1000)
  if (seconds < MIN_BAN_SECONDS) throw new ApiError(400, 'invalid_request', 'A temporary ban must end at least a minute from now.')
  if (seconds > MAX_BAN_SECONDS) throw new ApiError(400, 'invalid_request', 'A temporary ban can last up to 10 years. Use a permanent ban instead.')
  return { duration: `${seconds}s`, untilIso: new Date(nowMs + seconds * 1000).toISOString() }
}

/** Every object under `prefix` in a bucket (bounded walk; folders are listed one level at a time). */
async function listObjects(admin: SupabaseClient, bucket: string, prefix: string, depth = 0, found: string[] = []): Promise<string[]> {
  if (depth > 4 || found.length >= 5_000) return found
  for (let offset = 0; offset < 10_000; offset += 1_000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1_000, offset })
    if (error) throw new ApiError(502, 'storage_cleanup_failed', 'Stored files could not be listed. Nothing was deleted; try again.')
    const items = data ?? []
    for (const item of items) {
      const path = `${prefix}/${item.name}`
      if (item.id) found.push(path)
      else await listObjects(admin, bucket, path, depth + 1, found)
    }
    if (items.length < 1_000) break
  }
  return found
}

async function removeObjects(admin: SupabaseClient, bucket: string, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 500) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 500))
    if (error) throw new ApiError(502, 'storage_cleanup_failed', 'Some stored files could not be removed. The account was not deleted; try again.')
  }
}

/**
 * POST /api/control/user-sanction?action=warn|ban|unban|delete
 *
 * Every action: the matching permission (users.warn / users.ban / users.delete), a fresh
 * single-use step-up (owner passkey or authenticator code, ≤120 s), never on yourself or the
 * owner, and only on accounts of strictly lower rank. Every outcome is audited without study data.
 * Bans use Supabase Auth's native ban (sign-in and token refresh refused), revoke every session,
 * and record an indexed row that RLS checks so an already-issued access token stops working.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const fromQuery = actionFromRequest(req)
  await controlHandler(req, res, ['POST'], { requireAal2: true, permission: () => fromQuery ? PERMISSION_FOR[fromQuery] : 'users.delete' }, async context => {
    if (!fromQuery) throw new ApiError(400, 'invalid_request', 'Choose an account action.')
    const parsed = bodySchema.safeParse(await readJson(req, 4_000))
    if (!parsed.success) throw new ApiError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Check the account action and try again.')
    const body = parsed.data
    if (body.action !== fromQuery) throw new ApiError(400, 'invalid_request', 'The account action does not match the request.')
    await runSanction(context, body)
    sendJson(res, 200, { ok: true, userId: body.userId, action: body.action })
  })
}

type SanctionBody = z.infer<typeof bodySchema>

async function runSanction(context: ControlContext, body: SanctionBody): Promise<void> {
  const admin = context.admin
  const auditAction = `user.${body.action}`
  const userId = body.userId

  const refuse = async (errorCode: string, status: number, message: string): Promise<never> => {
    await recordBoundedDenial(admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action: auditAction, targetType: 'user', targetId: userId, errorCode })
    throw new ApiError(status, errorCode, message)
  }

  // Rank and owner protection come first, so a refused attempt never consumes a step-up.
  const { data: roleRow, error: roleError } = await admin.from('control_roles').select('role, revoked_at').eq('user_id', userId).maybeSingle()
  if (roleError) throw new ApiError(503, 'control_unavailable', 'Account roles could not be checked. Nothing was changed.')
  const targetRole: ControlRole | null = roleRow && !roleRow.revoked_at && isControlRole(roleRow.role) ? roleRow.role : null
  const refusal = sanctionRefusal({ id: context.userId, role: context.role }, { id: userId, role: targetRole })
  if (refusal === 'self_action_blocked') await refuse(refusal, 409, 'You cannot take this action on the account you are signed in with.')
  if (refusal === 'owner_protected') await refuse(refusal, 409, 'The owner account cannot be warned, banned or deleted.')
  if (refusal === 'rank_protected') await refuse(refusal, 409, 'You can only take this action on accounts below your own role.')

  const { data: authData, error: authError } = await admin.auth.admin.getUserById(userId)
  if (authError || !authData?.user) throw new ApiError(404, 'user_not_found', 'That account could not be found.')
  const target = authData.user

  if (body.action === 'delete' && (target.email ?? '').toLowerCase() !== body.confirmEmail.toLowerCase()) {
    throw new ApiError(400, 'confirmation_mismatch', 'The confirmation email does not match this account. Nothing was deleted.')
  }

  // Validate temporary ban window before consuming a single-use step-up confirmation.
  const banWindow = body.action === 'ban' ? banDuration(body.permanent, body.until) : null

  const { data: banRow, error: banError } = await admin.from('account_bans').select('banned_until').eq('user_id', userId).maybeSingle()
  if (banError) throw new ApiError(503, 'control_unavailable', 'The account status could not be checked. Nothing was changed.')
  const activeBan = Boolean(banRow && (banRow.banned_until === null || Date.parse(banRow.banned_until) > Date.now()))
  if (body.action === 'unban' && !activeBan) throw new ApiError(409, 'no_change', 'This account is not banned.')

  await requireStepUp(context, { action: auditAction, targetType: 'user', targetId: userId })

  const audit = { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action: auditAction, targetType: 'user', targetId: userId }
  const fail = async (errorCode: string, status: number, message: string): Promise<never> => {
    await recordAuditEvent(admin, { ...audit, outcome: 'failed', severity: 'warning', errorCode })
    throw new ApiError(status, errorCode, message)
  }

  if (body.action === 'warn') {
    const { error } = await admin.from('account_sanctions').insert({ user_id: userId, kind: 'warning', reason: body.reason, created_by: context.userId, created_by_role: context.role })
    if (error) await fail('sanction_write_failed', 503, 'The warning could not be saved. Try again.')
    await recordAuditEvent(admin, { ...audit, outcome: 'success', severity: 'notice', reason: body.reason, summary: { kind: 'warning' } })
    return
  }

  if (body.action === 'ban') {
    const { duration, untilIso } = banWindow!
    const { error: gotrueError } = await admin.auth.admin.updateUserById(userId, { ban_duration: duration })
    if (gotrueError) await fail('auth_update_failed', 502, 'The ban could not be applied by the authentication service. Nothing was changed; try again.')
    const { data: sanction, error: sanctionError } = await admin.from('account_sanctions')
      .insert({ user_id: userId, kind: 'ban', reason: body.reason, banned_until: untilIso, permanent: body.permanent, created_by: context.userId, created_by_role: context.role })
      .select('id').single()
    const { error: banWriteError } = sanctionError ? { error: sanctionError } : await admin.from('account_bans').upsert({
      user_id: userId, banned_until: untilIso, reason: body.reason, sanction_id: sanction?.id ?? null, created_by: context.userId, created_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
    if (banWriteError) {
      // Keep Auth and the database consistent: undo the Auth ban if the record could not be written.
      await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' }).catch(() => undefined)
      await fail('sanction_write_failed', 503, 'The ban could not be recorded, so it was not applied. Try again.')
    }
    const { error: revokeError } = await admin.rpc('control_revoke_user_sessions', { target: userId })
    if (revokeError) logAIEvent('error', 'control_session_revoke_failed', { code: revokeError.code ?? '' })
    await recordAuditEvent(admin, {
      ...audit,
      outcome: 'success',
      severity: 'warning',
      reason: body.reason,
      summary: { before: activeBan ? 'banned' : 'active', after: 'banned', permanent: body.permanent, until: untilIso, sessions_revoked: !revokeError }
    })
    return
  }

  if (body.action === 'unban') {
    const { error: gotrueError } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' })
    if (gotrueError) await fail('auth_update_failed', 502, 'The ban could not be lifted by the authentication service. Try again.')
    const { error: deleteError } = await admin.from('account_bans').delete().eq('user_id', userId)
    if (deleteError) await fail('sanction_write_failed', 503, 'The ban record could not be cleared. Try again.')
    const { error: noticeError } = await admin.from('account_sanctions').insert({ user_id: userId, kind: 'unban', reason: body.reason || null, created_by: context.userId, created_by_role: context.role })
    if (noticeError) logAIEvent('warn', 'control_unban_notice_failed', { code: noticeError.code ?? '' })
    await recordAuditEvent(admin, { ...audit, outcome: 'success', severity: 'notice', reason: body.reason, summary: { before: 'banned', after: 'active' } })
    return
  }

  // delete: files first (retryable while the account still exists), then the Auth user, whose
  // removal cascades to every study, AI, role and sanction row through ON DELETE CASCADE.
  const { data: messages, error: messagesError } = await admin.from('contact_messages').select('id').eq('user_id', userId).limit(1_000)
  if (messagesError) await fail('storage_cleanup_failed', 503, 'Contact messages could not be checked. Nothing was deleted.')
  const messageIds = ((messages ?? []) as Array<{ id: string }>).map(row => row.id)
  const studyFiles = await listObjects(admin, 'mistake-images', userId)
  const attachmentFiles: string[] = []
  for (const id of messageIds) attachmentFiles.push(...await listObjects(admin, 'contact-attachments', id))
  await removeObjects(admin, 'mistake-images', studyFiles)
  await removeObjects(admin, 'contact-attachments', attachmentFiles)
  if (messageIds.length) {
    const { error } = await admin.from('contact_messages').delete().in('id', messageIds)
    if (error) await fail('message_cleanup_failed', 503, 'Contact messages could not be removed. The account was not deleted; try again.')
  }
  const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId)
  if (deleteUserError) await fail('auth_delete_failed', 502, 'The authentication service could not delete the account. Its files were removed; try again to finish.')
  await recordAuditEvent(admin, {
    ...audit,
    outcome: 'success',
    severity: 'critical',
    reason: body.reason,
    summary: { files_removed: studyFiles.length + attachmentFiles.length, messages_removed: messageIds.length, had_role: targetRole ?? 'none' }
  })
}
