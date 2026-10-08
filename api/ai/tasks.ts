import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { ApiError, readJson, sendJson } from '../_lib/http.js'
import { withAuthenticatedRequest } from '../_lib/handler.js'
import { z } from 'zod'

const stopSchema = z.object({ requestId: z.string().min(8).max(120) }).strict()
const ACTIVE_STATUSES = ['queued', 'running', 'tool_call', 'waiting', 'fallback', 'retrying']

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await withAuthenticatedRequest(req, res, ['GET', 'POST'], async ({ userId, adminClient }) => {
    if (req.method === 'POST') {
      // Explicit user Stop. Records cancellation; the agent observes it at its next checkpoint.
      const parsed = stopSchema.safeParse(await readJson(req))
      if (!parsed.success) throw new ApiError(400, 'invalid_stop_request', 'That AI task could not be stopped.')
      const { data, error } = await adminClient.from('ai_tasks').update({ status: 'cancelled', progress: 'Cancelled by you.', completed_at: new Date().toISOString() })
        .eq('user_id', userId).eq('request_id', parsed.data.requestId).in('status', ACTIVE_STATUSES).select('id')
      if (error) throw new ApiError(503, 'stop_failed', 'Stracker could not stop that AI task. Try again.')
      sendJson(res, 200, { stopped: (data ?? []).length > 0 })
      return
    }
    const { data, error } = await adminClient.from('ai_tasks')
      .select('id,conversation_id,provider_id,model_id,task_type,status,progress,started_at,completed_at')
      .eq('user_id', userId).order('started_at', { ascending: false }).limit(10)
    if (error) throw new ApiError(503, 'tasks_unavailable', 'Recent AI task status could not be loaded. Try again.')
    sendJson(res, 200, { tasks: data ?? [] })
  })
}
