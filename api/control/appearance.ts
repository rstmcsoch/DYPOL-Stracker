import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { sendJson } from '../_lib/http.js'
import { draftHandler, discardHandler, publishHandler, restoreHandler, stateHandler } from '../_lib/control-routes/appearance.js'

type Handler = (req: ApiRequest, res: ApiResponse) => Promise<void>
const handlers: Record<string, Handler> = {
  state: stateHandler,
  draft: draftHandler,
  discard: discardHandler,
  publish: publishHandler,
  restore: restoreHandler,
}

/** Dispatch owner appearance endpoints through one Vercel serverless function. */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const route = new URL(req.url ?? '/', 'http://localhost').searchParams.get('route') ?? ''
  const selected = handlers[route]
  if (!selected) {
    sendJson(res, 404, { error: 'not_found', message: 'Control route not found.' })
    return
  }
  await selected(req, res)
}
