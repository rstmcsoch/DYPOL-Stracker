import type { ApiRequest, ApiResponse } from './_lib/http.js'
import { handleMasterMcp } from './_lib/mcp/handler.js'

/**
 * Dedicated remote Master MCP endpoint (Streamable HTTP, JSON-RPC).
 * Authenticated only with an Owner-issued Master bearer token. Student JWTs and
 * Control Center sessions are not accepted here.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await handleMasterMcp(req, res)
}
