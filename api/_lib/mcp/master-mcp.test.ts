import { describe, expect, it } from 'vitest'
import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError } from '../http.js'
import { MemoryAuditSink, sanitizeMasterAuditEvent } from './audit.js'
import { FORBIDDEN_SCOPE_MESSAGE, FORBIDDEN_TOOL_NAMES, isForbiddenTool } from './capabilities.js'
import {
  MemoryConfirmationStore,
  canonicalArgumentDigest,
  confirmationMatches,
  consumeConfirmation,
  issueConfirmation
} from './confirmations.js'
import { MemoryCredentialStore, authenticateCredential, createCredential, publicCredentialView, revokeCredential } from './credentials.js'
import { testHandlerOptions, handleMasterMcp } from './handler.js'
import { MCP_MAX_REQUEST_BYTES, MASTER_ACTOR_TYPE } from './types.js'
import { DEFAULT_PROTOCOL_VERSION, MCP_INSTRUCTIONS, SUPPORTED_PROTOCOL_VERSIONS, parseJsonRpcBody, assertRequestSize, McpProtocolError, initializeResult, negotiateProtocolVersion } from './protocol.js'
import { MemoryRateLimiter, MASTER_API_LIMIT } from './rate-limit.js'
import { IMPLEMENTED_MASTER_TOOL_NAMES, createMasterToolRegistry } from './registry.js'
import { generateMasterToken, hashMasterSecret, hashesEqual, isMasterTokenShape, presentedTokenLooksLikeJwt, tokenHint } from './token.js'

const STUDENT_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.signature'
const CONTROL_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDIiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6ImFhbDIifQ.signature'

function fakeReq(headers: Record<string, string>, body: unknown, method = 'POST'): ApiRequest {
  return {
    method,
    headers,
    body,
    url: '/api/mcp'
  } as ApiRequest
}

function fakeRes(): ApiResponse & { body: unknown; headers: Record<string, string> } {
  const headers: Record<string, string> = {}
  const res = {
    statusCode: 200,
    headers,
    body: undefined as unknown,
    headersSent: false,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers[name.toLowerCase()] = String(value)
    },
    json(body: unknown) {
      res.body = body
      res.headersSent = true
    },
    end(data?: unknown) {
      if (data !== undefined && res.body === undefined) res.body = data
      res.headersSent = true
    }
  }
  return res as unknown as ApiResponse & { body: unknown; headers: Record<string, string> }
}

async function runtime() {
  const credentials = new MemoryCredentialStore()
  const issued = await createCredential(credentials, { displayName: 'Operations agent', createdBy: null })
  const audit = new MemoryAuditSink()
  const options = testHandlerOptions(
    { credentials, rateLimiter: new MemoryRateLimiter(), now: () => new Date() },
    createMasterToolRegistry(),
    audit
  )
  return { issued, options, audit, credentials }
}

async function callMcp(token: string | null, body: unknown, options: Awaited<ReturnType<typeof runtime>>['options'], method = 'POST') {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  const req = fakeReq(headers, body, method)
  const res = fakeRes()
  await handleMasterMcp(req, res, options)
  return res
}

describe('Master MCP token cryptography', () => {
  it('generates a high-entropy stmcp token, stores only a hash, and compares in constant time', () => {
    const token = generateMasterToken()
    expect(isMasterTokenShape(token)).toBe(true)
    expect(token.startsWith('stmcp_')).toBe(true)
    expect(hashMasterSecret(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashMasterSecret(token)).not.toContain(token)
    expect(tokenHint(token)).toBe(token.slice(-4))
    expect(hashesEqual(hashMasterSecret(token), hashMasterSecret(token))).toBe(true)
    expect(hashesEqual(hashMasterSecret(token), hashMasterSecret(generateMasterToken()))).toBe(false)
    expect(hashesEqual('abc', 'ab')).toBe(false)
  })

  it('recognizes session JWTs so they cannot be used as Master tokens', () => {
    expect(presentedTokenLooksLikeJwt(STUDENT_JWT)).toBe(true)
    expect(presentedTokenLooksLikeJwt(CONTROL_JWT)).toBe(true)
    expect(isMasterTokenShape(STUDENT_JWT)).toBe(false)
    expect(presentedTokenLooksLikeJwt(generateMasterToken())).toBe(false)
  })
})

describe('Master MCP credentials', () => {
  it('returns the raw token only at creation and authenticates the hashed secret', async () => {
    const store = new MemoryCredentialStore()
    const issued = await createCredential(store, { displayName: '  Alpha  ', createdBy: null })
    expect(issued.token.startsWith('stmcp_')).toBe(true)
    expect(issued.displayName).toBe('Alpha')
    expect(issued.tokenHint).toBe(tokenHint(issued.token))
    const listed = publicCredentialView((await store.list())[0]!)
    expect('tokenHash' in listed).toBe(false)
    expect(JSON.stringify(listed)).not.toContain(issued.token)
    expect(await authenticateCredential(store, issued.token)).toMatchObject({ id: issued.id, status: 'active' })
    expect(await authenticateCredential(store, generateMasterToken())).toBeNull()
  })

  it('rejects a revoked credential on the next lookup', async () => {
    const store = new MemoryCredentialStore()
    const issued = await createCredential(store, { displayName: 'Revoke me', createdBy: null })
    expect(await revokeCredential(store, issued.id, null)).toBe(true)
    expect(await authenticateCredential(store, issued.token)).toBeNull()
  })
})

describe('Master MCP confirmation tokens', () => {
  const base = { credentialId: '11111111-1111-4111-8111-111111111111', toolName: 'ban_student', targetId: 'student-1', arguments: { user_id: 'student-1', reason: 'spam' } }

  it('accepts a matching one-use confirmation and refuses replay, mismatch and expiry', async () => {
    const store = new MemoryConfirmationStore()
    const now = new Date('2026-11-23T10:00:00.000Z')
    const issued = issueConfirmation(base, now)
    await store.insert(issued.record)
    expect(canonicalArgumentDigest(base.arguments)).toHaveLength(64)
    expect(confirmationMatches(issued.record, base, now)).toBe('ok')
    expect(confirmationMatches(issued.record, { ...base, targetId: 'other' }, now)).toBe('mismatch')
    expect(confirmationMatches(issued.record, { ...base, arguments: { user_id: 'student-1', reason: 'other' } }, now)).toBe('mismatch')

    const consumed = await consumeConfirmation(store, issued.token, base, now)
    expect(consumed.consumedAt).toBe(now.toISOString())
    await expect(consumeConfirmation(store, issued.token, base, now)).rejects.toMatchObject({ code: 'confirmation_invalid', message: expect.stringMatching(/already been used/) })

    const expired = issueConfirmation(base, now, 1)
    await store.insert(expired.record)
    await expect(consumeConfirmation(store, expired.token, base, new Date(now.getTime() + 1000))).rejects.toMatchObject({ code: 'confirmation_invalid' })
  })
})

describe('Master MCP audit sanitization', () => {
  it('drops secrets, tokens, notes and marks from summaries', () => {
    const safe = sanitizeMasterAuditEvent({
      requestId: 'mcp_test',
      credentialId: '11111111-1111-4111-8111-111111111111',
      credentialLabel: 'Ops',
      toolName: 'replace_site_ai_api_key',
      action: 'mcp.replace_site_ai_api_key',
      result: 'success',
      afterSummary: {
        api_key: 'sk-live-secret-value',
        token: 'stmcp_should_never_appear',
        notes: 'private student notes',
        marks: '99',
        provider: 'openai',
        masked: '••••1234'
      }
    })
    const json = JSON.stringify(safe)
    expect(json).not.toContain('sk-live-secret-value')
    expect(json).not.toContain('stmcp_should_never_appear')
    expect(json).not.toContain('private student notes')
    expect(safe.afterSummary).toMatchObject({ provider: 'openai', masked: '••••1234' })
    expect(safe.afterSummary).not.toHaveProperty('api_key')
    expect(safe.afterSummary).not.toHaveProperty('notes')
    expect(safe.afterSummary).not.toHaveProperty('marks')
  })
})

describe('Master MCP rate limiter', () => {
  it('enforces a per-credential limit', async () => {
    const limiter = new MemoryRateLimiter()
    await limiter.take('cred:a', { ...MASTER_API_LIMIT, limit: 2 })
    await limiter.take('cred:a', { ...MASTER_API_LIMIT, limit: 2 })
    await expect(limiter.take('cred:a', { ...MASTER_API_LIMIT, limit: 2 })).rejects.toMatchObject({ status: 429, code: 'rate_limited' })
    await limiter.take('cred:b', { ...MASTER_API_LIMIT, limit: 2 })
  })
})

describe('MCP protocol', () => {
  it('negotiates a supported protocol version and describes the server', () => {
    expect(negotiateProtocolVersion('2025-03-26')).toBe('2025-03-26')
    expect(negotiateProtocolVersion('nope')).toBe(DEFAULT_PROTOCOL_VERSION)
    const result = initializeResult(DEFAULT_PROTOCOL_VERSION)
    expect(result.serverInfo.name).toBe('stracker-master-mcp')
    expect(result.instructions).toContain('not the Owner')
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(DEFAULT_PROTOCOL_VERSION)
    expect(MCP_INSTRUCTIONS).toContain('user-account deletion')
  })

  it('rejects JSON-RPC batches and oversized requests', () => {
    expect(() => parseJsonRpcBody([{ jsonrpc: '2.0', method: 'ping', id: 1 }])).toThrow(McpProtocolError)
    expect(() => assertRequestSize(MCP_MAX_REQUEST_BYTES + 1)).toThrow(McpProtocolError)
    expect(() => assertRequestSize(MCP_MAX_REQUEST_BYTES)).not.toThrow()
  })
})

describe('POST /api/mcp', () => {
  it('authenticates a Master token and serves initialize, ping, tools/list and get_master_permissions', async () => {
    const { issued, options, audit } = await runtime()
    const initialized = await callMcp(issued.token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test', version: '1' } } }, options)
    expect(initialized.statusCode).toBe(200)
    expect(initialized.body).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'stracker-master-mcp' } } })

    const ping = await callMcp(issued.token, { jsonrpc: '2.0', id: 2, method: 'ping' }, options)
    expect(ping.body).toMatchObject({ result: {} })

    const listed = await callMcp(issued.token, { jsonrpc: '2.0', id: 3, method: 'tools/list' }, options)
    const tools = (listed.body as { result: { tools: Array<{ name: string }> } }).result.tools
    expect(tools.map(tool => tool.name)).toEqual([...IMPLEMENTED_MASTER_TOOL_NAMES])
    for (const name of FORBIDDEN_TOOL_NAMES) expect(tools.some(tool => tool.name === name)).toBe(false)

    const permissions = await callMcp(issued.token, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_master_permissions', arguments: {} } }, options)
    const payload = (permissions.body as { result: { structuredContent: Record<string, unknown>; isError?: boolean } }).result
    expect(payload.isError).toBeFalsy()
    expect(payload.structuredContent).toMatchObject({
      actor: { type: MASTER_ACTOR_TYPE, isOwner: false, authenticationMethod: 'bearer_token' },
      implementedTools: [...IMPLEMENTED_MASTER_TOOL_NAMES]
    })
    const serialized = JSON.stringify(permissions.body)
    expect(serialized).not.toContain(issued.token)
    expect(serialized).not.toMatch(/tokenHash|token_hash/)
    expect((payload.structuredContent as { actor: { type: string } }).actor.type).not.toBe('owner')
    expect(audit.events.some(event => event.action === 'mcp.get_master_permissions' && event.result === 'success')).toBe(true)
    expect(JSON.stringify(audit.events)).not.toContain(issued.token)
  })

  it('refuses missing, invalid, student JWT, Control Center JWT and revoked tokens', async () => {
    const { issued, options, credentials } = await runtime()
    const body = { jsonrpc: '2.0', id: 1, method: 'ping' }
    expect((await callMcp(null, body, options)).statusCode).toBe(401)
    expect((await callMcp(generateMasterToken(), body, options)).body).toMatchObject({ error: 'unauthenticated' })
    expect((await callMcp(STUDENT_JWT, body, options)).statusCode).toBe(401)
    expect((await callMcp(CONTROL_JWT, body, options)).statusCode).toBe(401)
    await revokeCredential(credentials, issued.id, null)
    expect((await callMcp(issued.token, body, options)).statusCode).toBe(401)
  })

  it('still returns 401 without a token when the Master rate-limit tables have not been migrated', async () => {
    const credentials = new MemoryCredentialStore()
    const unavailable = {
      async take() {
        throw new ApiError(503, 'master_mcp_unavailable', 'The Master MCP backend is not configured for this deployment yet.')
      }
    }
    const options = testHandlerOptions(
      { credentials, rateLimiter: unavailable, now: () => new Date() },
      createMasterToolRegistry(),
      new MemoryAuditSink()
    )
    const res = await callMcp(null, { jsonrpc: '2.0', id: 1, method: 'ping' }, options)
    expect(res.statusCode).toBe(401)
    expect(res.body).toMatchObject({ error: 'unauthenticated' })
  })

  it('refuses forbidden and unknown tools and does not advertise them', async () => {
    const { issued, options, audit } = await runtime()
    const forbidden = await callMcp(issued.token, { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'delete_user', arguments: { user_id: '11111111-1111-4111-8111-111111111111' } } }, options)
    const forbiddenResult = (forbidden.body as { result: { isError: boolean; structuredContent: { error: string; message: string } } }).result
    expect(forbiddenResult.isError).toBe(true)
    expect(forbiddenResult.structuredContent.error).toBe('forbidden_tool')
    expect(forbiddenResult.structuredContent.message).toBe(FORBIDDEN_SCOPE_MESSAGE)
    expect(isForbiddenTool('delete_user')).toBe(true)

    const unknown = await callMcp(issued.token, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'execute_sql', arguments: { sql: 'drop schema public' } } }, options)
    expect((unknown.body as { result: { isError: boolean; structuredContent: { error: string } } }).result.structuredContent.error).toBe('forbidden_tool')

    const missing = await callMcp(issued.token, { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'inspect_widget_frob', arguments: {} } }, options)
    expect((missing.body as { result: { structuredContent: { error: string } } }).result.structuredContent.error).toBe('unknown_tool')

    expect(audit.events.some(event => event.result === 'denied' && event.errorCategory === 'forbidden_tool')).toBe(true)
  })

  it('rejects extra arguments, unsupported methods, batches and non-POST methods', async () => {
    const { issued, options } = await runtime()
    const extra = await callMcp(issued.token, { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'get_master_permissions', arguments: { unexpected: true } } }, options)
    expect((extra.body as { result: { structuredContent: { error: string } } }).result.structuredContent.error).toBe('invalid_arguments')

    const method = await callMcp(issued.token, { jsonrpc: '2.0', id: 12, method: 'resources/list' }, options)
    expect(method.body).toMatchObject({ error: { code: -32601 } })

    const batch = await callMcp(issued.token, [{ jsonrpc: '2.0', id: 1, method: 'ping' }], options)
    expect(batch.statusCode).toBe(400)
    expect(batch.body).toMatchObject({ error: 'batch_not_supported' })

    const get = await callMcp(issued.token, { jsonrpc: '2.0', id: 1, method: 'ping' }, options, 'GET')
    expect(get.statusCode).toBe(405)
  })
})
