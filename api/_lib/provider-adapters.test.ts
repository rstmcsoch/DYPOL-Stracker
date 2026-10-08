import { afterEach,describe,expect,it,vi } from 'vitest'
import { completeWithProvider,type ProviderCall } from './provider-adapters'

const controller = new AbortController()
const baseConfig = (partial:Partial<ProviderCall>):ProviderCall => ({
  providerId:'openai',protocol:'openai-compatible',modelId:'gpt-4.1-mini',baseUrl:'https://api.openai.com/v1',apiKey:'sk-test-secret-12345678901234567890',
  system:'Use the Stracker tools where needed.',messages:[{role:'user',content:'What should I study next?'}],tools:[],signal:controller.signal,onDelta:vi.fn(),maxOutputTokens:240,...partial
})
const mockResponse = (body:string) => vi.fn<typeof fetch>(async () => new Response(body,{status:200,headers:{'content-type':'text/event-stream'}}))

afterEach(() => vi.unstubAllGlobals())

describe('provider protocol adapters',() => {
  it('streams OpenAI-compatible text and normalizes tool calls while keeping the key in a header',async () => {
    const fetchMock = mockResponse([
      'data: {"choices":[{"delta":{"content":"Here is a data-based suggestion."}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weak_areas","arguments":"{\\"limit\\":3}"}}]}}]}',
      'data: [DONE]',''
    ].join('\n\n'))
    vi.stubGlobal('fetch',fetchMock)
    const onDelta = vi.fn()
    const result = await completeWithProvider(baseConfig({onDelta,tools:[{name:'get_weak_areas',description:'Find weak areas',inputSchema:{type:'object'}}]}))
    const [url,init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer sk-test-secret-12345678901234567890')
    expect(String(url)).not.toContain('sk-test-secret')
    expect(result.text).toBe('Here is a data-based suggestion.')
    expect(result.toolCalls).toEqual([{id:'call_1',name:'get_weak_areas',arguments:{limit:3}}])
    expect(onDelta).toHaveBeenCalledWith('Here is a data-based suggestion.')
  })

  it('uses Anthropic-compatible headers and parses streamed text blocks',async () => {
    const fetchMock = mockResponse([
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Claude answer"}}',
      'event: message_stop\ndata: {"type":"message_stop"}',''
    ].join('\n\n'))
    vi.stubGlobal('fetch',fetchMock)
    const result = await completeWithProvider(baseConfig({providerId:'anthropic',protocol:'anthropic-compatible',modelId:'claude-sonnet',baseUrl:'https://api.anthropic.com/v1',apiKey:'anthropic-test-key'}))
    const [url,init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(new Headers(init?.headers).get('x-api-key')).toBe('anthropic-test-key')
    expect(new Headers(init?.headers).has('authorization')).toBe(false)
    expect(result.text).toBe('Claude answer')
  })

  it('sends Gemini keys as headers rather than query-string parameters',async () => {
    const fetchMock = mockResponse('data: {"candidates":[{"content":{"parts":[{"text":"Gemini answer"}]}}]}\n\n')
    vi.stubGlobal('fetch',fetchMock)
    const result = await completeWithProvider(baseConfig({providerId:'gemini',protocol:'google',modelId:'gemini-2.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta',apiKey:'AIza-test-secret'}))
    const [url,init] = fetchMock.mock.calls[0]!
    expect(String(url)).not.toContain('AIza-test-secret')
    expect(new URL(String(url)).searchParams.has('key')).toBe(false)
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('AIza-test-secret')
    expect(result.text).toBe('Gemini answer')
  })
})
