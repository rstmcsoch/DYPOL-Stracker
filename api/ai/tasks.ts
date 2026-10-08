import type { ApiRequest, ApiResponse } from '../_lib/http'
import { ApiError, sendJson } from '../_lib/http'
import { withAuthenticatedRequest } from '../_lib/handler'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await withAuthenticatedRequest(req, res, ['GET'], async ({ userId, adminClient }) => {
    const { data, error } = await adminClient.from('ai_tasks')
      .select('id,conversation_id,provider_id,model_id,task_type,status,progress,started_at,completed_at')
      .eq('user_id', userId).order('started_at', { ascending: false }).limit(10)
    if (error) throw new ApiError(503, 'tasks_unavailable', 'Recent AI task status could not be loaded. Try again.')
    sendJson(res, 200, { tasks: data ?? [] })
  })
}
