import type { AIProtocol, AIProviderId, ProviderConfigRow } from './registry.js'
import { endpointFor, providerBaseUrl, validateCustomBaseUrl } from './registry.js'
import { ApiError } from './http.js'
import { fetchCustomProvider } from './secure-fetch.js'

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: NormalizedToolCall[]
  toolCallId?: string
  toolName?: string
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
}

export class ProviderFailure extends Error {
  readonly status: number | null
  readonly health: string
  readonly retryable: boolean
  constructor(health: string, message: string, status: number | null = null, retryable = true) {
    super(message)
    this.name = 'ProviderFailure'
    this.health = health
    this.status = status
    this.retryable = retryable
  }
}

function failureForStatus(status: number): ProviderFailure {
  if (status === 401 || status === 403) return new ProviderFailure('authentication_failed', 'The provider rejected this API key.', status)
  if (status === 404) return new ProviderFailure('model_unavailable', 'The selected model is unavailable for this provider.', status)
  if (status === 429) return new ProviderFailure('rate_limited', 'The provider rate limit was reached.', status)
  if (status >= 500) return new ProviderFailure('provider_unavailable', 'The provider is temporarily unavailable.', status)
  if (status === 400 || status === 422) return new ProviderFailure('unsupported', 'The provider rejected a capability or request option for this model.', status)
  return new ProviderFailure('provider_unavailable', 'The provider could not complete this request.', status)
}

async function checkedFetch(url: string, init: RequestInit, custom = false): Promise<Response> {
  try {
    const response = custom ? await fetchCustomProvider(url,init) : await fetch(url,init)
    if (!response.ok) throw failureForStatus(response.status)
    if (!response.body) throw new ProviderFailure('provider_unavailable', 'The provider returned an empty response.')
    return response
  } catch (error) {
    if (error instanceof ProviderFailure) throw error
    if (init.signal?.aborted) throw error
    throw new ProviderFailure('timeout', 'The provider connection timed out or could not be reached.')
  }
}

function jsonHeaders(config: ProviderCall): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  if (config.protocol === 'google') headers['x-goog-api-key'] = config.apiKey
  else if (config.protocol === 'anthropic-compatible') {
    headers['x-api-key'] = config.apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers.Authorization = `Bearer ${config.apiKey}`
    if (config.organizationId) headers['OpenAI-Organization'] = config.organizationId
  }
  return headers
}

function parseArguments(value: string, id: string): unknown {
  if (!value.trim()) return {}
  try { return JSON.parse(value) as unknown }
  catch { throw new ProviderFailure('malformed_response', `The provider returned malformed tool arguments (${id}).`, null, false) }
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
  } catch (error) {
    if (error instanceof ProviderFailure) throw error
    throw error
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
  const base = config.providerId === 'custom'
    ? await validateCustomBaseUrl(config.baseUrl)
    : config.baseUrl
  const isReasoning = /^(o[1-9]|gpt-5|.*reasoner)/i.test(config.modelId)
  const body: Record<string, unknown> = {
    model: config.modelId,
    messages: [{ role: 'system', content: config.system }, ...openAITranscript(config.messages)],
    stream: true,
    ...(isReasoning ? { max_completion_tokens: config.maxOutputTokens ?? 1200 } : { max_tokens: config.maxOutputTokens ?? 1200 })
  }
  if (!isReasoning) body.temperature = 0.3
  if (config.tools.length) body.tools = config.tools.map(tool => ({
    type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema }
  }))
  if (config.tools.length) body.tool_choice = 'auto'
  const response = await checkedFetch(endpointFor(base, 'chat/completions'), {
    method: 'POST', headers: jsonHeaders(config), body: JSON.stringify(body), signal: config.signal
  },config.providerId === 'custom')
  let text = ''
  const calls = new Map<number, { id: string; name: string; arguments: string }>()
  await forEachSSE(response, (_event, data) => {
    if (data === '[DONE]') return
    let packet: Record<string, unknown>
    try { packet = JSON.parse(data) as Record<string, unknown> }
    catch { return }
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
    if (packet.error) throw new ProviderFailure('unsupported', 'The provider could not process this model request.')
  })
  const toolCalls = [...calls.values()].map((call, index) => ({
    id: call.id || `openai_${index}`,
    name: call.name,
    arguments: parseArguments(call.arguments, call.name || String(index))
  }))
  if (!text && !toolCalls.length) throw new ProviderFailure('malformed_response', 'The provider returned an empty answer.', null, false)
  return { text, toolCalls }
}

function anthropicTranscript(messages: AgentMessage[]): Array<Record<string, unknown>> {
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
      if (message.content) blocks.push({ type: 'text', text: message.content })
      for (const call of message.toolCalls) blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments ?? {} })
      output.push({ role: 'assistant', content: blocks })
    } else output.push({ role: message.role, content: message.content })
  }
  return output
}

async function callAnthropic(config: ProviderCall): Promise<ProviderCompletion> {
  const base = config.providerId === 'custom'
    ? await validateCustomBaseUrl(config.baseUrl)
    : config.baseUrl
  const url = endpointFor(base, 'messages')
  const body: Record<string, unknown> = {
    model: config.modelId,
    max_tokens: config.maxOutputTokens ?? 1200,
    system: config.system,
    messages: anthropicTranscript(config.messages),
    stream: true
  }
  if (config.tools.length) body.tools = config.tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }))
  const response = await checkedFetch(url,{ method:'POST',headers:jsonHeaders(config),body:JSON.stringify(body),signal:config.signal },config.providerId === 'custom')
  let text = ''
  const calls = new Map<string, { id: string; name: string; partial: string; input: unknown }>()
  await forEachSSE(response, (event, data) => {
    let packet: Record<string, unknown>
    try { packet = JSON.parse(data) as Record<string, unknown> }
    catch { return }
    if (event === 'content_block_start') {
      const block = packet.content_block as Record<string, unknown> | undefined
      if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        calls.set(block.id, { id: block.id, name: block.name, partial: '', input: block.input ?? {} })
      }
    } else if (event === 'content_block_delta') {
      const delta = packet.delta as Record<string, unknown> | undefined
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        text += delta.text
        config.onDelta(delta.text)
      } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const index = typeof packet.index === 'number' ? packet.index : undefined
        const call = [...calls.values()][index ?? calls.size - 1]
        if (call) call.partial += delta.partial_json
      }
    }
  })
  const toolCalls = [...calls.values()].map(call => ({
    id: call.id,
    name: call.name,
    arguments: call.partial ? parseArguments(call.partial, call.name) : call.input
  }))
  if (!text && !toolCalls.length) throw new ProviderFailure('malformed_response', 'The provider returned an empty answer.', null, false)
  return { text, toolCalls }
}

function googleTranscript(messages: AgentMessage[]): Array<Record<string, unknown>> {
  return messages.map(message => {
    if (message.role === 'tool') return {
      role: 'user',
      parts: [{ functionResponse: { name: message.toolName ?? 'tool', response: { result: safeJsonValue(message.content) } } }]
    }
    const parts: Record<string, unknown>[] = []
    if (message.content) parts.push({ text: message.content })
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) parts.push({ functionCall: { name: call.name, args: call.arguments ?? {} } })
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
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: config.system }] },
    contents: googleTranscript(config.messages),
    generationConfig: { maxOutputTokens: config.maxOutputTokens ?? 1200, temperature: 0.3 }
  }
  if (config.tools.length) {
    body.tools = [{ functionDeclarations: config.tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema })) }]
    body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } }
  }
  const response = await checkedFetch(`${base}/models/${model}:streamGenerateContent?alt=sse`, {
    method: 'POST', headers: jsonHeaders(config), body: JSON.stringify(body), signal: config.signal
  })
  let text = ''
  const calls = new Map<string, NormalizedToolCall>()
  let generatedIndex = 0
  await forEachSSE(response, (_event, data) => {
    let packet: Record<string, unknown>
    try { packet = JSON.parse(data) as Record<string, unknown> }
    catch { return }
    const candidates = Array.isArray(packet.candidates) ? packet.candidates as Record<string, unknown>[] : []
    const content = candidates[0]?.content as Record<string, unknown> | undefined
    const parts = Array.isArray(content?.parts) ? content.parts as Record<string, unknown>[] : []
    for (const part of parts) {
      if (typeof part.text === 'string') {
        text += part.text
        config.onDelta(part.text)
      }
      const fn = part.functionCall as Record<string, unknown> | undefined
      if (typeof fn?.name === 'string') {
        const key = `${fn.name}-${generatedIndex++}`
        calls.set(key, { id: key, name: fn.name, arguments: fn.args ?? {} })
      }
    }
  })
  const toolCalls = [...calls.values()]
  if (!text && !toolCalls.length) throw new ProviderFailure('malformed_response', 'The provider returned an empty answer.', null, false)
  return { text, toolCalls }
}

export async function completeWithProvider(config: ProviderCall): Promise<ProviderCompletion> {
  if (config.signal.aborted) throw config.signal.reason ?? new DOMException('Aborted', 'AbortError')
  if (config.protocol === 'google') return callGoogle(config)
  if (config.protocol === 'anthropic-compatible') return callAnthropic(config)
  return callOpenAICompatible(config)
}

export async function testProviderConnection(config: Omit<ProviderCall, 'system' | 'messages' | 'tools' | 'onDelta' | 'maxOutputTokens'>): Promise<void> {
  const result = await completeWithProvider({
    ...config,
    system: 'You are performing a short connectivity check. Reply with one brief word.',
    messages: [{ role: 'user', content: 'Reply: connected' }],
    tools: [],
    onDelta: () => undefined,
    maxOutputTokens: 24
  })
  if (!result.text.trim()) throw new ProviderFailure('malformed_response', 'The provider did not return a text response.', null, false)
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

export function safeProviderError(error: unknown): ProviderFailure {
  if (error instanceof ProviderFailure) return error
  if (error instanceof ApiError) return new ProviderFailure(error.code, error.message, error.status, false)
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new ProviderFailure('timeout', 'The provider took too long to respond.')
  }
  return new ProviderFailure('provider_unavailable', 'The provider could not be reached.')
}
