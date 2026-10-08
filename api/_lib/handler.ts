import type { ApiRequest, ApiResponse } from './http'
import { methodNotAllowed, publicError, sendJson } from './http'
import { authenticateRequest, type AuthenticatedRequestContext } from './supabase'

export async function withAuthenticatedRequest(
  req: ApiRequest,
  res: ApiResponse,
  methods: string[],
  handler: (context: AuthenticatedRequestContext) => Promise<void>
): Promise<void> {
  if (!methods.includes(req.method ?? '')) {
    methodNotAllowed(res, methods)
    return
  }
  try {
    const context = await authenticateRequest(req)
    await handler(context)
  } catch (error) {
    const result = publicError(error)
    sendJson(res, result.status, result.body)
  }
}
