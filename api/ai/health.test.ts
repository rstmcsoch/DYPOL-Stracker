import { afterEach, describe, expect, it } from 'vitest'
import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import handler from './health.js'

const SERVER_VARS = [
  'SUPABASE_URL',
  'VITE_SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'AI_CREDENTIALS_ENCRYPTION_KEY'
] as const

const saved: Record<string, string | undefined> = {}
for (const name of SERVER_VARS) saved[name] = process.env[name]

function clearServerEnv() {
  for (const name of SERVER_VARS) delete process.env[name]
}

afterEach(() => {
  clearServerEnv()
  for (const name of SERVER_VARS) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
})

interface MockResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
  ended: boolean
  headersSent: boolean
  setHeader(name: string, value: string): void
  end(body?: string): void
  json(body: unknown): void
}

function mockResponse(): MockResponse {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    ended: false,
    headersSent: false,
    setHeader(name, value) { this.headers[name] = value },
    end(body) { this.body = body ?? ''; this.ended = true; this.headersSent = true },
    json(body) { this.body = JSON.stringify(body); this.ended = true; this.headersSent = true }
  }
}

function mockRequest(method: string): ApiRequest {
  return { method, headers: {}, query: {} } as unknown as ApiRequest
}

async function call(method: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = mockResponse()
  await handler(mockRequest(method), res as unknown as ApiResponse)
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> }
}

describe('GET /api/ai/health', () => {
  it('reports configured:true when the server-only environment is complete', async () => {
    clearServerEnv()
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'public-anon-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only-service-role-secret'
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY = 'ab'.repeat(32)
    const { status, body } = await call('GET')
    expect(status).toBe(200)
    expect(body.service).toBe('stracker-ai')
    expect(body.configured).toBe(true)
    expect(body.reason).toBeNull()
    expect(body.missing).toEqual([])
    expect(body.invalid).toEqual([])
  })

  it('reports configured:false with safe reason codes and variable names when misconfigured', async () => {
    clearServerEnv()
    const { status, body } = await call('GET')
    expect(status).toBe(200)
    expect(body.configured).toBe(false)
    expect(body.reason).toBe('supabase_server_config_missing')
    expect(body.missing).toEqual(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'AI_CREDENTIALS_ENCRYPTION_KEY'])
    expect(body.checks).toEqual({ supabaseServerConfig: false, credentialEncryption: false })
  })

  it('reports only the service-role key when just the public VITE_ variables exist', async () => {
    clearServerEnv()
    process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
    process.env.VITE_SUPABASE_ANON_KEY = 'public-anon-key'
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY = 'ab'.repeat(32)
    const { body } = await call('GET')
    expect(body.configured).toBe(false)
    expect(body.missing).toEqual(['SUPABASE_SERVICE_ROLE_KEY'])
  })

  it('never exposes secret values, only variable names', async () => {
    clearServerEnv()
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'public-anon-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only-service-role-secret'
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY = 'cd'.repeat(32)
    const res = mockResponse()
    await handler(mockRequest('GET'), res as unknown as ApiResponse)
    expect(res.body).not.toContain('server-only-service-role-secret')
    expect(res.body).not.toContain('cd'.repeat(32))
    expect(res.body).not.toContain('public-anon-key')
  })

  it('does not require an Authorization header', async () => {
    clearServerEnv()
    const { status } = await call('GET')
    expect(status).toBe(200)
  })

  it('rejects non-GET methods with 405 and an Allow header', async () => {
    clearServerEnv()
    const res = mockResponse()
    await handler(mockRequest('POST'), res as unknown as ApiResponse)
    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('GET')
    expect(JSON.parse(res.body).error).toBe('method_not_allowed')
  })

  it('sets no-store so health results are never cached', async () => {
    clearServerEnv()
    const res = mockResponse()
    await handler(mockRequest('GET'), res as unknown as ApiResponse)
    expect(res.headers['Cache-Control']).toContain('no-store')
  })
})
