import type { ApiRequest, ApiResponse } from '../http.js'
import { sendJson } from '../http.js'
import { controlHandler, recordSessionGranted } from '../control.js'
import { CONTROL_IDLE_TIMEOUT_SECONDS, CONTROL_SESSION_MAX_AGE_SECONDS, isRecentMfa } from '../control-policy.js'
import { ownerHasPasskey } from '../control-passkeys.js'

/**
 * GET /api/control/session
 *   401 signed out · 401 session_expired (after 6h) · 403 access_not_granted (any non-owner) · 403 rate limited
 *   200 {status:'mfa_required'}  owner without an aal2 session: the browser may only run MFA steps
 *   200 {status:'granted'}       owner with aal2: the console may load
 * Returns no personal data and no admin data: only the role and assurance state.
 * The first granted answer per Auth session is recorded as a successful console access.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET'], { requireAal2: false, permission: null }, async context => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const granted = context.assurance !== null
    if (granted) await recordSessionGranted(context)
    // Only the owner is ever told whether a passkey can be used for the second step.
    const passkey = context.role === 'owner' ? await ownerHasPasskey(context.admin, context.userId) : false
    sendJson(res, 200, {
      status: granted ? 'granted' : 'mfa_required',
      userId: context.userId,
      role: context.role,
      // Only after aal2: what this role holder may open. Before MFA the browser learns nothing more.
      permissions: granted ? [...context.permissions] : [],
      ownerReadOnly: granted ? context.ownerReadOnly : false,
      ownerRemovalStatus: granted ? context.ownerRemovalStatus : null,
      aal: context.aal,
      method: context.assurance,
      passkey,
      recentMfa: isRecentMfa(context.mfaAt, nowSeconds),
      idleTimeoutSeconds: CONTROL_IDLE_TIMEOUT_SECONDS,
      sessionStartedAt: context.sessionStartedAt,
      sessionExpiresAt: context.sessionStartedAt !== null ? context.sessionStartedAt + CONTROL_SESSION_MAX_AGE_SECONDS : null,
      maxSessionSeconds: CONTROL_SESSION_MAX_AGE_SECONDS
    })
  })
}
