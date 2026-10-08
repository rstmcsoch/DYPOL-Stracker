import type { SupabaseClient } from '@supabase/supabase-js'
import { inferCapabilities, runtimeHealth, type ProviderConfigRow, type AIProviderId } from './registry.js'
import { decryptCredential, redactPotentialSecrets } from './secrets.js'
import { completeWithProvider, providerCallFromConfig, safeProviderError, ProviderFailure, type AgentMessage } from './provider-adapters.js'
import { ApiError } from './http.js'
import { MODEL_TOOLS, prepareToolCall, toolProgress, type ActionPreview } from './tools.js'

export interface AgentEventSink {
  (event: string, data: Record<string, unknown>): void
}
export interface AgentRunInput {
  userId: string
  conversationId: string
  taskId: string
  message: string
  pageContext: string | null
  priorMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  userClient: SupabaseClient
  adminClient: SupabaseClient
  signal: AbortSignal
  emit: AgentEventSink
}
export interface AgentRunResult {
  status: 'completed' | 'waiting' | 'cancelled'
  content: string
  providerId: string | null
  modelId: string | null
  fallbackFrom: string | null
  action?: ActionPreview
}

const TOOL_ITERATION_LIMIT = 4
const TOOL_CALL_LIMIT = 8
const FALLBACK_LIMIT = 2
const MODEL_TIMEOUT_MS = 20_000
const TOTAL_BUDGET_MS = 53_000
const MAX_CONTEXT_CHARS = 26_000

const SYSTEM_PROMPT = `You are Stracker AI, an assistant for a JEE preparation notebook. Be warm, concise, and practical. Help with Physics, Chemistry, Maths, JEE Main and JEE Advanced study.

SECURITY AND ACCURACY RULES:
- You are an assistant using only the explicitly supplied Stracker tools. You do not have SQL, shell, arbitrary database, or cross-account access.
- Derive ownership only from tool results; never request or invent a user ID. Use tools for personal Stracker questions and never fabricate scores, averages, dates, tasks, chapters, or completed actions.
- Stracker's saved data and canonical analytics are authoritative. Clearly distinguish measured values from your interpretation. If no data is present, say so.
- Before a personal-data answer, retrieve only the needed structured information. Do not request broad dumps. Use returned percentages/calculations rather than recalculating incompatible averages.
- For missing important action fields, ask a concise follow-up instead of guessing. You may infer an ordinary date such as “today” from the current local date below; do not invent marks, totals, chapters, or subjects.
- Every write tool only prepares an action. Stracker will ask the user to confirm it; do not claim a change succeeded before Stracker reports that confirmed write result.
- Destructive and normal write actions require the user's explicit confirmation. Never attempt a workaround, repeat a mutation with new values, or imply it is complete while confirmation is pending.
- No user API keys are available in this conversation. Never ask the user to paste a provider key in chat; API credentials belong only in Settings → AI Assistant.
- Do not expose tool JSON. Explain results naturally and state uncertainty where relevant.

The current Stracker date is ${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())} (Asia/Kolkata).${' '}`

const STRACKER_INTENT = /\b(my|mine|stracker|test|tests|score|marks|average|performance|weak|strong|chapter|revision|revis(e|ion)|mistake|task|goal|study time|study hours|dashboard|analytics|exam date|add|create|delete|remove|update|record|mark|complete|change|set|plan|compare|trend|today's tasks)\b/i
const COMPLEX_INTENT = /\b(analy[sz]|compare|trend|why|plan|recommend|strategy|historical|performance|weakest|repeated|drop(ping)?|month|week)\b/i

function providerName(config: ProviderConfigRow): string {
  return config.display_name || config.provider_id
}

function taskType(message: string): 'action' | 'analytics' | 'general' {
  if (/\b(add|create|delete|remove|update|record|mark|complete|change|set)\b/i.test(message)) return 'action'
  if (COMPLEX_INTENT.test(message) || STRACKER_INTENT.test(message)) return 'analytics'
  return 'general'
}

function requiresTools(message: string): boolean {
  return STRACKER_INTENT.test(message) || /\b(my|mine|me)\b/i.test(message)
}

function candidateScore(row: ProviderConfigRow, requiresReasoning: boolean): number {
  const caps = inferCapabilities(row.provider_id,row.model_id,row.protocol,row.capabilities)
  return (row.is_default ? 100 : 0) + (requiresReasoning && caps.supportsReasoning ? 10 : 0) + (caps.supportsTools ? 2 : 0)
}

async function getCandidates(admin: SupabaseClient, userId: string): Promise<ProviderConfigRow[]> {
  const { data, error } = await admin.from('ai_provider_configs').select('*').eq('user_id',userId).eq('enabled',true).order('is_default',{ascending:false}).order('updated_at',{ascending:false})
  if (error) throw new ApiError(503,'provider_config_unavailable','AI provider settings could not be loaded. Try again.')
  return (data ?? []) as ProviderConfigRow[]
}

function statusFromHealth(health: string): { status: string; cooldownSeconds: number; disable: boolean } {
  if (health === 'authentication_failed') return { status:'authentication_failed', cooldownSeconds:0, disable:true }
  if (health === 'model_unavailable') return { status:'model_unavailable', cooldownSeconds:0, disable:true }
  if (health === 'rate_limited') return { status:'rate_limited', cooldownSeconds:90, disable:false }
  if (health === 'unsupported') return { status:'unsupported', cooldownSeconds:0, disable:true }
  if (health === 'timeout' || health === 'provider_unavailable' || health === 'malformed_response') return { status:'provider_unavailable', cooldownSeconds:30, disable:false }
  return { status:'provider_unavailable', cooldownSeconds:20, disable:false }
}

async function updateProviderHealth(admin: SupabaseClient, userId: string, row: ProviderConfigRow, health: string): Promise<void> {
  const state = statusFromHealth(health)
  const patch: Record<string, unknown> = {
    connection_status:state.status,
    cooldown_until:state.cooldownSeconds ? new Date(Date.now() + state.cooldownSeconds * 1000).toISOString() : null,
    failure_count:Math.min(1000,row.failure_count + 1),
    last_checked_at:new Date().toISOString(),
    enabled:state.disable ? false : row.enabled,
    is_default:state.disable ? false : row.is_default
  }
  await admin.from('ai_provider_configs').update(patch).eq('user_id',userId).eq('id',row.id)
}

async function refreshProviderHealth(admin: SupabaseClient, userId: string, row: ProviderConfigRow): Promise<void> {
  await admin.from('ai_provider_configs').update({ connection_status:'connected', cooldown_until:null, failure_count:0 }).eq('user_id',userId).eq('id',row.id)
}

function jsonToolContent(value: unknown): string {
  let content: string
  try { content = JSON.stringify(value) } catch { content = '{"error":"Tool result could not be formatted."}' }
  content = redactPotentialSecrets(content)
  if (content.length > 12_000) return `${content.slice(0, 11_950)}[truncated]}`
  return content
}

function humanTaskState(row: ProviderConfigRow, fallbackFrom: ProviderConfigRow | null): Record<string, unknown> {
  return {
    providerId:row.provider_id,
    providerName:providerName(row),
    modelId:row.model_id,
    fallbackFrom: fallbackFrom ? { providerId:fallbackFrom.provider_id, providerName:providerName(fallbackFrom), modelId:fallbackFrom.model_id } : null
  }
}

function deriveCapabilities(row: ProviderConfigRow) {
  return inferCapabilities(row.provider_id,row.model_id,row.protocol,row.capabilities)
}

function selectedSystem(pageContext: string | null, taskKind: string, canUseTools: boolean): string {
  const context = pageContext ? `\nCurrent Stracker section: ${pageContext}. This is only a navigation hint; read relevant information through the listed tools.` : ''
  const task = `\nCurrent task category: ${taskKind}.`
  const tools = canUseTools
    ? '\nUse the provided read tools when answering about saved Stracker data. When a user asks for an app change, call the correct write tool only after collecting required details; wait for the app confirmation.'
    : '\nNo Stracker data tools are enabled for this model. Do not claim to know the user’s saved data or perform an app action. For a personal Stracker question, explain that a tool-capable tested provider must be enabled in AI Assistant settings.'
  return `${SYSTEM_PROMPT}${context}${task}${tools}`
}

async function withProviderTimeout<T>(parent: AbortSignal, run: (signal: AbortSignal) => Promise<T>,timeoutMs=MODEL_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort(parent.reason)
  if (parent.aborted) abort()
  else parent.addEventListener('abort',abort,{once:true})
  const timer = setTimeout(() => { timedOut = true; controller.abort(new DOMException('AI provider request timed out','TimeoutError')) }, timeoutMs)
  try {
    return await run(controller.signal)
  } catch (error) {
    if (timedOut && !parent.aborted) throw new ProviderFailure('timeout','The provider took too long to respond.')
    throw error
  } finally {
    clearTimeout(timer)
    parent.removeEventListener('abort',abort)
  }
}

export async function runAssistant(input: AgentRunInput): Promise<AgentRunResult> {
  const start = Date.now()
  const intentTools = requiresTools(input.message)
  const requiresReasoning = COMPLEX_INTENT.test(input.message)
  const allCandidates = await getCandidates(input.adminClient,input.userId)
  const usable = allCandidates.filter(row => runtimeHealth(row) === 'ready')
  const capabilityCandidates = usable.filter(row => !intentTools || deriveCapabilities(row).supportsTools)
  const sort = (items: ProviderConfigRow[]) => [...items].sort((a,b) => candidateScore(b,requiresReasoning) - candidateScore(a,requiresReasoning))
  const candidates = sort(capabilityCandidates)
  if (!candidates.length) {
    if (allCandidates.length === 0) throw new ApiError(409,'provider_not_configured','Connect and test an AI provider in Settings → AI Assistant before chatting.')
    if (intentTools && !allCandidates.some(row => deriveCapabilities(row).supportsTools)) {
      throw new ApiError(422,'tools_unavailable','Your enabled provider does not support Stracker data tools for this model. Test a tool-capable model in Settings → AI Assistant.')
    }
    throw new ApiError(409,'provider_not_ready','No enabled provider is currently ready. Test the connection in Settings → AI Assistant or wait for its brief cooldown.')
  }

  const preferred = allCandidates.find(row => row.is_default) ?? candidates[0]!
  let chosen = candidates.includes(preferred) ? preferred : candidates[0]!
  let fallbackFrom: ProviderConfigRow | null = chosen.id === preferred.id ? null : preferred
  if (fallbackFrom) input.emit('fallback',{ from:providerName(fallbackFrom), to:providerName(chosen), reason:'The preferred model is unavailable or cannot handle this request.' })
  const availableCandidates = candidates.filter(row => row.id !== chosen.id)
  const agentMessages: AgentMessage[] = input.priorMessages
    .slice(-20)
    .map(message => ({ role:message.role, content:redactPotentialSecrets(message.content).slice(0, 5000) }))
  agentMessages.push({ role:'user',content:redactPotentialSecrets(input.message).slice(0, 5000) })
  let cumulativeChars = agentMessages.reduce((sum,message) => sum + message.content.length, 0)
  while (agentMessages.length > 2 && cumulativeChars > MAX_CONTEXT_CHARS) {
    const removed = agentMessages.shift()!
    cumulativeChars -= removed.content.length
  }
  let toolCalls = 0
  let rounds = 0
  let finalText = ''
  let lastProvider: ProviderConfigRow | null = null
  const used = new Set<string>()

  while (rounds <= TOOL_ITERATION_LIMIT) {
    if (input.signal.aborted) return { status:'cancelled',content:'',providerId:lastProvider?.provider_id ?? null,modelId:lastProvider?.model_id ?? null,fallbackFrom:fallbackFrom?.provider_id ?? null }
    if (Date.now() - start > TOTAL_BUDGET_MS) throw new ApiError(504,'task_timeout','This AI task reached its time limit. Retry with a shorter request.')
    const selected = chosen
    used.add(selected.id)
    const caps = deriveCapabilities(selected)
    const offerTools = caps.supportsTools
    const onProviderDelta: string[] = []
    let completion
    const remainingMs = TOTAL_BUDGET_MS - (Date.now() - start)
    if (remainingMs <= 0) throw new ApiError(504,'task_timeout','This AI task reached its time limit. Retry with a shorter request.')
    try {
      completion = await withProviderTimeout(input.signal, signal => completeWithProvider(providerCallFromConfig(
        selected,
        decryptCredential(selected.encrypted_api_key),
        selectedSystem(input.pageContext,taskType(input.message),offerTools),
        agentMessages,
        offerTools ? MODEL_TOOLS : [],
        signal,
        text => { onProviderDelta.push(text); input.emit('delta',{ text }) },
        taskType(input.message) === 'general' ? 800 : 1200
      )),Math.min(MODEL_TIMEOUT_MS,remainingMs))
      await refreshProviderHealth(input.adminClient,input.userId,selected)
      lastProvider = selected
      rounds += 1
    } catch (error) {
      if (input.signal.aborted) return { status:'cancelled',content:'',providerId:selected.provider_id,modelId:selected.model_id,fallbackFrom:fallbackFrom?.provider_id ?? null }
      const failure = safeProviderError(error)
      await updateProviderHealth(input.adminClient,input.userId,selected,failure.health)
      const next = availableCandidates.find(row => !used.has(row.id))
      if (!failure.retryable && failure.health !== 'malformed_response') throw new ApiError(failure.status === 401 ? 401 : failure.status === 404 ? 422 : 503, failure.health, failure.message)
      if (!next || used.size > FALLBACK_LIMIT) throw new ApiError(failure.status === 401 ? 401 : failure.status === 404 || failure.health === 'unsupported' ? 422 : failure.status === 429 ? 429 : 503, failure.health, failure.message)
      if (onProviderDelta.length) input.emit('reset',{ reason:'The previous provider returned an incomplete response.' })
      fallbackFrom ??= selected
      chosen = next
      input.emit('fallback',{ from:providerName(selected),to:providerName(next),reason:failure.health === 'authentication_failed' ? 'The provider rejected its saved API key.' : failure.health === 'rate_limited' ? 'The provider rate limit was reached.' : failure.health === 'model_unavailable' ? 'The selected model is unavailable.' : failure.health === 'timeout' ? 'The provider took too long to respond.' : 'The selected provider could not complete this request.' })
      await input.adminClient.from('ai_tasks').update({ status:'fallback',provider_id:next.provider_id,model_id:next.model_id,progress:'Trying your configured fallback model.' }).eq('user_id',input.userId).eq('id',input.taskId)
      input.emit('status',{ status:'fallback',progress:`Trying your configured ${providerName(next)} model…`,...humanTaskState(next,selected) })
      continue
    }

    const toolCallsFromProvider = completion.toolCalls
    if (!toolCallsFromProvider.length) {
      finalText = completion.text.trim()
      if (!finalText) throw new ApiError(502,'empty_response','The provider returned an empty answer. Retry or use another provider.')
      const safeText = redactPotentialSecrets(finalText).slice(0,20_000)
      await input.adminClient.from('ai_messages').insert({ user_id:input.userId,conversation_id:input.conversationId,role:'assistant',content:safeText,provider_id:selected.provider_id,model_id:selected.model_id,status:'completed',metadata:{ fallback_from:fallbackFrom ? {provider_id:fallbackFrom.provider_id,model_id:fallbackFrom.model_id} : null } })
      await input.adminClient.from('ai_tasks').update({ status:'completed',provider_id:selected.provider_id,model_id:selected.model_id,progress:'Completed.',completed_at:new Date().toISOString(),metadata:{ fallback_from:fallbackFrom?.provider_id ?? null } }).eq('user_id',input.userId).eq('id',input.taskId)
      await input.adminClient.from('ai_conversations').update({ updated_at:new Date().toISOString() }).eq('user_id',input.userId).eq('id',input.conversationId)
      input.emit('done',{ content:safeText,...humanTaskState(selected,fallbackFrom),taskId:input.taskId })
      return { status:'completed',content:safeText,providerId:selected.provider_id,modelId:selected.model_id,fallbackFrom:fallbackFrom?.provider_id ?? null }
    }

    if (rounds > TOOL_ITERATION_LIMIT || toolCalls + toolCallsFromProvider.length > TOOL_CALL_LIMIT) {
      throw new ApiError(429,'tool_limit','Stracker AI reached its safe tool-call limit. Ask a smaller question to continue.')
    }
    agentMessages.push({ role:'assistant',content:completion.text,toolCalls:toolCallsFromProvider })
    let pendingAction: ActionPreview | undefined
    for (const call of toolCallsFromProvider) {
      toolCalls += 1
      if (input.signal.aborted) return { status:'cancelled',content:'',providerId:selected.provider_id,modelId:selected.model_id,fallbackFrom:fallbackFrom?.provider_id ?? null }
      const progress = toolProgress(call.name)
      await input.adminClient.from('ai_tasks').update({ status:'tool_call',provider_id:selected.provider_id,model_id:selected.model_id,progress }).eq('user_id',input.userId).eq('id',input.taskId)
      input.emit('status',{ status:'tool_call',progress,providerId:selected.provider_id,modelId:selected.model_id })
      try {
        const outcome = await prepareToolCall(input.userClient,input.userId,call,input.taskId,{ providerId:selected.provider_id,modelId:selected.model_id },input.adminClient,input.conversationId)
        if (outcome.kind === 'confirmation') {
          pendingAction = outcome.action
          input.emit('confirmation',{ action:outcome.action,providerId:selected.provider_id,modelId:selected.model_id })
          break
        }
        agentMessages.push({ role:'tool',toolCallId:call.id,toolName:call.name,content:jsonToolContent(outcome.result) })
      } catch (error) {
        const message = error instanceof ApiError ? error.message : 'Stracker could not validate that tool request. No data was changed.'
        agentMessages.push({ role:'tool',toolCallId:call.id,toolName:call.name,content:jsonToolContent({ error:message }) })
      }
    }
    lastProvider = selected
    if (pendingAction) {
      await input.adminClient.from('ai_tasks').update({ status:'waiting',progress:'Waiting for your confirmation.',provider_id:selected.provider_id,model_id:selected.model_id }).eq('user_id',input.userId).eq('id',input.taskId)
      return { status:'waiting',content:completion.text,providerId:selected.provider_id,modelId:selected.model_id,fallbackFrom:fallbackFrom?.provider_id ?? null,action:pendingAction }
    }
    rounds += 1
    await input.adminClient.from('ai_tasks').update({ status:'running',progress:'Reviewing your Stracker data…',provider_id:selected.provider_id,model_id:selected.model_id }).eq('user_id',input.userId).eq('id',input.taskId)
    input.emit('status',{ status:'running',progress:'Reviewing your Stracker data…',providerId:selected.provider_id,modelId:selected.model_id })
  }
  throw new ApiError(429,'tool_limit','Stracker AI reached its safe tool-call limit. Ask a smaller question to continue.')
}

export function labelProvider(id: string): string {
  const names: Record<AIProviderId,string> = { gemini:'Gemini',openai:'OpenAI',anthropic:'Claude',deepseek:'DeepSeek',qwen:'Qwen',custom:'Custom AI' }
  return names[id as AIProviderId] ?? 'AI Assistant'
}
