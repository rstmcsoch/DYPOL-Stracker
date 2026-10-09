import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { ApiError, readJson, sendJson } from '../_lib/http.js'
import { controlHandler, recordAuditEvent, requireRecentMfa } from '../_lib/control.js'

/** Effectively permanent ban that Supabase Auth honours on the next token refresh. */
const SUSPEND_DURATION = '876000h'

const bodySchema = z.object({
  userId: z.uuid(),
  action: z.enum(['suspend', 'restore']),
  reason: z.string().trim().min(10, 'Give a reason of at least 10 characters.').max(500),
  /** Must match the target account's email exactly (case-insensitive). Confirms the target. */
  confirmEmail: z.string().trim().min(3).max(320)
}).strict()

/**
 * POST /api/control/user-access  { userId, action: 'suspend' | 'restore', reason, confirmEmail }
 *
 * Soft restriction: sign-in is disabled through Supabase Auth's ban mechanism and can be
 * reversed. Account data is untouched and no account is deleted. Requires aal2 AND a TOTP
 * verification in the last 15 minutes. Owners and the acting owner cannot be suspended here.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['POST'], { requireAal2: true }, async context => {
    requireRecentMfa(context)
    const parsed = bodySchema.safeParse(await readJson(req, 4_000))
    if (!parsed.success) throw new ApiError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Check the account action and try again.')
    const { userId, action, reason, confirmEmail } = parsed.data
    const admin = context.admin

    if (userId === context.userId) throw new ApiError(409, 'self_action_blocked', 'You cannot change the access of the account you are signed in with.')

    const { data: authData, error: authError } = await admin.auth.admin.getUserById(userId)
    if (authError || !authData?.user) throw new ApiError(404, 'user_not_found', 'That account could not be found.')
    const target = authData.user
    if ((target.email ?? '').toLowerCase() !== confirmEmail.toLowerCase()) {
      throw new ApiError(400, 'confirmation_mismatch', 'The confirmation email does not match this account. Nothing was changed.')
    }

    const { data: roleRow, error: roleError } = await admin.from('admin_roles').select('role, revoked_at').eq('user_id', userId).maybeSingle()
    if (roleError) throw new ApiError(503, 'control_unavailable', 'Account roles could not be checked. Nothing was changed.')
    if (roleRow && !roleRow.revoked_at) throw new ApiError(409, 'owner_protected', 'Administrator accounts cannot be suspended from the console.')

    const wasSuspended = Boolean(target.banned_until && Date.parse(target.banned_until) > Date.now())
    if ((action === 'suspend') === wasSuspended) {
      throw new ApiError(409, 'no_change', wasSuspended ? 'This account is already suspended.' : 'This account is already active.')
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: action === 'suspend' ? SUSPEND_DURATION : 'none'
    })
    const auditBase = {
      requestId: context.requestId,
      actorId: context.userId,
      actorRole: context.role,
      action: action === 'suspend' ? 'user.suspend' : 'user.restore',
      targetType: 'user',
      targetId: userId,
      reason,
      summary: { before: wasSuspended ? 'suspended' : 'active', after: action === 'suspend' ? 'suspended' : 'active' }
    }
    if (updateError) {
      await recordAuditEvent(admin, { ...auditBase, outcome: 'failed', severity: 'warning', errorCode: 'auth_update_failed' })
      throw new ApiError(502, 'auth_update_failed', 'The access change could not be applied by the authentication service. Nothing was confirmed; try again.')
    }
    const auditRecorded = await recordAuditEvent(admin, { ...auditBase, outcome: 'success', severity: action === 'suspend' ? 'warning' : 'notice' })

    sendJson(res, 200, {
      ok: true,
      userId,
      status: action === 'suspend' ? 'suspended' : 'active',
      auditRecorded,
      note: action === 'suspend'
        ? 'Sign-in is disabled. A session that is already open stays valid until its access token expires, and it cannot be refreshed.'
        : 'Sign-in is restored for this account.'
    })
  })
}
