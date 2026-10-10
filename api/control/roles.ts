import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { sendJson } from '../_lib/http.js'
import { controlHandler } from '../_lib/control.js'

/**
 * GET /api/control/roles
 * Current role assignments. Read-only: role changes are made through the owner provisioning
 * procedure and are recorded in the audit log. No browser endpoint can grant a role.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET'], { requireAal2: true }, async context => {
    const { data, error } = await context.admin.from('control_roles').select('user_id, role, granted_at, revoked_at').order('granted_at', { ascending: true })
    if (error) throw new Error('roles_query_failed')
    const assignments = await Promise.all((data ?? []).map(async row => {
      const { data: auth } = await context.admin.auth.admin.getUserById(row.user_id as string)
      return {
        userId: row.user_id,
        email: auth?.user?.email ?? '',
        role: row.role,
        grantedAt: row.granted_at,
        revokedAt: row.revoked_at,
        active: !row.revoked_at
      }
    }))
    sendJson(res, 200, { assignments })
  })
}
