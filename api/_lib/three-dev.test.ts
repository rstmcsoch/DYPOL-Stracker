import { afterEach, describe, expect, it, vi } from 'vitest'
import { completeWithProvider, type ProviderCall } from './provider-adapters'
import { isThreeDevFailure, threeDevEnvironment, threeDevHeaders, threeDevProviderFor, threeDevRoute, threeDevSessionId, THREE_DEV_USE_CASE } from './three-dev'

const KEY = 'three-dev-test-key-not-real'
const trace = { sessionId: threeDevSessionId('3f1c2b7e-0000-4000-8000-000000000001'), tags: { 'model-source': 'own-model' } }
const controller = new AbortController()
const call = (partial: Partial<ProviderCall>): ProviderCall => ({
  providerId: 'openai', protocol: 'openai-compatible', modelId: 'gpt-4.1-mini', baseUrl: 'https://api.openai.com/v1', apiKey: 'provider-test-key',
  system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [], signal: controller.signal, onDelta: vi.fn(), maxOutputTokens: 64, trace, ...partial
})
const sse = (body: string, headers: Record<string, string> = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'x-three-request-id': 'req_1', ...headers } })
const OPENAI_OK = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"choices":[],"usage":{"total_tokens":3}}\n\ndata: [DONE]\n\n'
const GEMINI_TOOL = 'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_weak_areas","args":{"limit":3}}}]}}]}\n\n'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('three.dev routing decision', () => {
  it('routes only providers and hosts three.dev documents', () => {
    expect(threeDevProviderFor({ providerId: 'openai', protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', modelId: 'x' })).toBe('openai')
    expect(threeDevProviderFor({ providerId: 'anthropic', protocol: 'anthropic-compatible', baseUrl: 'https://api.anthropic.com/v1', modelId: 'x' })).toBe('anthropic')
    expect(threeDevProviderFor({ providerId: 'gemini', protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', modelId: 'x' })).toBe('gemini')
    expect(threeDevProviderFor({ providerId: 'deepseek', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com', modelId: 'x' })).toBeNull()
    expect(threeDevProviderFor({ providerId: 'qwen', protocol: 'openai-compatible', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', modelId: 'x' })).toBeNull()
    expect(threeDevProviderFor({ providerId: 'custom', protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', modelId: 'x' })).toBeNull()
    expect(threeDevProviderFor({ providerId: 'custom', protocol: 'openai-compatible', baseUrl: 'https://integrate.api.nvidia.com/v1', modelId: 'x' })).toBeNull()
    expect(threeDevProviderFor({ providerId: 'openai', protocol: 'openai-compatible', baseUrl: 'https://my-gateway.example.com/v1', modelId: 'x' })).toBeNull()
  })

  it('is off without the key or without a trace, and keeps path and query', () => {
    const input = { providerId: 'gemini' as const, protocol: 'google' as const, baseUrl: 'https://generativelanguage.googleapis.com/v1beta', modelId: 'gemini-2.5-flash' }
    const direct = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse'
    expect(threeDevRoute(input, direct, trace, {})).toBeNull()
    expect(threeDevRoute(input, direct, trace, { THREE_DEV_API_KEY: '  ' })).toBeNull()
    expect(threeDevRoute(input, direct, undefined, { THREE_DEV_API_KEY: KEY })).toBeNull()
    expect(threeDevRoute(input, direct, trace, { THREE_DEV_API_KEY: KEY })?.url).toBe('https://gate.three.dev/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse')
  })
})

describe('three.dev headers and tags', () => {
  it('builds use case, provider, environment, session and safe tags only', () => {
    const headers = threeDevHeaders(KEY, 'anthropic', { sessionId: 'abc123', tags: { 'task-type': 'analytics', 'Bad Key': 'x', note: 'has spaces in it', environment: 'spoof' } }, { VERCEL_ENV: 'preview' })
    expect(headers).toEqual({
      'X-Three-Api-Key': KEY, 'X-Three-Use-Case': THREE_DEV_USE_CASE, 'X-Three-AI-Provider': 'anthropic',
      'X-Three-Tag-Environment': 'preview', 'X-Three-Session-ID': 'abc123', 'X-Three-Tag-task-type': 'analytics'
    })
    expect(THREE_DEV_USE_CASE).toBe('stracker-ai-assistant')
  })

  it('derives the environment from VERCEL_ENV, then NODE_ENV, then local', () => {
    expect(threeDevEnvironment({ VERCEL_ENV: 'production', NODE_ENV: 'development' })).toBe('production')
    expect(threeDevEnvironment({ NODE_ENV: 'test' })).toBe('test')
    expect(threeDevEnvironment({})).toBe('local')
  })

  it('hashes the conversation id into a stable opaque session id', () => {
    const id = '3f1c2b7e-0000-4000-8000-000000000001'
    expect(threeDevSessionId(id)).toBe(threeDevSessionId(id))
    expect(threeDevSessionId(id)).toMatch(/^[0-9a-f]{32}$/)
    expect(threeDevSessionId(id)).not.toContain('3f1c2b7e')
  })

  it('tells three.dev failures from provider errors', () => {
    expect(isThreeDevFailure(new Response('', { status: 401, headers: { 'x-three-error-code': 'three_dev_api_key_invalid', 'x-three-request-id': 'r' } }))).toBe(true)
    expect(isThreeDevFailure(new Response('', { status: 503 }))).toBe(true)
    expect(isThreeDevFailure(new Response('', { status: 401, headers: { 'x-three-request-id': 'r' } }))).toBe(false)
    expect(isThreeDevFailure(new Response('', { status: 529, headers: { 'x-three-request-id': 'r' } }))).toBe(false)
    expect(isThreeDevFailure(new Response('', { status: 200 }))).toBe(false)
  })
})

describe('provider adapters with three.dev', () => {
  it('sends OpenAI through gate.three.dev with the provider key unchanged and usage requested', async () => {
    vi.stubEnv('THREE_DEV_API_KEY', KEY)
    vi.stubEnv('VERCEL_ENV', 'production')
    const fetchMock = vi.fn<typeof fetch>(async () => sse(OPENAI_OK))
    vi.stubGlobal('fetch', fetchMock)
    const result = await completeWithProvider(call({}))
    const [url, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(url).toBe('https://gate.three.dev/v1/chat/completions')
    expect(headers.get('authorization')).toBe('Bearer provider-test-key')
    expect(headers.get('x-three-api-key')).toBe(KEY)
    expect(headers.get('x-three-ai-provider')).toBe('openai')
    expect(headers.get('x-three-use-case')).toBe('stracker-ai-assistant')
    expect(headers.get('x-three-tag-environment')).toBe('production')
    expect(headers.get('x-three-session-id')).toBe(trace.sessionId)
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body.stream_options).toEqual({ include_usage: true })
    expect(body.model).toBe('gpt-4.1-mini')
    expect(result.text).toBe('ok')
  })

  it('sends Gemini native streamGenerateContent with tool calls through three.dev', async () => {
    vi.stubEnv('THREE_DEV_API_KEY', KEY)
    const fetchMock = vi.fn<typeof fetch>(async () => sse(GEMINI_TOOL))
    vi.stubGlobal('fetch', fetchMock)
    const result = await completeWithProvider(call({ providerId: 'gemini', protocol: 'google', modelId: 'gemini-2.5-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', tools: [{ name: 'get_weak_areas', description: 'd', inputSchema: { type: 'object' } }] }))
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://gate.three.dev/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse')
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('provider-test-key')
    expect(new Headers(init?.headers).get('x-three-ai-provider')).toBe('gemini')
    expect(result.toolCalls).toEqual([{ id: 'get_weak_areas-0', name: 'get_weak_areas', arguments: { limit: 3 } }])
  })

  it('sends Anthropic Messages through three.dev', async () => {
    vi.stubEnv('THREE_DEV_API_KEY', KEY)
    const fetchMock = vi.fn<typeof fetch>(async () => sse('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    await completeWithProvider(call({ providerId: 'anthropic', protocol: 'anthropic-compatible', modelId: 'claude-sonnet', baseUrl: 'https://api.anthropic.com/v1' }))
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://gate.three.dev/v1/messages')
    expect(new Headers(init?.headers).get('x-api-key')).toBe('provider-test-key')
    expect(new Headers(init?.headers).get('x-three-ai-provider')).toBe('anthropic')
  })

  it('keeps DeepSeek and Qwen direct even with the key set', async () => {
    vi.stubEnv('THREE_DEV_API_KEY', KEY)
    const fetchMock = vi.fn<typeof fetch>(async () => sse(OPENAI_OK))
    vi.stubGlobal('fetch', fetchMock)
    await completeWithProvider(call({ providerId: 'deepseek', modelId: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' }))
    await completeWithProvider(call({ providerId: 'qwen', modelId: 'qwen-plus', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' }))
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://api.deepseek.com/chat/completions', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'])
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get('x-three-api-key')).toBeNull()
      expect(JSON.parse(String(init?.body)).stream_options).toBeUndefined()
    }
  })

  it('is exactly the old direct call without the key', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => sse(OPENAI_OK))
    vi.stubGlobal('fetch', fetchMock)
    await completeWithProvider(call({}))
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect([...new Headers(init?.headers).keys()].some(name => name.startsWith('x-three'))).toBe(false)
    expect(JSON.parse(String(init?.body)).stream_options).toBeUndefined()
  })

  it('falls back to the direct provider once when three.dev rejects or cannot be reached', async () => {
    vi.stubEnv('THREE_DEV_API_KEY', KEY)
    const rejected = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"error":{"code":"three_dev_api_key_invalid"}}', { status: 401, headers: { 'x-three-error-code': 'three_dev_api_key_invalid', 'x-three-request-id': 'r' } }))
      .mockResolvedValueOnce(sse(OPENAI_OK))
    vi.stubGlobal('fetch', rejected)
    expect((await completeWithProvider(call({}))).text).toBe('ok')
    expect(rejected.mock.calls.map(([url]) => url)).toEqual(['https://gate.three.dev/v1/chat/completions', 'https://api.openai.com/v1/chat/completions'])
    expect(new Headers(rejected.mock.calls[1]![1]?.headers).get('x-three-api-key')).toBeNull()

    const unreachable = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(sse(OPENAI_OK))
    vi.stubGlobal('fetch', unreachable)
    expect((await completeWithProvider(call({}))).text).toBe('ok')
    expect(unreachable).toHaveBeenCalledTimes(2)
  })

  it('passes provider errors through without a direct retry', async () => {
    vi.stubEnv('THREE_DEV_API_KEY', KEY)
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"error":{"message":"bad key","type":"invalid_request_error","code":"invalid_api_key"}}', { status: 401, headers: { 'x-three-request-id': 'r' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(completeWithProvider(call({}))).rejects.toMatchObject({ aiCode: expect.any(String) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
