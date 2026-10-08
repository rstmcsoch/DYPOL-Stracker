import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError, readJson, publicError, sendJson } from '../_lib/http.js'
import { authenticateRequest } from '../_lib/supabase.js'
import { redactPotentialSecrets } from '../_lib/secrets.js'
import { runAssistant } from '../_lib/agent.js'

const requestSchema = z.object({
  conversationId: z.uuid().nullable().optional(),
  requestId: z.uuid(),
  messageId: z.uuid(),
  message: z.string().trim().min(1).max(4000),
  pageContext: z.string().max(80).nullable().optional()
}).strict()
const SAFE_PAGES: Record<string,string> = {
  '/':'Dashboard','/syllabus':'Chapters','/tests':'Tests','/mistakes':'Mistakes','/retry':'Retry notebook',
  '/planner':'Tasks and weekly goals','/revision':'Revision','/analytics':'Analytics','/weak-areas':'Weak areas',
  '/settings':'Settings','/backup':'Backup','/focus':'Focus'
}

function event(res: ApiResponse, name: string, data: Record<string,unknown>): void {
  if (res.writableEnded || res.destroyed) return
  res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function existingTask(admin: SupabaseClient, userId: string, requestId: string): Promise<Record<string,unknown> | null> {
  const { data, error } = await admin.from('ai_tasks').select('*').eq('user_id',userId).eq('request_id',requestId).maybeSingle()
  if (error) throw new ApiError(503,'task_unavailable','That AI task could not be checked. Try again.')
  return data as Record<string,unknown> | null
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405; res.setHeader('Allow','POST'); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ error:'method_not_allowed',message:'That AI request method is not supported.' })); return
  }
  let context
  let parsed
  try {
    context = await authenticateRequest(req)
    parsed = requestSchema.safeParse(await readJson(req,12_000))
    if (!parsed.success) throw new ApiError(400,'invalid_chat_request','Enter a message of up to 4,000 characters to continue.')
  } catch (error) {
    const result = publicError(error)
    sendJson(res,result.status,result.body)
    return
  }
  const { userId, userClient, adminClient } = context
  const body = parsed.data
  const safeMessage = redactPotentialSecrets(body.message).trim()
  if (!safeMessage) { sendJson(res,400,{ error:'empty_message',message:'Enter a message to continue.' }); return }
  const pageContext = body.pageContext ? SAFE_PAGES[body.pageContext] ?? null : null

  try {
    const replay = await existingTask(adminClient,userId,body.requestId)
    if (replay) {
      if (replay.status === 'completed') {
        const metadata = replay.metadata as Record<string,unknown> | null
        res.statusCode = 200
        res.setHeader('Content-Type','text/event-stream; charset=utf-8')
        res.setHeader('Cache-Control','no-cache, no-transform')
        res.setHeader('X-Content-Type-Options','nosniff')
        event(res,'task',{ id:replay.id,conversationId:replay.conversation_id,status:'completed' })
        event(res,'done',{ content:metadata?.response ?? '',providerId:replay.provider_id,modelId:replay.model_id,taskId:replay.id,fallbackFrom:metadata?.fallback_from ?? null })
        res.end()
        return
      }
      if (replay.status === 'waiting') {
        const { data: pending } = await adminClient.from('ai_pending_actions').select('id,task_id,tool_name,summary,expires_at').eq('user_id',userId).eq('task_id',replay.id).eq('status','pending').maybeSingle()
        res.statusCode = 200
        res.setHeader('Content-Type','text/event-stream; charset=utf-8')
        res.setHeader('Cache-Control','no-cache, no-transform')
        res.setHeader('X-Content-Type-Options','nosniff')
        event(res,'task',{ id:replay.id,conversationId:replay.conversation_id,status:'waiting' })
        if (pending) {
          const summary = pending.summary as { title?: string; fields?: Array<{label:string;value:string}> }
          event(res,'confirmation',{ providerId:replay.provider_id,modelId:replay.model_id,action:{ actionId:pending.id,taskId:pending.task_id,toolName:pending.tool_name,title:summary.title,fields:summary.fields ?? [],expiresAt:pending.expires_at } })
        }
        res.end()
        return
      }
      sendJson(res,409,{ error:'task_already_processed',message:'This AI request has already been handled. Retry it from the conversation if needed.' })
      return
    }

    const minuteAgo = new Date(Date.now() - 60_000).toISOString()
    const { count, error: rateError } = await adminClient.from('ai_tasks').select('id',{ count:'exact',head:true }).eq('user_id',userId).gte('started_at',minuteAgo)
    if (rateError) throw new ApiError(503,'task_unavailable','Stracker could not start an AI task. Try again.')
    if ((count ?? 0) >= 10) throw new ApiError(429,'request_limit','You have sent several AI requests recently. Wait a minute and try again.')
    const activeSince = new Date(Date.now() - 90_000).toISOString()
    const { data: active } = await adminClient.from('ai_tasks').select('id').eq('user_id',userId).in('status',['running','tool_call','fallback','retrying']).gte('started_at',activeSince).limit(1)
    if (active?.length) throw new ApiError(409,'assistant_busy','A Stracker AI task is already running. Stop it or wait for it to finish.')

    const { data: existingUserMessage, error: messageLookupError } = await adminClient.from('ai_messages').select('id,conversation_id,content,role').eq('user_id',userId).eq('idempotency_key',body.messageId).maybeSingle()
    if (messageLookupError) throw new ApiError(503,'message_unavailable','The message could not be saved. Try again.')
    if (existingUserMessage && body.conversationId && existingUserMessage.conversation_id !== body.conversationId) throw new ApiError(409,'message_conflict','This message ID is already used by another conversation.')
    let conversationId = body.conversationId ?? existingUserMessage?.conversation_id ?? null
    let conversationTitle = 'New conversation'
    if (conversationId) {
      const { data: conversation, error } = await adminClient.from('ai_conversations').select('id,user_id,title').eq('user_id',userId).eq('id',conversationId).maybeSingle()
      if (error) throw new ApiError(503,'conversation_unavailable','This conversation could not be opened. Try again.')
      if (!conversation) throw new ApiError(404,'conversation_not_found','This conversation is not available in your account.')
      conversationTitle = String(conversation.title)
    } else {
      const { data, error } = await adminClient.from('ai_conversations').insert({ user_id:userId,title:'New conversation' }).select('id').single()
      if (error || !data) throw new ApiError(503,'conversation_unavailable','A new conversation could not be created. Try again.')
      conversationId = data.id as string
    }

    let currentMessage = safeMessage
    let currentMessageId: string
    if (existingUserMessage) {
      if (existingUserMessage.role !== 'user') throw new ApiError(409,'message_conflict','This message ID is already used by another conversation.')
      currentMessage = String(existingUserMessage.content)
      currentMessageId = String(existingUserMessage.id)
    } else {
      const { data: insertedMessage, error } = await adminClient.from('ai_messages').insert({ user_id:userId,conversation_id:conversationId,role:'user',content:safeMessage,status:'completed',idempotency_key:body.messageId }).select('id').single()
      if (error || !insertedMessage) throw new ApiError(503,'message_unavailable','The message could not be saved. Try again.')
      currentMessageId = String(insertedMessage.id)
    }
    if (conversationTitle === 'New conversation') {
      await adminClient.from('ai_conversations').update({ title:currentMessage.replace(/\s+/g,' ').slice(0,72) || 'New conversation',updated_at:new Date().toISOString() }).eq('user_id',userId).eq('id',conversationId)
    }
    const { data: priorRows, error: historyError } = await adminClient.from('ai_messages').select('id,role,content').eq('user_id',userId).eq('conversation_id',conversationId).order('created_at',{ascending:true}).limit(24)
    if (historyError) throw new ApiError(503,'conversation_unavailable','Conversation context could not be loaded. Try again.')
    const prior = (priorRows ?? []).filter((row:Record<string,unknown>) => row.id !== currentMessageId && (row.role === 'user' || row.role === 'assistant')).slice(-20) as Array<{role:'user'|'assistant';content:string}>
    const { data: task, error: taskError } = await adminClient.from('ai_tasks').insert({
      user_id:userId,conversation_id:conversationId,request_id:body.requestId,task_type:/\b(add|create|delete|remove|update|record|mark|complete|change|set)\b/i.test(currentMessage) ? 'action' : /\b(analy[sz]|compare|weak|average|performance|test|revision|mistake|task|study)\b/i.test(currentMessage) ? 'analytics' : 'general',status:'running',progress:'Thinking…'
    }).select('id').single()
    if (taskError || !task) throw new ApiError(503,'task_unavailable','Stracker could not start this AI task. Retry the message.')

    res.statusCode = 200
    res.setHeader('Content-Type','text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control','no-cache, no-transform')
    res.setHeader('Connection','keep-alive')
    res.setHeader('X-Content-Type-Options','nosniff')
    res.setHeader('X-Accel-Buffering','no')
    res.flushHeaders?.()
    event(res,'task',{ id:task.id,conversationId,status:'running' })
    const controller = new AbortController()
    let clientDisconnected = false
    const onClose = () => {
      if (!res.writableEnded) { clientDisconnected = true; controller.abort(new DOMException('Client disconnected','AbortError')) }
    }
    const onAborted = () => { clientDisconnected = true; controller.abort(new DOMException('Request aborted','AbortError')) }
    res.on('close',onClose)
    req.on('aborted',onAborted)
    const heartbeat = setInterval(() => { if (!res.writableEnded && !res.destroyed) res.write(':keepalive\n\n') },15_000)
    try {
      const result = await runAssistant({
        userId,conversationId,taskId:task.id as string,message:currentMessage,pageContext,priorMessages:prior,
        userClient,adminClient,signal:controller.signal,
        emit:(name,data) => event(res,name,data)
      })
      if (result.status === 'cancelled') {
        await adminClient.from('ai_tasks').update({ status:'cancelled',progress:'Cancelled by you.',completed_at:new Date().toISOString() }).eq('user_id',userId).eq('id',task.id)
        if (!clientDisconnected) event(res,'cancelled',{ taskId:task.id })
      }
      if (!res.writableEnded && !res.destroyed) res.end()
    } catch (error) {
      const publicResult = publicError(error)
      await adminClient.from('ai_tasks').update({ status:controller.signal.aborted ? 'cancelled' : 'failed',progress:controller.signal.aborted ? 'Cancelled by you.' : 'Request failed.',completed_at:new Date().toISOString() }).eq('user_id',userId).eq('id',task.id)
      if (!clientDisconnected && !controller.signal.aborted) event(res,'error',{ error:publicResult.body.error,message:publicResult.body.message,taskId:task.id })
      if (!res.writableEnded && !res.destroyed) res.end()
    } finally {
      clearInterval(heartbeat)
      res.removeListener('close',onClose)
      req.removeListener('aborted',onAborted)
    }
  } catch (error) {
    const result = publicError(error)
    sendJson(res,result.status,result.body)
  }
}
