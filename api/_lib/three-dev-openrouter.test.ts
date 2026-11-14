import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '104.18.2.115', family: 4 }]) }))
const customFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
vi.mock('./secure-fetch.js', () => ({ fetchCustomProvider: (url: string, init: RequestInit) => customFetch(url, init) }))

const { completeWithProvider } = await import('./provider-adapters')
const { threeDevProviderFor, threeDevRoute } = await import('./three-dev')
type Call = Parameters<typeof completeWithProvider>[0]

const KEY = 'three-dev-test-key-not-real'
const trace = { sessionId: 'abc123', tags: { 'model-source': 'stracker-default' } }
const OK = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"choices":[],"usage":{"total_tokens":3}}\n\ndata: [DONE]\n\n'
const sse = () => new Response(OK, { status: 200, headers: { 'content-type': 'text/event-stream', 'x-three-request-id': 'r' } })
const call = (partial: Partial<Call> = {}): Call => ({
  providerId: 'custom', protocol: 'openai-compatible', modelId: 'nemotron-3-ultra-550b-a55b:free', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'provider-test-key',
  system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [], signal: new AbortController().signal, onDelta: vi.fn(), maxOutputTokens: 64, trace, ...partial
})

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); customFetch.mockReset() })

describe('three.dev OpenRouter routing (custom endpoint on openrouter.ai)', () => {
  it('recognises only the exact OpenRouter API base', () => {
    const base = { providerId: 'custom' as const, protocol: 'openai-compatible' as const, modelId: 'x' }
    expect(threeDevProviderFor({ ...base, baseUrl: 'https://openrouter.ai/api/v1' })).toBe('openrouter')
    expect(threeDevProviderFor({ ...base, baseUrl: 'https://openrouter.ai/api/v1/' })).toBe('openrouter')
    expect(threeDevProviderFor({ ...base, baseUrl: 'https://openrouter.ai.evil.example/api/v1' })).toBeNull()
    expect(threeDevProviderFor({ ...base, baseUrl: 'https://integrate.api.nvidia.com/v1' })).toBeNull()
    expect(threeDevProviderFor({ ...base, protocol: 'anthropic-compatible', baseUrl: 'https://openrouter.ai/api/v1' })).toBeNull()
  })

  it('maps /api/v1 to the proxy path /v1', () => {
    const route = threeDevRoute({ providerId: 'custom', protocol: 'openai-compatible', modelId: 'x', baseUrl: 'https://openrouter.ai/api/v1' }, 'https://openrouter.ai/api/v1/chat/completions', trace, { THREE_DEV_API_KEY: KEY })
    expect(route?.url).toBe('https://gate.three.dev/v1/chat/completions')
    expect(route?.provider).toBe('openrouter')
  })

  it('sends the admin OpenRouter model through three.dev with its key unchanged and usage requested', async () => {
    vi.stubEnv('THREE_DEV_API_KEY', KEY)
    const fetchMock = vi.fn<typeof fetch>(async () => sse())
    vi.stubGlobal('fetch', fetchMock)
    const result = await completeWithProvider(call())
    const [url, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(url).toBe('https://gate.three.dev/v1/chat/completions')
    expect(headers.get('authorization')).toBe('Bearer provider-test-key')
    expect(headers.get('x-three-ai-provider')).toBe('openrouter')
    expect(headers.get('x-three-use-case')).toBe('stracker-ai-assistant')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body.model).toBe('nemotron-3-ultra-550b-a55b:free')
    expect(body.stream_options).toEqual({ include_usage: true })
    expect(customFetch).not.toHaveBeenCalled()
    expect(result.text).toBe('ok')
  })

  it('falls back to the pinned custom fetch when three.dev fails', async () => {
    vi.stubEnv('THREE_DEV_API_KEY', KEY)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('', { status: 401, headers: { 'x-three-error-code': 'three_dev_api_key_invalid' } })))
    customFetch.mockResolvedValueOnce(sse())
    expect((await completeWithProvider(call())).text).toBe('ok')
    expect(customFetch.mock.calls[0]![0]).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(new Headers(customFetch.mock.calls[0]![1].headers).get('x-three-api-key')).toBeNull()
  })

  it('without the key, or for NVIDIA, uses the pinned custom fetch exactly as before', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    customFetch.mockImplementation(async () => sse())
    await completeWithProvider(call())
    vi.stubEnv('THREE_DEV_API_KEY', KEY)
    await completeWithProvider(call({ baseUrl: 'https://integrate.api.nvidia.com/v1', modelId: 'openai/gpt-oss-20b' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(customFetch.mock.calls.map(([url]) => url)).toEqual(['https://openrouter.ai/api/v1/chat/completions', 'https://integrate.api.nvidia.com/v1/chat/completions'])
    for (const [, init] of customFetch.mock.calls) {
      expect(new Headers(init.headers).get('x-three-api-key')).toBeNull()
      expect(JSON.parse(String(init.body)).stream_options).toBeUndefined()
    }
  })
})
