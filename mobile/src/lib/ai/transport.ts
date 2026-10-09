/**
 * Client for the authenticated Vercel `/api/ai/*` routes that the website also uses. The app holds no
 * provider keys or service credentials. Each request carries the signed-in user's Supabase access token,
 * and the server performs every provider call, key lookup, and database write.
 */
import { fetch as expoFetch } from 'expo/fetch'
import { API_BASE_URL } from '../config'

export class AIRequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number, readonly reference?: string) {
    super(message)
    this.name = 'AIRequestError'
  }
}

interface APIErrorPayload { error?: string; message?: string; reference?: string }

export function aiUrl(path: string): string {
  return `${API_BASE_URL}${path}`
}

/** JSON request with the website's error mapping: non-JSON bodies and HTTP errors are reported distinctly. */
export async function apiJson<T>(path: string, init: { method?: string; body?: unknown; token: string }): Promise<T> {
  let response: Response
  try {
    response = await fetch(aiUrl(path), {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${init.token}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    })
  } catch {
    throw new AIRequestError('The Stracker AI service could not be reached. Check your connection and try again.', 'network', 0)
  }
  const text = await response.text().catch(() => '')
  let payload: (T & APIErrorPayload) | null = null
  try { payload = text ? JSON.parse(text) as T & APIErrorPayload : null } catch { payload = null }
  const reference = payload && typeof payload.reference === 'string' ? payload.reference : undefined
  if (!payload || typeof payload !== 'object') {
    throw new AIRequestError(`Stracker's AI service returned an unexpected response (HTTP ${response.status}). Check that the /api routes are deployed, then try again.`, 'non_json_response', response.status)
  }
  if (!response.ok) {
    const base = typeof payload.message === 'string' ? payload.message : `Stracker could not complete that AI request (HTTP ${response.status}). Try again.`
    throw new AIRequestError(reference ? `${base} Reference: ${reference}` : base, typeof payload.error === 'string' ? payload.error : 'request_failed', response.status, reference)
  }
  return payload as T
}

/** Public, unauthenticated health check. It reports booleans and missing variable names only, never secrets. */
export async function fetchBackendHealth(): Promise<{ configured: boolean; reason?: string | null; missing?: string[]; invalid?: string[] } | null> {
  try {
    const response = await fetch(aiUrl('/api/ai/health'), { headers: { Accept: 'application/json' }, cache: 'no-store' })
    const text = await response.text().catch(() => '')
    const payload = text ? JSON.parse(text) as { configured?: unknown } : null
    if (!payload || typeof payload !== 'object' || typeof payload.configured !== 'boolean') return null
    return payload as { configured: boolean; reason?: string | null; missing?: string[]; invalid?: string[] }
  } catch {
    return null
  }
}

/** Incremental UTF-8 decoder: keeps partial multi-byte sequences between network chunks. */
export class Utf8StreamDecoder {
  private pending: number[] = []

  decode(chunk: Uint8Array): string {
    const bytes = this.pending.length ? [...this.pending, ...chunk] : [...chunk]
    let end = bytes.length
    // Hold back an incomplete trailing sequence until the next chunk arrives.
    for (let back = 1; back <= Math.min(3, bytes.length); back += 1) {
      const byte = bytes[bytes.length - back]!
      if ((byte & 0xc0) === 0x80) continue
      const needed = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1
      if (needed > back) end = bytes.length - back
      break
    }
    this.pending = bytes.slice(end)
    return utf8ToString(bytes.slice(0, end))
  }

  flush(): string {
    const rest = this.pending
    this.pending = []
    return rest.length ? utf8ToString(rest) : ''
  }
}

function utf8ToString(bytes: number[]): string {
  let out = ''
  for (let index = 0; index < bytes.length;) {
    const byte = bytes[index]!
    let codePoint = 0xfffd
    let size = 1
    if (byte < 0x80) { codePoint = byte }
    else if (byte >= 0xc0 && byte < 0xe0 && index + 1 < bytes.length) {
      codePoint = ((byte & 0x1f) << 6) | (bytes[index + 1]! & 0x3f); size = 2
    } else if (byte >= 0xe0 && byte < 0xf0 && index + 2 < bytes.length) {
      codePoint = ((byte & 0x0f) << 12) | ((bytes[index + 1]! & 0x3f) << 6) | (bytes[index + 2]! & 0x3f); size = 3
    } else if (byte >= 0xf0 && index + 3 < bytes.length) {
      codePoint = ((byte & 0x07) << 18) | ((bytes[index + 1]! & 0x3f) << 12) | ((bytes[index + 2]! & 0x3f) << 6) | (bytes[index + 3]! & 0x3f); size = 4
    }
    out += String.fromCodePoint(codePoint)
    index += size
  }
  return out
}

export interface SseEvent { name: string; data: Record<string, unknown> }

/** Parses one SSE block (`event:` / `data:` lines) the way the website does. Malformed blocks are ignored. */
export function parseSseBlock(block: string): SseEvent | null {
  let name = 'message'
  const data: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) name = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  if (!data.length) return null
  try {
    const parsed = JSON.parse(data.join('\n')) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return { name, data: parsed as Record<string, unknown> }
  } catch {
    return null
  }
}

/**
 * Streams `POST /api/ai/chat`. Events are delivered in order. Resolves when the stream closes.
 * Aborting the signal closes the connection, and the caller separately asks the server to stop the task.
 */
export async function streamChat(body: unknown, token: string, signal: AbortSignal, onEvent: (event: SseEvent) => void): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  let response: Response
  try {
    response = await expoFetch(aiUrl('/api/ai/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal
    }) as unknown as Response
  } catch (error) {
    if (signal.aborted) throw error
    throw new AIRequestError('The Stracker AI service could not be reached. Check your connection and try again.', 'network', 0)
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let message = `Stracker could not complete that AI request (HTTP ${response.status}). Try again.`
    try {
      const parsed = JSON.parse(text) as APIErrorPayload
      if (typeof parsed.message === 'string') message = parsed.message
    } catch { /* keep the status message */ }
    return { ok: false, status: response.status, message }
  }
  const stream = response.body as unknown as ReadableStream<Uint8Array> | null
  if (!stream) return { ok: false, status: response.status, message: 'The AI response stream was unavailable. Retry your message.' }
  const reader = stream.getReader()
  const decoder = new Utf8StreamDecoder()
  let buffer = ''
  const drain = (blocks: string[]) => {
    for (const block of blocks) {
      const event = parseSseBlock(block)
      if (event) onEvent(event)
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value)
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() ?? ''
      drain(blocks)
    }
    buffer += decoder.flush()
    if (buffer.trim()) drain([buffer])
  } finally {
    try { reader.releaseLock() } catch { /* closed stream */ }
  }
  return { ok: true }
}
