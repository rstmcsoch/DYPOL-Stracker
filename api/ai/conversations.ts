import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { ApiError, parseQueryValue, readJson, sendJson } from '../_lib/http.js'
import { withAuthenticatedRequest } from '../_lib/handler.js'

function queryParam(req: ApiRequest, name: string): string | undefined {
  const fromQuery = parseQueryValue(req.query?.[name])
  if (fromQuery) return fromQuery
  try { return new URL(req.url ?? '/', 'https://stracker.invalid').searchParams.get(name) ?? undefined }
  catch { return undefined }
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await withAuthenticatedRequest(req, res, ['GET','DELETE'], async ({ userId, adminClient }) => {
    if (req.method === 'GET') {
      const id = queryParam(req, 'id')
      if (id) {
        if (!z.uuid().safeParse(id).success) throw new ApiError(400, 'invalid_conversation', 'That conversation could not be opened.')
        const { data: conversation, error: conversationError } = await adminClient.from('ai_conversations').select('id,user_id,title,created_at,updated_at').eq('user_id', userId).eq('id', id).maybeSingle()
        if (conversationError) throw new ApiError(503, 'conversation_unavailable', 'Conversation history could not be loaded. Try again.')
        if (!conversation) throw new ApiError(404, 'conversation_not_found', 'That conversation is not available in your account.')
        const [{ data: messages,error:messagesError },{ data: pendingActions,error:pendingError }] = await Promise.all([
          adminClient.from('ai_messages').select('id,role,content,provider_id,model_id,status,metadata,created_at').eq('user_id',userId).eq('conversation_id',id).order('created_at',{ascending:true}).limit(100),
          adminClient.from('ai_pending_actions').select('id,task_id,tool_name,summary,expires_at,created_at').eq('user_id',userId).eq('conversation_id',id).eq('status','pending').order('created_at',{ascending:true}).limit(20)
        ])
        if (messagesError || pendingError) throw new ApiError(503,'conversation_unavailable','Conversation messages could not be loaded. Try again.')
        const taskIds = [...new Set((pendingActions ?? []).map(action => action.task_id as string))]
        let taskRows:Array<Record<string,unknown>> = []
        if (taskIds.length) {
          const { data:tasks,error:tasksError } = await adminClient.from('ai_tasks').select('id,provider_id,model_id').eq('user_id',userId).in('id',taskIds)
          if (tasksError) throw new ApiError(503,'conversation_unavailable','Pending Stracker changes could not be loaded. Try again.')
          taskRows = (tasks ?? []) as Array<Record<string,unknown>>
        }
        const tasksById = new Map(taskRows.map(task => [String(task.id),task]))
        const resumableActions = (pendingActions ?? []).map(action => ({
          id:action.id,task_id:action.task_id,tool_name:action.tool_name,summary:action.summary,expires_at:action.expires_at,created_at:action.created_at,
          provider_id:tasksById.get(String(action.task_id))?.provider_id ?? null,
          model_id:tasksById.get(String(action.task_id))?.model_id ?? null
        }))
        sendJson(res,200,{ conversation,messages:messages ?? [],pendingActions:resumableActions })
        return
      }
      const { data, error } = await adminClient.from('ai_conversations').select('id,title,created_at,updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(20)
      if (error) throw new ApiError(503, 'conversation_unavailable', 'Your recent conversations could not be loaded. Try again.')
      sendJson(res, 200, { conversations: data ?? [] })
      return
    }
    const parsed = z.object({ id: z.uuid() }).strict().safeParse(await readJson(req))
    if (!parsed.success) throw new ApiError(400, 'invalid_conversation', 'Choose a conversation to clear.')
    const { error } = await adminClient.from('ai_conversations').delete().eq('user_id', userId).eq('id', parsed.data.id)
    if (error) throw new ApiError(503, 'conversation_delete_failed', 'This conversation could not be cleared. Try again.')
    sendJson(res, 200, { cleared: true })
  })
}
