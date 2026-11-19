import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError } from '../http.js'
import { controlHandler } from '../control.js'

/**
 * POST /api/control/user-access (RETIRED)
 *
 * Replaced by POST /api/control/user-sanction?action=warn|ban|unban|delete, which enforces
 * single-use step-up, rank hierarchy, account_bans RLS sync, and immediate session revocation.
 * Kept mounted behind the standard control auth boundary solely so legacy clients receive an
 * explicit 410 Gone after authentication rather than bypassing sanctions.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['POST'], { requireAal2: true, permission: 'users.ban' }, async () => {
    throw new ApiError(410, 'route_retired', 'This legacy endpoint has been retired. Use account sanctions instead.')
  })
}
