import type { SupabaseClient } from '@supabase/supabase-js'
import { inferCapabilities, runtimeHealth, type ProviderConfigRow, type AIProviderId } from './registry.js'
import { decryptCredential, redactPotentialSecrets } from './secrets.js'
import { completeWithProvider, providerCallFromConfig, safeProviderError, type AgentMessage, type ModelTool } from './provider-adapters.js'
import { ApiError } from './http.js'
import { AIError, connectionStatusFor, cooldownSecondsFor, type AIErrorCode } from './ai-errors.js'
import { logAIEvent } from './diagnostics.js'
import { SITE_PROVIDER_TABLE } from './provider-scope.js'
import {
  STRACKER_DAILY_LIMIT, STRACKER_DAILY_LIMIT_OWN, STRACKER_MINUTE_LIMIT, STRACKER_MINUTE_LIMIT_OWN, STRACKER_UNAVAILABLE, STRACKER_UNAVAILABLE_OWN, derivePreference, isSiteRow, publicModelId, publicProviderId, publicProviderName,
  readSiteProviders, readSiteSettings, readStoredPreference, takeStrackerSlot, type AIPreference, type SiteAISettings
} from './stracker-default.js'
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

const TOOL_ITERATION_LIMIT = 8
/** Hard ceiling across the whole task. A single broad question may fan out many reads. */
const TOOL_CALL_LIMIT = 24
/** Execute at most this many tools per model turn so the next answer stays fast. */
const TOOLS_PER_ROUND = 6
/** Attempts after the first: covers every owner-ordered Stracker AI model plus the student's own. */
const FALLBACK_LIMIT = 12
/** First-token cap while another model is still waiting. Not used once this model has replied. */
const CHAIN_STEP_TIMEOUT_MS = 20_000
// Preview/thinking models can take well over 20 s to first token under load; the overall task
// budget (below Vercel's 60 s maxDuration) is the real limit.
const MODEL_TIMEOUT_MS = 45_000
const TOTAL_BUDGET_MS = 53_000
const MAX_CONTEXT_CHARS = 48_000

const SYSTEM_PROMPT = `You are Stracker AI, an assistant for an exam-preparation study notebook. Be warm, concise, and practical. Help with the student's own exam and subjects (stated below when known); do not assume JEE or Physics/Chemistry/Maths unless that is their exam.

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
/** Words that mean the student is talking about saved notebook data, not just their life. */
const NOTEBOOK_TOPIC = /\b(analytics|dashboard|scores?|marks|average|weak|mistakes?|revisions?|revis(?:e|ion)|today'?s tasks|study time|study hours|performance|chapters?|syllabus|pyq|mocks?|tests?|tasks?|goals?|exam date|settings?|stracker)\b/i
const WRITE_VERB = /\b(add|create|delete|remove|update|record|log|save|complete|mark)\b/i
/** A streamed answer at least this long is kept if the provider clock runs out. Shorter stubs still fall through. */
const KEEP_PARTIAL_CHARS = 80

function fallbackReason(code: AIErrorCode): string {
  switch (code) {
    case 'INVALID_CREDENTIAL': return 'The provider rejected its saved API key.'
    case 'RATE_LIMITED': return 'The provider rate limit was reached.'
    case 'INSUFFICIENT_BALANCE': return 'The provider reports insufficient balance or quota.'
    case 'MODEL_NOT_FOUND': return 'The selected model is unavailable.'
    case 'UNSUPPORTED_CAPABILITY': return 'The selected model cannot handle this request.'
    case 'TIMEOUT': return 'The provider took too long to respond.'
    default: return 'The selected provider could not complete this request.'
  }
}

/** Name shown to the student: Stracker AI (Default) rows never reveal the vendor behind them. */
function providerName(config: ProviderConfigRow): string {
  return publicProviderName(config)
}

/** Provider ID shown to the student and stored on their messages/tasks ("stracker" for the default). */
function pid(config: ProviderConfigRow): string {
  return publicProviderId(config)
}

/** Model shown and stored for the student: the company + family label, never the model ID. */
function mid(config: ProviderConfigRow): string {
  return publicModelId(config)
}

export function strackerUnavailable(hasOwn = false): ApiError {
  return new ApiError(503,'stracker_ai_unavailable',hasOwn ? STRACKER_UNAVAILABLE_OWN : STRACKER_UNAVAILABLE)
}

function strackerLimitError(result: 'minute' | 'day' | 'unavailable', hasOwn = false): ApiError {
  if (result === 'day') return new ApiError(429,'stracker_ai_daily_limit',hasOwn ? STRACKER_DAILY_LIMIT_OWN : STRACKER_DAILY_LIMIT)
  if (result === 'minute') return new ApiError(429,'stracker_ai_limit',hasOwn ? STRACKER_MINUTE_LIMIT_OWN : STRACKER_MINUTE_LIMIT)
  return strackerUnavailable(hasOwn)
}

function taskType(message: string): 'action' | 'analytics' | 'general' {
  if (requiresTools(message) && WRITE_VERB.test(message) && NOTEBOOK_TOPIC.test(message)) return 'action'
  if (requiresTools(message)) return 'analytics'
  return 'general'
}

export type ModelTier = 'fast' | 'standard' | 'rich'
/** Rough speed/capability tier from the model ID, used to size context, output and tool depth. */
export function modelTier(modelId: string): ModelTier {
  const id = modelId.toLowerCase()
  if (/(^|[-_.])(lite|mini|nano|haiku|8b|turbo|small)([-_.]|$)/.test(id)) return 'fast'
  if (/(^|[-_/])pro\b|opus|reasoner|-max|^o\d|thinking/.test(id)) return 'rich'
  return 'standard'
}
const TIER_LIMITS: Record<ModelTier, { history: number; rounds: number; general: number; data: number }> = {
  fast: { history: 12, rounds: 4, general: 700, data: 1200 },
  standard: { history: 24, rounds: 6, general: 1000, data: 1800 },
  rich: { history: 32, rounds: 7, general: 1600, data: 2600 }
}

function dropLeadingNonUser(messages: AgentMessage[]): AgentMessage[] {
  const first = messages.findIndex(message => message.role === 'user')
  return first > 0 ? messages.slice(first) : messages
}

/**
 * Tools only when the student is asking about saved Stracker data or a notebook change.
 * A long personal note ("change stream", "someone like me") is plain text. Attaching the
 * tool catalog to that makes every provider call slow, which is why a ~4,000 character
 * message was timing out and hopping models.
 */
export function requiresTools(message: string): boolean {
  if (/\b(about me|know about me|my analytics|my progress|my tests|my scores|my marks|my mistakes|weak areas)\b/i.test(message)) return true
  if (message.length > 800) return WRITE_VERB.test(message) && NOTEBOOK_TOPIC.test(message)
  return NOTEBOOK_TOPIC.test(message) || STRACKER_INTENT.test(message) || /\b(my|mine)\b/i.test(message)
}

/** Keep a real answer that was already streaming. A short stub ("Sure,") still falls through. */
export function keepStreamedAnswer(text: string): boolean {
  return text.trim().length >= KEEP_PARTIAL_CHARS
}

const OVERVIEW_TOOLS = [
  'get_dashboard_summary', 'get_test_history', 'get_subject_performance', 'get_chapter_performance',
  'get_weak_areas', 'get_mistake_summary', 'get_study_time_summary', 'get_revision_due', 'get_daily_tasks', 'get_settings'
]
const TOOL_GROUPS: Array<{ test: RegExp; tools: string[] }> = [
  { test: /\b(mistake|silly mistake|error log)\b/i, tools: ['find_chapters', 'get_mistake_summary', 'create_mistake', 'update_mistake', 'delete_mistake'] },
  { test: /\b(test|mock|score|marks|pyq|percentage|average)\b/i, tools: ['find_chapters', 'get_settings', 'get_test_history', 'get_test_details', 'get_subject_performance', 'get_dashboard_summary', 'create_test', 'update_test', 'update_subject_score', 'delete_test'] },
  { test: /\b(task|planner|to-?do|today)\b/i, tools: ['get_daily_tasks', 'create_task', 'update_task', 'complete_task', 'delete_task', 'find_chapters'] },
  { test: /\brevis/i, tools: ['get_revision_due', 'mark_revision_complete', 'update_revision_schedule', 'find_chapters'] },
  { test: /\b(chapter|syllabus|weak)\b/i, tools: ['find_chapters', 'get_chapter_performance', 'get_weak_areas', 'get_subject_performance', 'get_dashboard_summary'] },
  { test: /\b(setting|exam date|target score|weekly goal)\b/i, tools: ['get_settings', 'update_settings', 'create_weekly_goal', 'update_weekly_goal', 'complete_weekly_goal'] },
  { test: /\b(analytic|progress|performance|dashboard|guidance|guide|plan|recommend|strategy|about me|know about)\b/i, tools: OVERVIEW_TOOLS }
]
const WRITE_TOOL = /^(create|update|delete|complete|mark)_/
const WRITE_INTENT = /\b(add|create|delete|remove|update|record|mark|complete|change|set|log|save)\b/i

/**
 * Send only the tools this question can use. The full catalog is large enough to slow every
 * provider call and to make models fan out into the tool-call ceiling before they answer.
 */
export function toolsForMessage(message: string, catalog: ModelTool[] = MODEL_TOOLS): ModelTool[] {
  const names = new Set<string>()
  let matched = false
  for (const group of TOOL_GROUPS) {
    if (!group.test.test(message)) continue
    matched = true
    for (const name of group.tools) names.add(name)
  }
  if (!matched) for (const name of OVERVIEW_TOOLS) names.add(name)
  const wantsWrite = WRITE_INTENT.test(message)
  const byName = new Map(catalog.map(tool => [tool.name, tool]))
  const selected: ModelTool[] = []
  for (const name of names) {
    const tool = byName.get(name)
    if (!tool) continue
    if (!wantsWrite && WRITE_TOOL.test(name)) continue
    selected.push(tool)
    if (selected.length >= 12) break
  }
  if (selected.length) return selected
  return OVERVIEW_TOOLS.slice(0, 3).flatMap(name => {
    const tool = byName.get(name)
    return tool ? [tool] : []
  })
}

/** Hung first token may fall through quickly. Once any text is streaming, keep the long timeout. */
export function providerStepTimeoutMs(modelHasProgress: boolean, moreCandidatesWaiting: boolean, remainingMs: number, modelTimeout = MODEL_TIMEOUT_MS, chainTimeout = CHAIN_STEP_TIMEOUT_MS): number {
  const cap = modelHasProgress || !moreCandidatesWaiting ? modelTimeout : chainTimeout
  return Math.max(1_000, Math.min(cap, remainingMs))
}

/** Silence uses the short cap. The first streamed token switches to the full model timeout. */
export function providerDeadlineMs(hasStreamedText: boolean, modelHasProgress: boolean, moreCandidatesWaiting: boolean, remainingMs: number, messageLength = 0): number {
  if (hasStreamedText || modelHasProgress) return providerStepTimeoutMs(true, moreCandidatesWaiting, remainingMs)
  const silenceCap = messageLength >= 1_500 ? 28_000 : CHAIN_STEP_TIMEOUT_MS
  return providerStepTimeoutMs(false, moreCandidatesWaiting, remainingMs, MODEL_TIMEOUT_MS, silenceCap)
}

function answerTokenLimit(message: string, kind: 'action' | 'analytics' | 'general', limits: { general: number; data: number }): number {
  const base = kind === 'general' ? limits.general : limits.data
  if (message.length < 800) return base
  return Math.min(3_200, Math.max(base, kind === 'general' ? 2_200 : 2_600))
}

export function candidateScore(row: ProviderConfigRow, requiresReasoning: boolean, preference: AIPreference = 'own'): number {
  const caps = inferCapabilities(row.provider_id,row.model_id,row.protocol,row.capabilities)
  // The student's chosen group (Stracker AI or their own providers) always goes first; the other is fallback.
  const inPreferredGroup = isSiteRow(row) === (preference === 'stracker')
  // Owner-ordered Stracker AI models keep the owner's order exactly (stable sort, equal scores).
  if (isSiteRow(row)) return inPreferredGroup ? 1000 : 0
  return (inPreferredGroup ? 1000 : 0) + (row.is_default ? 100 : 0) + (requiresReasoning && caps.supportsReasoning ? 10 : 0) + (caps.supportsTools ? 2 : 0)
}

/**
 * One prompt line naming the student's exam and its subjects, from app_settings + exam_catalog.
 * Best effort: any lookup failure simply leaves the prompt exam-neutral.
 */
export async function studentExamLine(admin: SupabaseClient, userId: string): Promise<string> {
  try {
    const { data: settings } = await admin.from('app_settings').select('exam_id,exam_year').eq('user_id',userId).maybeSingle()
    const examId = (settings as { exam_id?: string | null } | null)?.exam_id || 'jee'
    const year = (settings as { exam_year?: number | null } | null)?.exam_year
    const { data: exam } = await admin.from('exam_catalog').select('name,subjects').eq('id',examId).maybeSingle()
    const row = exam as { name?: string; subjects?: string[] } | null
    const name = row?.name || (examId === 'jee' ? 'JEE (Main + Advanced)' : examId)
    const subjects = Array.isArray(row?.subjects) && row.subjects.length ? row.subjects : examId === 'jee' ? ['Physics','Chemistry','Maths'] : []
    return `\nThe student is preparing for ${name}${year ? ` ${year}` : ''}.${subjects.length ? ` Their subjects: ${subjects.slice(0, 20).join(', ')}.` : ''}`
  } catch {
    return ''
  }
}

/** Distinguish "nothing connected" from "connected but switched off" so the user knows the next step. */
async function explainNoEnabledProvider(admin: SupabaseClient, userId: string): Promise<void> {
  const { data } = await admin.from('ai_provider_configs').select('connection_status').eq('user_id',userId)
  const rows = (data ?? []) as Array<{ connection_status: string }>
  if (rows.some(row => row.connection_status === 'connected')) {
    throw new ApiError(409,'provider_disabled','Your AI provider is connected but switched off. Turn it on with Enable in Settings → AI Assistant.')
  }
  if (rows.length) throw new ApiError(409,'provider_not_ready','Your AI provider has not passed a connection test yet. Run Test in Settings → AI Assistant.')
}

async function getCandidates(admin: SupabaseClient, userId: string): Promise<ProviderConfigRow[]> {
  const { data, error } = await admin.from('ai_provider_configs').select('*').eq('user_id',userId).eq('enabled',true).order('is_default',{ascending:false}).order('updated_at',{ascending:false})
  if (error) throw new ApiError(503,'provider_config_unavailable','AI provider settings could not be loaded. Try again.')
  return (data ?? []) as ProviderConfigRow[]
}

interface StrackerContext { settings: SiteAISettings; rows: ProviderConfigRow[]; storedPreference: string | null }

/** Stracker AI (Default) rows the student may use right now (none when the owner switched it off). */
async function getStrackerContext(admin: SupabaseClient, userId: string): Promise<StrackerContext> {
  const [settings, storedPreference] = await Promise.all([readSiteSettings(admin), readStoredPreference(admin, userId)])
  const rows = settings.enabled ? await readSiteProviders(admin) : []
  return { settings, rows, storedPreference }
}

const DISABLING_CODES: ReadonlySet<AIErrorCode> = new Set(['INVALID_CREDENTIAL', 'MODEL_NOT_FOUND', 'INSUFFICIENT_BALANCE', 'REQUEST_INVALID', 'UNSUPPORTED_CAPABILITY'])
/** Shared default: only account-level problems take it out of rotation for everyone. */
const SITE_DISABLING_CODES: ReadonlySet<AIErrorCode> = new Set(['INVALID_CREDENTIAL', 'MODEL_NOT_FOUND', 'INSUFFICIENT_BALANCE'])
const STATUS_CHANGING_CODES: ReadonlySet<AIErrorCode> = new Set(['RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'TIMEOUT', 'NETWORK_ERROR', 'CONFIGURATION_ERROR'])

/**
 * Stop is the only user-initiated cancellation. It is recorded as status 'cancelled' by the cancel
 * endpoint; closing or navigating away never sets it. Checked at each safe checkpoint so no further
 * provider round or Stracker tool write starts after Stop.
 */
async function stopRequested(admin: SupabaseClient, userId: string, taskId: string): Promise<boolean> {
  const { data, error } = await admin.from('ai_tasks').select('status').eq('user_id', userId).eq('id', taskId).maybeSingle()
  if (error) {
    logAIEvent('warn', 'stop_check_failed', { taskId, userId })
    return false
  }
  return data?.status === 'cancelled'
}

export async function updateProviderHealth(admin: SupabaseClient, userId: string, row: ProviderConfigRow, failure: AIError): Promise<void> {
  const cooldown = cooldownSecondsFor(failure.aiCode)
  const disable = DISABLING_CODES.has(failure.aiCode)
  const patch: Record<string, unknown> = {
    connection_status: connectionStatusFor(failure.aiCode),
    cooldown_until: cooldown ? new Date(Date.now() + cooldown * 1000).toISOString() : null,
    failure_count: Math.min(1000, row.failure_count + 1),
    last_checked_at: new Date().toISOString(),
    enabled: disable ? false : row.enabled,
    is_default: disable ? false : row.is_default
  }
  if (isSiteRow(row)) {
    // Stracker AI (Default) is shared: a student's own request problem never switches it off for
    // everyone. Only a broken key, model or balance takes it out of rotation until the owner fixes it.
    const siteDisable = SITE_DISABLING_CODES.has(failure.aiCode)
    const sitePatch: Record<string, unknown> = { ...patch, enabled: siteDisable ? false : row.enabled, is_default: siteDisable ? false : row.is_default }
    if (!siteDisable && !STATUS_CHANGING_CODES.has(failure.aiCode)) sitePatch.connection_status = row.connection_status
    const { error } = await admin.from(SITE_PROVIDER_TABLE).update(sitePatch).eq('id', row.id)
    if (error) logAIEvent('warn', 'provider_health_update_failed', { scope: 'site', configId: row.id, code: failure.aiCode })
    return
  }
  const { error } = await admin.from('ai_provider_configs').update(patch).eq('user_id', userId).eq('id', row.id)
  if (error) logAIEvent('warn', 'provider_health_update_failed', { userId, configId: row.id, code: failure.aiCode })
}

async function refreshProviderHealth(admin: SupabaseClient, userId: string, row: ProviderConfigRow): Promise<void> {
  if (isSiteRow(row)) {
    await admin.from(SITE_PROVIDER_TABLE).update({ connection_status:'connected', cooldown_until:null, failure_count:0 }).eq('id',row.id)
    return
  }
  await admin.from('ai_provider_configs').update({ connection_status:'connected', cooldown_until:null, failure_count:0 }).eq('user_id',userId).eq('id',row.id)
}

function jsonToolContent(value: unknown): string {
  let content: string
  try { content = JSON.stringify(value) } catch { content = '{"error":"Tool result could not be formatted."}' }
  content = redactPotentialSecrets(content)
  if (content.length > 6_000) return JSON.stringify({ truncated: true, preview: content.slice(0, 5_600) })
  return content
}

function humanTaskState(row: ProviderConfigRow, fallbackFrom: ProviderConfigRow | null): Record<string, unknown> {
  return {
    providerId:pid(row),
    providerName:providerName(row),
    modelId:mid(row),
    fallbackFrom: fallbackFrom ? { providerId:pid(fallbackFrom), providerName:providerName(fallbackFrom), modelId:mid(fallbackFrom) } : null
  }
}

function deriveCapabilities(row: ProviderConfigRow) {
  return inferCapabilities(row.provider_id,row.model_id,row.protocol,row.capabilities)
}

function selectedSystem(pageContext: string | null, taskKind: string, canUseTools: boolean, examLine = '', toolsWithheld = false, answerFromResults = false): string {
  const context = pageContext ? `\nCurrent Stracker section: ${pageContext}. This is only a navigation hint; read relevant information through the listed tools.` : ''
  const task = `\nCurrent task category: ${taskKind}.`
  const tools = answerFromResults
    ? '\nTool results are already in the conversation. Answer the student now in plain language and do not call more tools.'
    : toolsWithheld
    ? '\nThis looks like general study help, so no Stracker data tools are attached to this message. Do not claim to know the student’s saved data; if they want it, invite them to ask about their tests, chapters, mistakes or tasks.'
    : canUseTools
    ? '\nUse at most four of the provided tools, then answer. For a broad progress or analytics question, call get_dashboard_summary first instead of every read tool, and do not repeat a tool you already called. When a user asks for an app change, call the correct write tool only after collecting required details; wait for the app confirmation.'
    : '\nNo Stracker data tools are enabled for this model. Do not claim to know the user’s saved data or perform an app action. For a personal Stracker question, explain that a tool-capable tested provider must be enabled in AI Assistant settings.'
  return `${SYSTEM_PROMPT}${examLine}${context}${task}${tools}`
}

async function withProviderTimeout<T>(parent: AbortSignal, run: (signal: AbortSignal, noteActivity: () => void) => Promise<T>, timeoutMs = MODEL_TIMEOUT_MS, extendedTimeoutMs = timeoutMs): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  let extended = false
  const started = Date.now()
  const abortFromParent = () => controller.abort(parent.reason)
  if (parent.aborted) abortFromParent()
  else parent.addEventListener('abort', abortFromParent, { once: true })
  const fire = () => { timedOut = true; controller.abort(new DOMException('AI provider request timed out', 'TimeoutError')) }
  let timer = setTimeout(fire, timeoutMs)
  const noteActivity = () => {
    if (extended || extendedTimeoutMs <= timeoutMs) return
    extended = true
    clearTimeout(timer)
    const left = extendedTimeoutMs - (Date.now() - started)
    if (left <= 0) { fire(); return }
    timer = setTimeout(fire, left)
  }
  try {
    return await run(controller.signal, noteActivity)
  } catch (error) {
    if (timedOut && !parent.aborted) throw new AIError('TIMEOUT', { userMessage: 'The provider took too long to respond. Try again or use another configured provider.' })
    throw error
  } finally {
    clearTimeout(timer)
    parent.removeEventListener('abort', abortFromParent)
  }
}

export async function runAssistant(input: AgentRunInput): Promise<AgentRunResult> {
  const state = { site: false, hasOwn: false }
  try {
    return await runAssistantCore(input, state)
  } catch (error) {
    // A Stracker AI (Default) failure never exposes the vendor, endpoint or provider wording.
    // Running out of time while walking the owner's model chain reads the same: add your own model.
    if (state.site && (error instanceof AIError || (error instanceof ApiError && error.code === 'task_timeout'))) throw strackerUnavailable(state.hasOwn)
    throw error
  }
}

async function runAssistantCore(input: AgentRunInput, state: { site: boolean; hasOwn: boolean }): Promise<AgentRunResult> {
  const start = Date.now()
  const intentTools = requiresTools(input.message)
  const requiresReasoning = COMPLEX_INTENT.test(input.message)
  const [ownCandidates, stracker, examLine] = await Promise.all([
    getCandidates(input.adminClient,input.userId),
    getStrackerContext(input.adminClient,input.userId),
    studentExamLine(input.adminClient,input.userId)
  ])
  const preference = derivePreference(stracker.storedPreference, ownCandidates)
  state.hasOwn = ownCandidates.length > 0
  const allCandidates = [...stracker.rows, ...ownCandidates]
  if (allCandidates.length === 0) {
    await explainNoEnabledProvider(input.adminClient,input.userId)
    // No own provider and the default is switched off or not set up yet.
    throw strackerUnavailable()
  }
  const usable = allCandidates.filter(row => runtimeHealth(row) === 'ready')
  const capabilityCandidates = usable.filter(row => !intentTools || deriveCapabilities(row).supportsTools)
  const sort = (items: ProviderConfigRow[]) => [...items].sort((a,b) => candidateScore(b,requiresReasoning,preference) - candidateScore(a,requiresReasoning,preference))
  const candidates = sort(capabilityCandidates)
  if (!candidates.length) {
    const onlyDefault = ownCandidates.length === 0
    // The input was meant for Stracker AI (Default): it counts toward today's limit even
    // though no default model can answer right now (every input counts as 1, errors included).
    if (onlyDefault && stracker.rows.length) {
      const slot = await takeStrackerSlot(input.adminClient,input.userId,stracker.settings)
      if (slot === 'day' || slot === 'minute') throw strackerLimitError(slot)
    }
    if (intentTools && usable.length && !allCandidates.some(row => deriveCapabilities(row).supportsTools)) {
      throw new ApiError(422,'tools_unavailable', onlyDefault
        ? 'Stracker AI cannot read your saved Stracker data right now. Ask a general question, or add your own AI model to keep going.'
        : 'Your enabled provider does not support Stracker data tools for this model. Test a tool-capable model in Settings → AI Assistant.')
    }
    if (onlyDefault) throw strackerUnavailable()
    throw new ApiError(409,'provider_not_ready','No enabled provider is currently ready. Test the connection in Settings → AI Assistant or wait for its brief cooldown.')
  }

  const preferredGroup = allCandidates.filter(row => isSiteRow(row) === (preference === 'stracker'))
  const preferred = (preference === 'stracker' ? preferredGroup[0] : preferredGroup.find(row => row.is_default)) ?? preferredGroup[0] ?? candidates[0]!
  let chosen = candidates.includes(preferred) ? preferred : candidates[0]!
  let fallbackFrom: ProviderConfigRow | null = chosen.id === preferred.id ? null : preferred
  if (fallbackFrom) input.emit('fallback',{ from:providerName(fallbackFrom), to:providerName(chosen), reason:'The preferred model is unavailable or cannot handle this request.' })
  const availableCandidates = candidates.filter(row => row.id !== chosen.id)
  const agentMessages: AgentMessage[] = input.priorMessages
    .slice(-32)
    .map(message => ({ role:message.role, content:redactPotentialSecrets(message.content).slice(0, 8_000) }))
  agentMessages.push({ role:'user',content:redactPotentialSecrets(input.message).slice(0, 8_000) })
  let cumulativeChars = agentMessages.reduce((sum,message) => sum + message.content.length, 0)
  while (agentMessages.length > 2 && cumulativeChars > MAX_CONTEXT_CHARS) {
    const removed = agentMessages.shift()!
    cumulativeChars -= removed.content.length
  }
  let toolCalls = 0
  let rounds = 0
  // Set when a model rejects tool declarations; the same model then answers without tools.
  const toolsRejected = new Set<string>()
  const progressed = new Set<string>()
  const toolCache = new Map<string, string>()
  let answeringWithoutTools = false
  let lastProvider: ProviderConfigRow | null = null
  const used = new Set<string>()
  // One Stracker AI (Default) daily slot per student input, taken before the first default
  // model is called (so errors still count) and never again for fallbacks within the same input.
  let strackerSlot = false
  let strackerBlocked = false

  const finish = async (selected: ProviderConfigRow, text: string): Promise<AgentRunResult> => {
    const safeText = redactPotentialSecrets(text).slice(0, 20_000)
    await input.adminClient.from('ai_messages').insert({ user_id:input.userId,conversation_id:input.conversationId,role:'assistant',content:safeText,provider_id:pid(selected),model_id:mid(selected),status:'completed',metadata:{ fallback_from:fallbackFrom ? {provider_id:pid(fallbackFrom),model_id:mid(fallbackFrom)} : null } })
    if (await stopRequested(input.adminClient,input.userId,input.taskId)) return { status:'cancelled',content:'',providerId:pid(selected),modelId:mid(selected),fallbackFrom:fallbackFrom ? pid(fallbackFrom) : null }
    await input.adminClient.from('ai_tasks').update({ status:'completed',provider_id:pid(selected),model_id:mid(selected),progress:'Completed.',completed_at:new Date().toISOString(),metadata:{ fallback_from:fallbackFrom ? pid(fallbackFrom) : null } }).eq('user_id',input.userId).eq('id',input.taskId)
    await input.adminClient.from('ai_conversations').update({ updated_at:new Date().toISOString() }).eq('user_id',input.userId).eq('id',input.conversationId)
    input.emit('done',{ content:safeText,...humanTaskState(selected,fallbackFrom),taskId:input.taskId })
    return { status:'completed',content:safeText,providerId:pid(selected),modelId:mid(selected),fallbackFrom:fallbackFrom ? pid(fallbackFrom) : null }
  }

  while (rounds <= TOOL_ITERATION_LIMIT) {
    if (input.signal.aborted || await stopRequested(input.adminClient,input.userId,input.taskId)) return { status:'cancelled',content:'',providerId:lastProvider ? pid(lastProvider) : null,modelId:lastProvider ? mid(lastProvider) : null,fallbackFrom:fallbackFrom ? pid(fallbackFrom) : null }
    if (Date.now() - start > TOTAL_BUDGET_MS) throw new ApiError(504,'task_timeout','This AI task reached its time limit. Retry with a shorter request.')
    const selected = chosen
    used.add(selected.id)
    if (isSiteRow(selected) && !strackerSlot) {
      const slot = await takeStrackerSlot(input.adminClient,input.userId,stracker.settings)
      if (slot !== 'ok') {
        strackerBlocked = true
        const next = availableCandidates.find(row => !used.has(row.id) && !isSiteRow(row))
        if (!next) throw strackerLimitError(slot,state.hasOwn)
        fallbackFrom ??= selected
        chosen = next
        input.emit('fallback',{ from:providerName(selected),to:providerName(next),reason:slot === 'day' ? 'Today’s Stracker AI limit was reached.' : 'Stracker AI is busy right now.' })
        continue
      }
      strackerSlot = true
    }
    state.site = isSiteRow(selected)
    const caps = deriveCapabilities(selected)
    const limits = TIER_LIMITS[modelTier(selected.model_id)]
    const offeredTools = toolsForMessage(input.message)
    // Only send tools when the question needs Stracker data. A plain "hello" is faster, and a
    // model that rejected tools — or already used its tool rounds — answers from what it has.
    const offerTools = !answeringWithoutTools && caps.supportsTools && intentTools && !toolsRejected.has(selected.id) && rounds < limits.rounds && offeredTools.length > 0
    const history = agentMessages.length > limits.history * 2 && !agentMessages.some(message => message.role === 'tool') ? dropLeadingNonUser(agentMessages.slice(-limits.history)) : agentMessages
    const onProviderDelta: string[] = []
    let completion
    const remainingMs = TOTAL_BUDGET_MS - (Date.now() - start)
    if (remainingMs <= 0) throw new ApiError(504,'task_timeout','This AI task reached its time limit. Retry with a shorter request.')
    const moreWaiting = availableCandidates.some(row => !used.has(row.id))
    const silentMs = providerDeadlineMs(false, progressed.has(selected.id), moreWaiting, remainingMs, input.message.length)
    const fullMs = providerDeadlineMs(true, progressed.has(selected.id), moreWaiting, remainingMs, input.message.length)
    try {
      completion = await withProviderTimeout(input.signal, (signal, noteActivity) => completeWithProvider(providerCallFromConfig(
        selected,
        decryptCredential(selected.encrypted_api_key),
        selectedSystem(input.pageContext,taskType(input.message),offerTools,examLine,!offerTools && caps.supportsTools && !intentTools, answeringWithoutTools),
        history,
        offerTools ? offeredTools : [],
        signal,
        text => { onProviderDelta.push(text); noteActivity(); input.emit('delta',{ text }) },
        answerTokenLimit(input.message, taskType(input.message), limits)
      )), silentMs, fullMs)
      await refreshProviderHealth(input.adminClient,input.userId,selected)
      lastProvider = selected
      progressed.add(selected.id)
      rounds += 1
    } catch (error) {
      if (input.signal.aborted) return { status:'cancelled',content:'',providerId:pid(selected),modelId:mid(selected),fallbackFrom:fallbackFrom ? pid(fallbackFrom) : null }
      const failure = safeProviderError(error,{ provider:selected.provider_id,model:mid(selected) })
      const streamed = onProviderDelta.join('').trim()
      if (failure.aiCode === 'TIMEOUT' && keepStreamedAnswer(streamed)) {
        logAIEvent('info','kept_partial_answer',{ taskId:input.taskId,userId:input.userId,provider:selected.provider_id,model:selected.model_id,chars:streamed.length })
        return finish(selected, streamed)
      }
      if (offerTools && (failure.aiCode === 'UNSUPPORTED_CAPABILITY' || failure.aiCode === 'REQUEST_INVALID') && !onProviderDelta.length) {
        // The model (or its schema dialect) rejects tool calling: answer once more without tools.
        toolsRejected.add(selected.id)
        logAIEvent('info','tools_rejected_retry_without_tools',{ taskId:input.taskId,userId:input.userId,provider:selected.provider_id,model:selected.model_id })
        continue
      }
      logAIEvent('warn','provider_failure',{ taskId:input.taskId,userId:input.userId,stage:'completion',round:rounds,provider:selected.provider_id,model:selected.model_id,durationMs:Date.now()-start,...failure.diagnostics() })
      await updateProviderHealth(input.adminClient,input.userId,selected,failure)
      const next = availableCandidates.find(row => !used.has(row.id) && !(strackerBlocked && isSiteRow(row)))
      // A shared Stracker AI model failing for any provider reason always hands over to the next model.
      if (!next || used.size > FALLBACK_LIMIT || !(failure.fallbackEligible || isSiteRow(selected))) throw failure
      if (onProviderDelta.length) input.emit('reset',{ reason:'The previous provider returned an incomplete response.' })
      fallbackFrom ??= selected
      chosen = next
      input.emit('fallback',{ from:providerName(selected),to:providerName(next),reason:fallbackReason(failure.aiCode) })
      logAIEvent('info','provider_fallback',{ taskId:input.taskId,userId:input.userId,from:selected.provider_id,fromModel:selected.model_id,to:next.provider_id,toModel:next.model_id,code:failure.aiCode })
      await input.adminClient.from('ai_tasks').update({ status:'fallback',provider_id:pid(next),model_id:mid(next),progress:isSiteRow(next) ? 'Trying Stracker AI (Default).' : 'Trying your configured fallback model.' }).eq('user_id',input.userId).eq('id',input.taskId)
      input.emit('status',{ status:'fallback',progress:isSiteRow(next) ? 'Trying Stracker AI (Default)…' : `Trying your configured ${providerName(next)} model…`,...humanTaskState(next,selected) })
      continue
    }

    if (!completion) throw new AIError('INTERNAL_ERROR', { provider: selected.provider_id, model: mid(selected) })
    const toolCallsFromProvider = completion.toolCalls
    if (!toolCallsFromProvider.length) {
      const finalText = completion.text.trim()
      if (!finalText) throw new AIError('MALFORMED_RESPONSE',{ provider:selected.provider_id,model:mid(selected),providerMessage:'empty final answer' })
      return finish(selected, finalText)
    }

    const room = TOOL_CALL_LIMIT - toolCalls
    // A fan-out or a long tool loop used to throw here and show the student nothing.
    // Park the calls and spend the next turn writing the answer from data already retrieved.
    if (answeringWithoutTools || rounds > TOOL_ITERATION_LIMIT) {
      return finish(selected, completion.text.trim() || 'I looked through your Stracker notebook. Ask about recent tests, weak chapters, mistakes, or today’s plan if you want that piece on its own.')
    }
    if (rounds >= TOOL_ITERATION_LIMIT || room <= 0) {
      agentMessages.push({ role:'assistant',content:completion.text,toolCalls:toolCallsFromProvider,providerData:completion.providerData })
      for (const call of toolCallsFromProvider) {
        agentMessages.push({ role:'tool',toolCallId:call.id,toolName:call.name,content:jsonToolContent({ note:'Stop calling tools and answer now from the results already in this conversation.' }) })
      }
      answeringWithoutTools = true
      continue
    }
    const accepted = toolCallsFromProvider.slice(0, Math.min(room, TOOLS_PER_ROUND))
    const skipped = toolCallsFromProvider.slice(accepted.length)
    agentMessages.push({ role:'assistant',content:completion.text,toolCalls:toolCallsFromProvider,providerData:completion.providerData })
    let pendingAction: ActionPreview | undefined
    for (const call of accepted) {
      if (input.signal.aborted || await stopRequested(input.adminClient,input.userId,input.taskId)) return { status:'cancelled',content:'',providerId:pid(selected),modelId:mid(selected),fallbackFrom:fallbackFrom ? pid(fallbackFrom) : null }
      const signature = `${call.name}:${(() => { try { return JSON.stringify(call.arguments ?? {}) } catch { return '' } })()}`
      const cached = toolCache.get(signature)
      if (cached) {
        agentMessages.push({ role:'tool',toolCallId:call.id,toolName:call.name,content:cached })
        continue
      }
      toolCalls += 1
      const progress = toolProgress(call.name)
      await input.adminClient.from('ai_tasks').update({ status:'tool_call',provider_id:pid(selected),model_id:mid(selected),progress }).eq('user_id',input.userId).eq('id',input.taskId)
      input.emit('status',{ status:'tool_call',progress,providerId:pid(selected),modelId:mid(selected) })
      try {
        const outcome = await prepareToolCall(input.userClient,input.userId,call,input.taskId,{ providerId:pid(selected),modelId:mid(selected) },input.adminClient,input.conversationId)
        if (outcome.kind === 'confirmation') {
          pendingAction = outcome.action
          input.emit('confirmation',{ action:outcome.action,providerId:pid(selected),modelId:mid(selected) })
          break
        }
        const content = jsonToolContent(outcome.result)
        toolCache.set(signature, content)
        agentMessages.push({ role:'tool',toolCallId:call.id,toolName:call.name,content })
      } catch (error) {
        const message = error instanceof ApiError ? error.message : 'Stracker could not validate that tool request. No data was changed.'
        const content = jsonToolContent({ error:message })
        toolCache.set(signature, content)
        agentMessages.push({ role:'tool',toolCallId:call.id,toolName:call.name,content })
      }
    }
    for (const call of skipped) {
      agentMessages.push({ role:'tool',toolCallId:call.id,toolName:call.name,content:jsonToolContent({ skipped:true, note:'Not run this turn. Answer from the tools that did run. Call this again only if it is essential.' }) })
    }
    lastProvider = selected
    if (pendingAction) {
      await input.adminClient.from('ai_tasks').update({ status:'waiting',progress:'Waiting for your confirmation.',provider_id:pid(selected),model_id:mid(selected) }).eq('user_id',input.userId).eq('id',input.taskId)
      return { status:'waiting',content:completion.text,providerId:pid(selected),modelId:mid(selected),fallbackFrom:fallbackFrom ? pid(fallbackFrom) : null,action:pendingAction }
    }
    await input.adminClient.from('ai_tasks').update({ status:'running',progress:'Reviewing your Stracker data…',provider_id:pid(selected),model_id:mid(selected) }).eq('user_id',input.userId).eq('id',input.taskId)
    input.emit('status',{ status:'running',progress:'Reviewing your Stracker data…',providerId:pid(selected),modelId:mid(selected) })
  }
  throw new ApiError(429,'tool_limit','Stracker AI could not finish that in one pass. Ask about one part, such as recent tests, weak chapters, or mistakes.')
}

export function labelProvider(id: string): string {
  const names: Record<AIProviderId,string> = { gemini:'Gemini',openai:'OpenAI',anthropic:'Claude',deepseek:'DeepSeek',qwen:'Qwen',custom:'Custom AI' }
  return names[id as AIProviderId] ?? 'AI Assistant'
}
