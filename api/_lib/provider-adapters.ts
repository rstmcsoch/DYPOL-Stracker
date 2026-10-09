import type { AIProtocol, AIProviderId, ProviderConfigRow } from './registry.js'
import { endpointFor, providerBaseUrl, validateCustomBaseUrl } from './registry.js'
import { stripControlChars } from '../../src/lib/control-chars.js'
import { fetchCustomProvider } from './secure-fetch.js'
import {
  AIError, normalizeHttpProviderError, normalizeUnknownError, parseProviderErrorBody, safeProviderText
} from './ai-errors.js'

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: NormalizedToolCall[]
  toolCallId?: string
  toolName?: string
  /**
   * Opaque, in-request provider state that must be returned unchanged on the next turn of a
   * tool loop (Claude thinking blocks, Gemini thought signatures). Never persisted or shown.
   */
  providerData?: ProviderTurnData
}

export interface ProviderTurnData {
  providerId: AIProviderId
  anthropicBlocks?: Array<Record<string, unknown>>
  googleParts?: Array<Record<string, unknown>>
}

export interface NormalizedToolCall {
  id: string
  name: string
  arguments: unknown
}

export interface ModelTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ProviderCall {
  providerId: AIProviderId
  protocol: AIProtocol
  modelId: string
  baseUrl: string
  apiKey: string
  organizationId?: string | null
  system: string
  messages: AgentMessage[]
  tools: ModelTool[]
  signal: AbortSignal
  onDelta: (text: string) => void
  maxOutputTokens?: number
}

export interface ProviderCompletion {
  text: string
  toolCalls: NormalizedToolCall[]
  providerData?: ProviderTurnData
}

const MAX_ERROR_BODY_CHARS = 8_000

/** Reasoning-family OpenAI models: they require max_completion_tokens and reject non-default temperature. */
export function isOpenAIReasoningModel(modelId: string): boolean {
  return /^(o\d|gpt-5|gpt-6)/i.test(modelId)
}

/** Gemini 3 models expect the default temperature; lowering it can cause repetitive tool loops. */
function isGemini3(modelId: string): boolean {
  return /^gemini-3/i.test(modelId)
}

async function readErrorBody(response: Response): Promise<string> {
  try { return (await response.text()).slice(0, MAX_ERROR_BODY_CHARS) } catch { return '' }
}

async function checkedFetch(config: Pick<ProviderCall, 'providerId' | 'modelId' | 'signal'>, url: string, init: RequestInit, custom = false): Promise<Response> {
  let response: Response
  try {
    response = custom ? await fetchCustomProvider(url, init) : await fetch(url, { ...init, redirect: 'error' })
  } catch (error) {
    if (init.signal?.aborted) throw error
    throw normalizeUnknownError(error, { provider: config.providerId, model: config.modelId })
  }
  if (!response.ok) {
    const body = await readErrorBody(response)
    throw normalizeHttpProviderError(config.providerId, config.modelId, response.status, body)
  }
  if (!response.body) throw new AIError('MALFORMED_RESPONSE', { provider: config.providerId, model: config.modelId, providerMessage: 'empty response body' })
  return response
}

function jsonHeaders(config: ProviderCall): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  if (config.protocol === 'google') headers['x-goog-api-key'] = config.apiKey
  else if (config.protocol === 'anthropic-compatible') {
    headers['x-api-key'] = config.apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers.Authorization = `Bearer ${config.apiKey}`
    if (config.organizationId) {
      const organization = stripControlChars(config.organizationId).trim()
      if (organization) headers['OpenAI-Organization'] = organization
    }
  }
  return headers
}

function parseArguments(value: string, config: ProviderCall): unknown {
  if (!value.trim()) return {}
  try { return JSON.parse(value) as unknown }
  catch { throw new AIError('MALFORMED_RESPONSE', { provider: config.providerId, model: config.modelId, providerMessage: 'malformed tool arguments' }) }
}

/** Fail a stream whose SSE packet carries an error object (no HTTP status is available at that point). */
function streamFailure(config: ProviderCall, packet: unknown): AIError {
  const errorText = JSON.stringify(packet).slice(0, MAX_ERROR_BODY_CHARS)
  const parsed = parseProviderErrorBody(errorText)
  const type = `${parsed.code ?? ''}`
  const status = /overload|unavailable|server/i.test(type) ? 529 : /auth/i.test(type) ? 401 : /rate/i.test(type) ? 429 : 400
  return normalizeHttpProviderError(config.providerId, config.modelId, status, errorText)
}

async function forEachSSE(response: Response, onEvent: (eventName: string, data: string) => void): Promise<void> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = 'message'
  let dataLines: string[] = []
  const dispatch = () => {
    if (dataLines.length) onEvent(eventName, dataLines.join('\n'))
    eventName = 'message'
    dataLines = []
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        let line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (line === '') dispatch()
        else if (!line.startsWith(':')) {
          const separator = line.indexOf(':')
          const field = separator < 0 ? line : line.slice(0, separator)
          const content = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '')
          if (field === 'event') eventName = content
          if (field === 'data') dataLines.push(content)
        }
        newline = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) {
        if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
        else if (line.startsWith('event:')) eventName = line.slice(6).trim()
      }
    }
    dispatch()
  } finally {
    try { reader.releaseLock() } catch { /* stream may already be closed */ }
  }
}

function openAITranscript(messages: AgentMessage[]): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = []
  for (const message of messages) {
    if (message.role === 'tool') {
      output.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content })
    } else if (message.role === 'assistant' && message.toolCalls?.length) {
      output.push({
        role: 'assistant', content: message.content || null,
        tool_calls: message.toolCalls.map(call => ({
          id: call.id, type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) }
        }))
      })
    } else output.push({ role: message.role, content: message.content })
  }
  return output
}

async function callOpenAICompatible(config: ProviderCall): Promise<ProviderCompletion> {
  const base = config.providerId === 'custom' ? await validateCustomBaseUrl(config.baseUrl) : config.baseUrl
  const reasoning = isOpenAIReasoningModel(config.modelId)
  const maxTokens = config.maxOutputTokens ?? 1200
  const body: Record<string, unknown> = {
    model: config.modelId,
    messages: [{ role: 'system', content: config.system }, ...openAITranscript(config.messages)],
    stream: true,
    // OpenAI's current chat API uses max_completion_tokens; max_tokens is rejected by reasoning models.
    ...(config.providerId === 'openai' || reasoning ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens })
  }
  if (!reasoning) body.temperature = 0.3
  // DeepSeek thinking mode requires reasoning_content to be echoed back on every later turn when
  // tools are present. Stracker's tool loop does not carry it, so the documented switch-off is used.
  if (config.providerId === 'deepseek') body.thinking = { type: 'disabled' }
  if (config.tools.length) {
    body.tools = config.tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }))
    body.tool_choice = 'auto'
  }
  const response = await checkedFetch(config, endpointFor(base, 'chat/completions'), {
    method: 'POST', headers: jsonHeaders(config), body: JSON.stringify(body), signal: config.signal
  }, config.providerId === 'custom')
  let text = ''
  const calls = new Map<number, { id: string; name: string; arguments: string }>()
  await forEachSSE(response, (_event, data) => {
    if (data === '[DONE]') return
    let packet: Record<string, unknown>
    try { packet = JSON.parse(data) as Record<string, unknown> } catch { return }
    if (packet.error) throw streamFailure(config, packet)
    const choices = Array.isArray(packet.choices) ? packet.choices : []
    const choice = choices[0] as Record<string, unknown> | undefined
    const delta = choice?.delta as Record<string, unknown> | undefined
    if (typeof delta?.content === 'string' && delta.content) {
      text += delta.content
      config.onDelta(delta.content)
    }
    const toolDeltas = Array.isArray(delta?.tool_calls) ? delta.tool_calls as Record<string, unknown>[] : []
    for (const item of toolDeltas) {
      const index = typeof item.index === 'number' ? item.index : 0
      const current = calls.get(index) ?? { id: '', name: '', arguments: '' }
      if (typeof item.id === 'string') current.id += item.id
      const fn = item.function as Record<string, unknown> | undefined
      if (typeof fn?.name === 'string') current.name += fn.name
      if (typeof fn?.arguments === 'string') current.arguments += fn.arguments
      calls.set(index, current)
    }
  })
  const toolCalls = [...calls.values()].map((call, index) => ({
    id: call.id || `openai_${index}`,
    name: call.name,
    arguments: parseArguments(call.arguments, config)
  }))
  if (!text && !toolCalls.length) throw new AIError('MALFORMED_RESPONSE', { provider: config.providerId, model: config.modelId, providerMessage: 'empty answer' })
  return { text, toolCalls }
}

function anthropicTranscript(messages: AgentMessage[], providerId: AIProviderId): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    if (message.role === 'tool') {
      const results: Record<string, unknown>[] = []
      while (index < messages.length && messages[index]?.role === 'tool') {
        const tool = messages[index++]!
        results.push({ type: 'tool_result', tool_use_id: tool.toolCallId, content: tool.content })
      }
      index -= 1
      output.push({ role: 'user', content: results })
    } else if (message.role === 'assistant' && message.toolCalls?.length) {
      const blocks: Record<string, unknown>[] = []
      // Claude's thinking blocks (with signatures) must be returned unchanged before tool_use blocks.
      if (message.providerData?.providerId === providerId && message.providerData.anthropicBlocks) blocks.push(...message.providerData.anthropicBlocks)
      if (message.content) blocks.push({ type: 'text', text: message.content })
      for (const call of message.toolCalls) blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments ?? {} })
      output.push({ role: 'assistant', content: blocks })
    } else output.push({ role: message.role, content: message.content })
  }
  return output
}

async function callAnthropic(config: ProviderCall): Promise<ProviderCompletion> {
  const base = config.providerId === 'custom' ? await validateCustomBaseUrl(config.baseUrl) : config.baseUrl
  const url = endpointFor(base, 'messages')
  const body: Record<string, unknown> = {
    model: config.modelId,
    max_tokens: config.maxOutputTokens ?? 1200,
    system: config.system,
    messages: anthropicTranscript(config.messages, config.providerId),
    stream: true
  }
  if (config.tools.length) body.tools = config.tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }))
  const response = await checkedFetch(config, url, { method: 'POST', headers: jsonHeaders(config), body: JSON.stringify(body), signal: config.signal }, config.providerId === 'custom')

  // Track every content block by its stream index so input_json_delta reaches the right tool_use block.
  type Block = { kind: 'text' | 'tool' | 'thinking' | 'other'; raw: Record<string, unknown>; text: string; partial: string; id?: string; name?: string; signature?: string }
  const blocks = new Map<number, Block>()
  let text = ''
  await forEachSSE(response, (event, data) => {
    let packet: Record<string, unknown>
    try { packet = JSON.parse(data) as Record<string, unknown> } catch { return }
    if (event === 'error' || packet.type === 'error') throw streamFailure(config, packet)
    const index = typeof packet.index === 'number' ? packet.index : -1
    if (event === 'content_block_start') {
      const block = (packet.content_block ?? {}) as Record<string, unknown>
      if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        blocks.set(index, { kind: 'tool', raw: block, text: '', partial: '', id: block.id, name: block.name })
      } else if (block.type === 'text') {
        blocks.set(index, { kind: 'text', raw: block, text: typeof block.text === 'string' ? block.text : '', partial: '' })
      } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        blocks.set(index, { kind: 'thinking', raw: { ...block }, text: '', partial: '' })
      } else {
        blocks.set(index, { kind: 'other', raw: block, text: '', partial: '' })
      }
    } else if (event === 'content_block_delta') {
      const delta = packet.delta as Record<string, unknown> | undefined
      const block = blocks.get(index)
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        text += delta.text
        if (block) block.text += delta.text
        config.onDelta(delta.text)
      } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string' && block?.kind === 'tool') {
        block.partial += delta.partial_json
      } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string' && block) {
        block.text += delta.thinking
      } else if (delta?.type === 'signature_delta' && typeof delta.signature === 'string' && block) {
        block.signature = (block.signature ?? '') + delta.signature
      }
    }
  })
  const ordered = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block)
  const toolCalls: NormalizedToolCall[] = ordered
    .filter(block => block.kind === 'tool')
    .map(block => ({
      id: block.id!, name: block.name!,
      arguments: block.partial ? parseArguments(block.partial, config) : (block.raw.input ?? {})
    }))
  const thinkingBlocks = ordered
    .filter(block => block.kind === 'thinking')
    .map(block => block.raw.type === 'redacted_thinking'
      ? block.raw
      : { type: 'thinking', thinking: block.text, signature: block.signature ?? '' })
  if (!text && !toolCalls.length) throw new AIError('MALFORMED_RESPONSE', { provider: config.providerId, model: config.modelId, providerMessage: 'empty answer' })
  return {
    text,
    toolCalls,
    providerData: thinkingBlocks.length ? { providerId: config.providerId, anthropicBlocks: thinkingBlocks as Array<Record<string, unknown>> } : undefined
  }
}

function googleTranscript(messages: AgentMessage[], providerId: AIProviderId): Array<Record<string, unknown>> {
  return messages.map(message => {
    if (message.role === 'tool') return {
      role: 'user',
      parts: [{ functionResponse: { name: message.toolName ?? 'tool', response: { result: safeJsonValue(message.content) } } }]
    }
    const parts: Record<string, unknown>[] = []
    const stored = message.role === 'assistant' && message.providerData?.providerId === providerId ? message.providerData.googleParts : undefined
    if (stored?.length) {
      // Gemini 3 function calls carry thought signatures that must be returned exactly as received.
      parts.push(...stored)
    } else {
      if (message.content) parts.push({ text: message.content })
      if (message.role === 'assistant') {
        for (const call of message.toolCalls ?? []) parts.push({ functionCall: { name: call.name, args: call.arguments ?? {} } })
      }
    }
    return { role: message.role === 'assistant' ? 'model' : 'user', parts: parts.length ? parts : [{ text: 'Continue.' }] }
  })
}

function safeJsonValue(value: string): unknown {
  try { return JSON.parse(value) as unknown } catch { return { result: value.slice(0, 12_000) } }
}

async function callGoogle(config: ProviderCall): Promise<ProviderCompletion> {
  const model = encodeURIComponent(config.modelId)
  const base = 'https://generativelanguage.googleapis.com/v1beta'
  const generationConfig: Record<string, unknown> = { maxOutputTokens: config.maxOutputTokens ?? 1200 }
  if (!isGemini3(config.modelId)) generationConfig.temperature = 0.3
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: config.system }] },
    contents: googleTranscript(config.messages, config.providerId),
    generationConfig
  }
  if (config.tools.length) {
    body.tools = [{ functionDeclarations: config.tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema })) }]
    body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } }
  }
  const response = await checkedFetch(config, `${base}/models/${model}:streamGenerateContent?alt=sse`, {
    method: 'POST', headers: jsonHeaders(config), body: JSON.stringify(body), signal: config.signal
  })
  let text = ''
  const toolCalls: NormalizedToolCall[] = []
  const rawParts: Record<string, unknown>[] = []
  await forEachSSE(response, (_event, data) => {
    let packet: Record<string, unknown>
    try { packet = JSON.parse(data) as Record<string, unknown> } catch { return }
    if (packet.error) throw streamFailure(config, packet)
    const candidates = Array.isArray(packet.candidates) ? packet.candidates as Record<string, unknown>[] : []
    const content = candidates[0]?.content as Record<string, unknown> | undefined
    const parts = Array.isArray(content?.parts) ? content.parts as Record<string, unknown>[] : []
    for (const part of parts) {
      rawParts.push(part)
      if (typeof part.text === 'string' && !part.thought) {
        text += part.text
        config.onDelta(part.text)
      }
      const fn = part.functionCall as Record<string, unknown> | undefined
      if (typeof fn?.name === 'string') {
        const id = `${fn.name}-${toolCalls.length}`
        toolCalls.push({ id, name: fn.name, arguments: fn.args ?? {} })
      }
    }
  })
  if (!text && !toolCalls.length) throw new AIError('MALFORMED_RESPONSE', { provider: config.providerId, model: config.modelId, providerMessage: 'empty answer' })
  // Keep the exact parts (including thought signatures) only when a tool call must be continued.
  const googleParts = toolCalls.length ? rawParts.filter(part => !part.thought) : undefined
  return { text, toolCalls, providerData: googleParts?.length ? { providerId: config.providerId, googleParts } : undefined }
}

export async function completeWithProvider(config: ProviderCall): Promise<ProviderCompletion> {
  if (config.signal.aborted) throw config.signal.reason ?? new DOMException('Aborted', 'AbortError')
  if (config.protocol === 'google') return callGoogle(config)
  if (config.protocol === 'anthropic-compatible') return callAnthropic(config)
  return callOpenAICompatible(config)
}

/**
 * A real, minimal request to the selected model. A completed streamed response without a provider
 * error proves the key, endpoint, model, and protocol are usable. The budget is deliberately larger
 * than a bare "ok" because thinking-enabled models spend output tokens on reasoning first.
 */
export async function testProviderConnection(config: Omit<ProviderCall, 'system' | 'messages' | 'tools' | 'onDelta' | 'maxOutputTokens'>): Promise<{ replied: boolean }> {
  const result = await completeWithProvider({
    ...config,
    system: 'You are performing a short connectivity check. Reply with one brief word.',
    messages: [{ role: 'user', content: 'Reply with the word: connected' }],
    tools: [],
    onDelta: () => undefined,
    maxOutputTokens: 512
  })
  return { replied: Boolean(result.text.trim()) }
}

export function providerCallFromConfig(
  config: ProviderConfigRow,
  apiKey: string,
  system: string,
  messages: AgentMessage[],
  tools: ModelTool[],
  signal: AbortSignal,
  onDelta: (text: string) => void,
  maxOutputTokens = 1200
): ProviderCall {
  const base = providerBaseUrl({ providerId: config.provider_id, baseUrl: config.base_url, region: config.provider_config?.region === 'china' ? 'china' : 'international' })
  return {
    providerId: config.provider_id, protocol: config.protocol, modelId: config.model_id,
    baseUrl: base, apiKey, organizationId: config.organization_id,
    system, messages, tools, signal, onDelta, maxOutputTokens
  }
}

/** Normalize any failure into an AIError. Safe to call on values that were never produced by this module. */
export function safeProviderError(error: unknown, context: { provider?: string | null; model?: string | null } = {}): AIError {
  if (error instanceof AIError) return error
  return normalizeUnknownError(error, context)
}

export { safeProviderText }
