import type { SupabaseClient } from '@supabase/supabase-js'
import { deleteAllPasskeys } from './control-passkeys.js'
import { logAIEvent } from './diagnostics.js'
import {
  OPEN_REMOVAL_STATUSES,
  isIstDayReached,
  istDaysRemaining,
  type RoleRemovalStatus
} from '../../src/lib/control-role-governance.js'

export interface RoleRemovalRow {
  id: string
  target_user_id: string
  target_role: string
  status: RoleRemovalStatus
  initiated_by: string | null
  initiated_at: string
  approved_by: string[] | null
  countdown_started_at: string | null
  effective_on_ist: string | null
  restore_requested_at: string | null
  restore_on_ist: string | null
  resolved_at: string | null
  updated_at: string
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

/** Finalizes a role removal once its IST countdown day is reached. */
export async function finalizeRoleRemoval(
  admin: SupabaseClient,
  row: RoleRemovalRow,
  requestId: string,
  nowIso: string
): Promise<boolean> {
  const targetId = row.target_user_id
  const { error: revokeError } = await admin
    .from('control_roles')
    .update({ revoked_at: nowIso, updated_at: nowIso })
    .eq('user_id', targetId)
  if (revokeError) {
    logAIEvent('error', 'control_role_removal_finalize_failed', { code: revokeError.code ?? '' })
    return false
  }
  await admin.from('control_member_permissions').delete().eq('user_id', targetId)
  const factors = await deleteAllFactors(admin, targetId)
  const passkeys = await deleteAllPasskeys(admin, targetId)
  const { data: sessions, error: sessionError } = await admin.rpc('control_revoke_user_sessions', { target: targetId })
  await admin
    .from('control_role_removals')
    .update({ status: 'completed', resolved_at: nowIso, updated_at: nowIso })
    .eq('id', row.id)

  try {
    await admin.from('control_audit_events').insert({
      request_id: requestId.slice(0, 80),
      actor_id: row.initiated_by,
      actor_role: 'owner',
      action: 'role.remove',
      target_type: 'user',
      target_id: targetId,
      result: 'success',
      before_summary: { before: row.target_role },
      after_summary: {
        after: 'none',
        factors_removed: factors.removed,
        factors_ok: factors.ok,
        passkeys_removed: passkeys,
        sessions_ended: typeof sessions === 'number' ? sessions : 0,
        sessions_ok: !sessionError,
        removal_id: row.id
      }
    })
  } catch {
    // Audit logging must not block finalization.
  }
  return true
}

/**
 * Reconciles all open removal workflows against the current IST calendar date:
 *   - Any `review_restore` whose 2-day IST target date is reached is automatically restored.
 *   - Any `countdown` whose 7-day or 30-day IST target date is reached is automatically finalized.
 * Returns the remaining open rows.
 */
export async function reconcileRoleRemovals(
  admin: SupabaseClient,
  requestId: string,
  now = new Date()
): Promise<RoleRemovalRow[]> {
  const { data, error } = await admin
    .from('control_role_removals')
    .select('id, target_user_id, target_role, status, initiated_by, initiated_at, approved_by, countdown_started_at, effective_on_ist, restore_requested_at, restore_on_ist, resolved_at, updated_at')
    .in('status', [...OPEN_REMOVAL_STATUSES])
    .order('initiated_at', { ascending: false })
  if (error) return []

  const nowIso = now.toISOString()
  const stillOpen: RoleRemovalRow[] = []
  for (const row of (data ?? []) as RoleRemovalRow[]) {
    if (row.status === 'review_restore' && isIstDayReached(row.restore_on_ist, now)) {
      const { error: restoreError } = await admin
        .from('control_role_removals')
        .update({ status: 'restored', resolved_at: nowIso, updated_at: nowIso })
        .eq('id', row.id)
      if (!restoreError) {
        try {
          await admin.from('control_audit_events').insert({
            request_id: requestId.slice(0, 80),
            actor_id: row.target_user_id,
            actor_role: 'owner',
            action: 'role.removal.restored',
            target_type: 'user',
            target_id: row.target_user_id,
            result: 'success',
            after_summary: { role: 'owner', removal_id: row.id }
          })
        } catch {
          // Ignore audit errors on auto-restore.
        }
        continue
      }
    }
    if (row.status === 'countdown' && isIstDayReached(row.effective_on_ist, now)) {
      const done = await finalizeRoleRemoval(admin, row, requestId, nowIso)
      if (done) continue
    }
    stillOpen.push(row)
  }
  return stillOpen
}

export interface UserRemovalState {
  /** True when the user's countdown just finished and their role has been revoked. */
  finalized: boolean
  /** True when ANY authority is in a removal countdown (30d owner / 7d non-owner) or 2d restore review. */
  ownerReadOnly: boolean
  /** Current open removal status for this user, if any. */
  removalStatus: RoleRemovalStatus | null
  /** Whole IST calendar days remaining in the active countdown or restore review. */
  removalDaysRemaining: number | null
  /** IST YYYY-MM-DD date when the active countdown or restore review finishes. */
  removalTargetDateIst: string | null
}

/**
 * Checks and reconciles any open removal workflow for the signed-in user during authorizeControl.
 * Enforces read-only lockout for ANY authority in countdown/review_restore and auto-revokes or
 * auto-restores the moment the IST target calendar day is reached.
 */
export async function checkUserRemovalState(
  admin: SupabaseClient,
  userId: string,
  _role: string,
  requestId: string,
  now = new Date()
): Promise<UserRemovalState> {
  const { data, error } = await admin
    .from('control_role_removals')
    .select('id, target_user_id, target_role, status, initiated_by, initiated_at, approved_by, countdown_started_at, effective_on_ist, restore_requested_at, restore_on_ist, resolved_at, updated_at')
    .eq('target_user_id', userId)
    .in('status', [...OPEN_REMOVAL_STATUSES])
    .maybeSingle()
  if (error || !data) {
    return { finalized: false, ownerReadOnly: false, removalStatus: null, removalDaysRemaining: null, removalTargetDateIst: null }
  }

  const row = data as RoleRemovalRow
  const nowIso = now.toISOString()

  if (row.status === 'review_restore' && isIstDayReached(row.restore_on_ist, now)) {
    const { error: restoreError } = await admin
      .from('control_role_removals')
      .update({ status: 'restored', resolved_at: nowIso, updated_at: nowIso })
      .eq('id', row.id)
    if (!restoreError) {
      return { finalized: false, ownerReadOnly: false, removalStatus: null, removalDaysRemaining: null, removalTargetDateIst: null }
    }
  }

  if (row.status === 'countdown' && isIstDayReached(row.effective_on_ist, now)) {
    const done = await finalizeRoleRemoval(admin, row, requestId, nowIso)
    if (done) {
      return { finalized: true, ownerReadOnly: false, removalStatus: null, removalDaysRemaining: null, removalTargetDateIst: null }
    }
  }

  const readOnly = row.status === 'countdown' || row.status === 'review_restore'
  const targetDate = row.status === 'review_restore' ? row.restore_on_ist : row.status === 'countdown' ? row.effective_on_ist : null
  const daysRemaining = targetDate ? istDaysRemaining(targetDate, now) : null
  return {
    finalized: false,
    ownerReadOnly: readOnly,
    removalStatus: row.status,
    removalDaysRemaining: daysRemaining,
    removalTargetDateIst: targetDate
  }
}
