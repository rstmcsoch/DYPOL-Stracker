/**
 * The app's AI client against the website's SSE contract. `expo/fetch` is replaced with a scripted
 * response so the tests can split bytes at arbitrary points, including inside multi-byte UTF-8.
 */
import { fetch as expoFetch } from 'expo/fetch'
import { AIRequestError, parseSseBlock, streamChat, Utf8StreamDecoder, type SseEvent } from '../src/lib/ai/transport'

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }))

const mockFetch = expoFetch as unknown as jest.Mock

/** A minimal ReadableStream stand-in: delivers the given chunks in order, then closes. */
function streamOf(chunks: Uint8Array[]) {
  let index = 0
  return {
    getReader: () => ({
      read: async () => (index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined })
    })
  }
}

function splitEvery(bytes: Uint8Array, size: number): Uint8Array[] {
  const parts: Uint8Array[] = []
  for (let start = 0; start < bytes.length; start += size) parts.push(bytes.slice(start, start + size))
  return parts
}

const SIGNAL = new AbortController().signal

describe('AI chat streaming (SSE)', () => {
  beforeEach(() => mockFetch.mockReset())

  it('posts the chat request with the user token and delivers events in order across byte boundaries', async () => {
    const sse = [
      'event: status\ndata: {"phase":"thinking"}\n\n',
      'event: delta\ndata: {"text":"नमस्ते — Kirchhoff’s law 𝔘"}\n\n',
      'event: done\ndata: {"ok":true}\n\n'
    ].join('')
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: streamOf(splitEvery(Buffer.from(sse, 'utf8'), 7)) })

    const received: SseEvent[] = []
    const result = await streamChat({ conversationId: 'c1', message: 'hi' }, 'user-token', SIGNAL, event => received.push(event))

    expect(result).toEqual({ ok: true })
    expect(received.map(event => event.name)).toEqual(['status', 'delta', 'done'])
    expect(received[1]?.data).toEqual({ text: 'नमस्ते — Kirchhoff’s law 𝔘' })
    const [url, init] = mockFetch.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }]
    expect(url).toBe('https://dypol-stracker.vercel.app/api/ai/chat')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Accept: 'text/event-stream', Authorization: 'Bearer user-token' })
    expect(JSON.parse(init.body)).toEqual({ conversationId: 'c1', message: 'hi' })
  })

  it('reports the server message for an HTTP error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, text: async () => JSON.stringify({ message: 'Too many requests. Wait a minute.' }) })
    await expect(streamChat({}, 't', SIGNAL, () => undefined)).resolves.toEqual({ ok: false, status: 429, message: 'Too many requests. Wait a minute.' })
  })

  it('falls back to a status message when the error body is not JSON', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502, text: async () => '<html>bad gateway</html>' })
    const result = await streamChat({}, 't', SIGNAL, () => undefined)
    expect(result).toMatchObject({ ok: false, status: 502 })
    expect((result as { message: string }).message).toContain('HTTP 502')
  })

  it('maps an unreachable service to a network error the UI can explain', async () => {
    mockFetch.mockRejectedValue(new TypeError('Network request failed'))
    const attempt = streamChat({}, 't', SIGNAL, () => undefined)
    await expect(attempt).rejects.toBeInstanceOf(AIRequestError)
    await expect(attempt).rejects.toMatchObject({ code: 'network', status: 0 })
  })
})

describe('SSE parsing', () => {
  it('ignores malformed and non-object payloads and joins multi-line data', () => {
    expect(parseSseBlock('event: x\ndata: {bad')).toBeNull()
    expect(parseSseBlock('event: x\ndata: 42')).toBeNull()
    expect(parseSseBlock('event: x\ndata: null')).toBeNull()
    expect(parseSseBlock('event: x\ndata: {"a":\ndata: 1}')).toEqual({ name: 'x', data: { a: 1 } })
  })

  it('holds back an incomplete UTF-8 sequence until its remaining bytes arrive', () => {
    const euro = Buffer.from('€', 'utf8')
    const decoder = new Utf8StreamDecoder()
    expect(decoder.decode(euro.subarray(0, 1))).toBe('')
    expect(decoder.decode(euro.subarray(1, 2))).toBe('')
    expect(decoder.decode(euro.subarray(2))).toBe('€')
  })
})
