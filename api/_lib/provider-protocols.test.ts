import { afterEach, describe, expect, it, vi } from 'vitest'
import { completeWithProvider, type AgentMessage, type ProviderCall } from './provider-adapters'
import { AIError } from './ai-errors'

const controller = new AbortController()
const call = (partial: Partial<ProviderCall>): ProviderCall => ({
  providerId: 'openai', protocol: 'openai-compatible', modelId: 'gpt-6-luna', baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test-secret-12345678901234567890', system: 'system', messages: [{ role: 'user', content: 'hi' }],
  tools: [], signal: controller.signal, onDelta: vi.fn(), maxOutputTokens: 512, ...partial
})
const sse = (lines: string[]) => new Response(lines.join('\n\n') + '\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
const bodyOf = (mock: { mock: { calls: unknown[][] } }, index = 0) => JSON.parse(String((mock.mock.calls[index]![1] as RequestInit).body)) as Record<string, unknown>

afterEach(() => vi.unstubAllGlobals())

describe('OpenAI request shape', () => {
  it('uses max_completion_tokens and omits temperature for GPT-6 reasoning models', async () => {
    const fetchMock = vi.fn(async () => sse(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']))
    vi.stubGlobal('fetch', fetchMock)
    await completeWithProvider(call({}))
    const sent = bodyOf(fetchMock)
    expect(sent.max_completion_tokens).toBe(512)
    expect(sent).not.toHaveProperty('max_tokens')
    expect(sent).not.toHaveProperty('temperature')
  })

  it('keeps max_tokens and temperature for non-reasoning OpenAI-compatible models', async () => {
    const fetchMock = vi.fn(async () => sse(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']))
    vi.stubGlobal('fetch', fetchMock)
    await completeWithProvider(call({ providerId: 'qwen', modelId: 'qwen-plus', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' }))
    const sent = bodyOf(fetchMock)
    expect(sent.max_tokens).toBe(512)
    expect(sent.temperature).toBe(0.3)
  })
})

describe('DeepSeek thinking mode', () => {
  it('disables thinking so tool loops never need reasoning_content passed back', async () => {
    const fetchMock = vi.fn(async () => sse(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']))
    vi.stubGlobal('fetch', fetchMock)
    await completeWithProvider(call({ providerId: 'deepseek', modelId: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' }))
    expect(bodyOf(fetchMock).thinking).toEqual({ type: 'disabled' })
  })
})

describe('Anthropic streaming tool use', () => {
  it('attaches streamed tool input to the tool_use block even when a text block comes first', async () => {
    const fetchMock = vi.fn(async () => sse([
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Checking."}}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weak_areas","input":{}}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"limit\\":"}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"3}"}}',
      'event: message_stop\ndata: {"type":"message_stop"}'
    ]))
    vi.stubGlobal('fetch', fetchMock)
    const result = await completeWithProvider(call({ providerId: 'anthropic', protocol: 'anthropic-compatible', modelId: 'claude-haiku-5-5', baseUrl: 'https://api.anthropic.com/v1' }))
    expect(result.text).toBe('Checking.')
    expect(result.toolCalls).toEqual([{ id: 'toolu_1', name: 'get_weak_areas', arguments: { limit: 3 } }])
  })

  it('returns thinking blocks with their signatures so the next tool-loop turn can include them unchanged', async () => {
    const fetchMock = vi.fn(async () => sse([
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Plan."}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-abc"}}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_2","name":"get_weak_areas","input":{}}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}',
      'event: message_stop\ndata: {"type":"message_stop"}'
    ]))
    vi.stubGlobal('fetch', fetchMock)
    const first = await completeWithProvider(call({ providerId: 'anthropic', protocol: 'anthropic-compatible', modelId: 'claude-opus-5-5', baseUrl: 'https://api.anthropic.com/v1' }))
    const messages: AgentMessage[] = [
      { role: 'user', content: 'Where am I weak?' },
      { role: 'assistant', content: '', toolCalls: first.toolCalls, providerData: first.providerData },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'toolu_2', toolName: 'get_weak_areas' }
    ]
    const second = vi.fn(async () => sse(['event: message_stop\ndata: {"type":"message_stop"}', '']))
    vi.stubGlobal('fetch', second)
    // The stub returns no text, so the adapter reports an empty answer; the request body is what matters here.
    await expect(completeWithProvider(call({ providerId: 'anthropic', protocol: 'anthropic-compatible', modelId: 'claude-opus-5-5', baseUrl: 'https://api.anthropic.com/v1', messages }))).rejects.toBeInstanceOf(AIError)
    expect(second).toHaveBeenCalledTimes(1)
    const sent = bodyOf(second)
    const assistant = (sent.messages as Array<{ role: string; content: unknown }>)[1]!
    expect(assistant.content).toEqual([
      { type: 'thinking', thinking: 'Plan.', signature: 'sig-abc' },
      { type: 'tool_use', id: 'toolu_2', name: 'get_weak_areas', input: {} }
    ])
  })
})

describe('Gemini requests', () => {
  it('keeps the default temperature for Gemini 3 and never places the key in the URL', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => sse(['data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}', '']))
    vi.stubGlobal('fetch', fetchMock)
    await completeWithProvider(call({ providerId: 'gemini', protocol: 'google', modelId: 'gemini-3.7-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'AIza-test-secret' }))
    const url = String(fetchMock.mock.calls[0]?.[0])
    expect(url).not.toContain('AIza-test-secret')
    const sent = bodyOf(fetchMock) as { generationConfig: Record<string, unknown> }
    expect(sent.generationConfig).not.toHaveProperty('temperature')
  })

  it('returns Gemini thought signatures on function calls so the next turn can send them back', async () => {
    const fetchMock = vi.fn(async () => sse([
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_weak_areas","args":{"limit":2}},"thoughtSignature":"sig-g"}]}}]}', ''
    ]))
    vi.stubGlobal('fetch', fetchMock)
    const first = await completeWithProvider(call({ providerId: 'gemini', protocol: 'google', modelId: 'gemini-3.7-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'AIza-x', tools: [{ name: 'get_weak_areas', description: 'd', inputSchema: { type: 'object' } }] }))
    expect(first.toolCalls[0]).toMatchObject({ name: 'get_weak_areas', arguments: { limit: 2 } })
    const messages: AgentMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', toolCalls: first.toolCalls, providerData: first.providerData },
      { role: 'tool', content: '{"ok":true}', toolCallId: first.toolCalls[0]!.id, toolName: 'get_weak_areas' }
    ]
    const second = vi.fn(async () => sse(['data: {"candidates":[{"content":{"parts":[{"text":"done"}]}}]}', '']))
    vi.stubGlobal('fetch', second)
    await completeWithProvider(call({ providerId: 'gemini', protocol: 'google', modelId: 'gemini-3.7-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'AIza-x', messages }))
    const sent = bodyOf(second) as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> }
    expect(sent.contents[1]!.parts).toEqual([{ functionCall: { name: 'get_weak_areas', args: { limit: 2 } }, thoughtSignature: 'sig-g' }])
  })
})

describe('provider stream failures', () => {
  it('turns an error packet inside a successful stream into a normalized AIError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse(['data: {"error":{"code":"insufficient_quota","message":"quota exhausted"}}', ''])))
    const error = await completeWithProvider(call({})).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AIError)
    expect((error as AIError).aiCode).toBe('INSUFFICIENT_BALANCE')
  })

  it('treats an empty completed answer as malformed rather than as success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse(['data: [DONE]', ''])))
    const error = await completeWithProvider(call({})).catch((caught: unknown) => caught)
    expect((error as AIError).aiCode).toBe('MALFORMED_RESPONSE')
  })
})
