import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../_lib/http'
import { ApiError, readJson, sendJson } from '../_lib/http'
import { withAuthenticatedRequest } from '../_lib/handler'
import { confirmPendingAction } from '../_lib/tools'

const requestSchema = z.object({ actionId:z.uuid(), approved:z.boolean() }).strict()

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await withAuthenticatedRequest(req,res,['POST'],async ({ userId,userClient,adminClient }) => {
    const parsed = requestSchema.safeParse(await readJson(req))
    if (!parsed.success) throw new ApiError(400,'invalid_confirmation','Choose whether to confirm or cancel the proposed Stracker change.')
    const { data: pending, error } = await adminClient.from('ai_pending_actions').select('task_id').eq('user_id',userId).eq('id',parsed.data.actionId).maybeSingle()
    if (error) throw new ApiError(503,'action_confirmation_unavailable','The proposed change could not be checked. Try again.')
    if (!pending) throw new ApiError(404,'action_not_found','This proposed change is no longer available.')
    const { data: task, error: taskError } = await adminClient.from('ai_tasks').select('provider_id,model_id').eq('user_id',userId).eq('id',pending.task_id).maybeSingle()
    if (taskError || !task) throw new ApiError(503,'task_unavailable','The AI task for this change could not be loaded. Try again.')
    const result = await confirmPendingAction(adminClient,userClient,userId,parsed.data.actionId,parsed.data.approved,{ providerId:task.provider_id,modelId:task.model_id })
    sendJson(res,200,{ ...result,approved:parsed.data.approved })
  })
}
