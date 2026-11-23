import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../http.js'
import { logAIEvent } from '../diagnostics.js'
import { isControlRole, type ControlRole } from '../../../src/lib/control-permissions.js'
import { banDuration } from '../control-routes/user-sanction.js'
import { getAuthUser } from './auth-users.js'
import { requireStudentId } from './student-directory.js'

const MASTER_ROLE = 'master_mcp'

export type MasterSanctionRefusal = 'owner_protected' | 'account_protected' | 'self_action_blocked'

export function masterSanctionRefusal(
  target: { id: string; role: ControlRole | null },
  actor: { credentialId: string }
): MasterSanctionRefusal | null {
  if (target.id === actor.credentialId) return 'self_action_blocked'
  if (target.role === 'owner') return 'owner_protected'
  if (target.role) return 'account_protected'
  return null
}

export async function loadSanctionTarget(admin: SupabaseClient, studentId: string, credentialId: string) {
  const id = requireStudentId(studentId)
  const { data: roleRow, error: roleError } = await admin.from('control_roles').select('role, revoked_at').eq('user_id', id).maybeSingle()
  if (roleError) throw new ApiError(503, 'control_unavailable', 'Account roles could not be checked. Nothing was changed.')
  const role: ControlRole | null = roleRow && !roleRow.revoked_at && isControlRole(roleRow.role) ? roleRow.role : null
  const refusal = masterSanctionRefusal({ id, role }, { credentialId })
  if (refusal === 'self_action_blocked') throw new ApiError(403, refusal, 'Master MCP cannot take this action on its own credential.')
  if (refusal === 'owner_protected') throw new ApiError(403, refusal, 'The owner account cannot be warned, banned or unsanctioned.')
  if (refusal === 'account_protected') throw new ApiError(403, refusal, 'Master MCP cannot warn or ban a Control Centre role holder.')
  const user = await getAuthUser(admin, id)
  const { data: banRow, error: banError } = await admin.from('account_bans').select('banned_until, reason').eq('user_id', id).maybeSingle()
  if (banError) throw new ApiError(503, 'control_unavailable', 'The account status could not be checked. Nothing was changed.')
  const activeBan = Boolean(banRow && (banRow.banned_until === null || Date.parse(banRow.banned_until) > Date.now()))
  return { id, user, role, banRow, activeBan }
}

async function writeFailed(_admin: SupabaseClient, errorCode: string, status: number, message: string): Promise<never> {
  throw new ApiError(status, errorCode, message)
}

export async function warnStudent(admin: SupabaseClient, input: { studentId: string; reason: string; credentialId: string }) {
  const target = await loadSanctionTarget(admin, input.studentId, input.credentialId)
  const { error } = await admin.from('account_sanctions').insert({
    user_id: target.id,
    kind: 'warning',
    reason: input.reason,
    created_by: null,
    created_by_role: MASTER_ROLE
  })
  if (error) await writeFailed(admin, 'sanction_write_failed', 503, 'The warning could not be saved. Try again.')
  return { ok: true, studentId: target.id, action: 'warn' as const, email: target.user.email ?? '' }
}

export async function banStudent(admin: SupabaseClient, input: {
  studentId: string
  reason: string
  permanent: boolean
  until?: string
  credentialId: string
  nowMs?: number
}) {
  const target = await loadSanctionTarget(admin, input.studentId, input.credentialId)
  const { duration, untilIso } = banDuration(input.permanent, input.until, input.nowMs)
  const { error: gotrueError } = await admin.auth.admin.updateUserById(target.id, { ban_duration: duration })
  if (gotrueError) await writeFailed(admin, 'auth_update_failed', 502, 'The ban could not be applied by the authentication service. Nothing was changed; try again.')
  const { data: sanction, error: sanctionError } = await admin.from('account_sanctions')
    .insert({
      user_id: target.id,
      kind: 'ban',
      reason: input.reason,
      banned_until: untilIso,
      permanent: input.permanent,
      created_by: null,
      created_by_role: MASTER_ROLE
    })
    .select('id')
    .single()
  const { error: banWriteError } = sanctionError
    ? { error: sanctionError }
    : await admin.from('account_bans').upsert({
      user_id: target.id,
      banned_until: untilIso,
      reason: input.reason,
      sanction_id: sanction?.id ?? null,
      created_by: null,
      created_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
  if (banWriteError) {
    await admin.auth.admin.updateUserById(target.id, { ban_duration: 'none' }).catch(() => undefined)
    await writeFailed(admin, 'sanction_write_failed', 503, 'The ban could not be recorded, so it was not applied. Try again.')
  }
  const { error: revokeError } = await admin.rpc('control_revoke_user_sessions', { target: target.id })
  if (revokeError) logAIEvent('error', 'master_mcp_session_revoke_failed', { code: revokeError.code ?? '' })
  return {
    ok: true,
    studentId: target.id,
    action: 'ban' as const,
    permanent: input.permanent,
    until: untilIso,
    sessionsRevoked: !revokeError
  }
}

export async function unbanStudent(admin: SupabaseClient, input: { studentId: string; reason?: string; credentialId: string }) {
  const target = await loadSanctionTarget(admin, input.studentId, input.credentialId)
  if (!target.activeBan) throw new ApiError(409, 'no_change', 'This account is not banned.')
  const { error: gotrueError } = await admin.auth.admin.updateUserById(target.id, { ban_duration: 'none' })
  if (gotrueError) await writeFailed(admin, 'auth_update_failed', 502, 'The ban could not be lifted by the authentication service. Try again.')
  const { error: deleteError } = await admin.from('account_bans').delete().eq('user_id', target.id)
  if (deleteError) await writeFailed(admin, 'sanction_write_failed', 503, 'The ban record could not be cleared. Try again.')
  const { error: noticeError } = await admin.from('account_sanctions').insert({
    user_id: target.id,
    kind: 'unban',
    reason: input.reason || null,
    created_by: null,
    created_by_role: MASTER_ROLE
  })
  if (noticeError) logAIEvent('warn', 'master_mcp_unban_notice_failed', { code: noticeError.code ?? '' })
  return { ok: true, studentId: target.id, action: 'unban' as const }
}

/** Intentionally unimplemented. User-account deletion is permanently prohibited for Master MCP. */
export function assertDeletionUnreachable(): void {
  throw new ApiError(403, 'forbidden_tool', 'Master MCP cannot delete a user account.')
}
