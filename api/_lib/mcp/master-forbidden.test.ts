import { describe, expect, it } from 'vitest'
import { createMasterToolRegistry, IMPLEMENTED_MASTER_TOOL_NAMES } from './registry.js'
import { FORBIDDEN_SCOPE_MESSAGE, FORBIDDEN_TOOL_NAMES, MASTER_TOOL_CATALOGUE, isForbiddenTool } from './capabilities.js'
import { MemoryAuditSink } from './audit.js'
import { MemoryCredentialStore, createCredential } from './credentials.js'
import { MemoryConfirmationStore } from './confirmations.js'
import { testHandlerOptions, handleMasterMcp } from './handler.js'
import type { RateLimiter } from './rate-limit.js'
import type { ApiRequest, ApiResponse } from '../http.js'
import { settingsHandler } from '../control-routes/settings.js'

const unlimited: RateLimiter = { async take() { /* test only: the forbidden suite issues more calls than the production window allows */ } }

const ALTERNATES = [
  'Assign_Role',
  'REMOVE_ROLE',
  'change_permission_matrix',
  'modify_member_permission_overrides',
  'change_owner_identity',
  'ban_owner',
  'delete_owner',
  'delete_user_account',
  'permanently_delete_user',
  'auth_admin_delete_user',
  'change_password',
  'reset_password',
  'remove_passkey',
  'list_passkeys',
  'disable_mfa',
  'list_mfa_factors',
  'list_security_factors',
  'revoke_session',
  'revoke_all_sessions',
  'update_auth_settings',
  'update_security_policy',
  'update_turnstile',
  'read_service_role_key',
  'read_deployment_secrets',
  'read_secrets',
  'read_env',
  'execute_sql',
  'run_sql',
  'EXECUTE_SQL',
  'execute_javascript',
  'eval_javascript',
  'run_code',
  'execute_shell',
  'delete_supabase_project',
  'delete_database',
  'drop_schema',
  'delete_storage_bucket',
  'destroy_infrastructure',
  'set_signup_enabled',
  'set_signin_enabled',
  'update_email_domains',
  'create_master_credential',
  'delete_audit_events',
  'rewrite_audit_events'
]

function fakeReq(token: string | null, body: unknown, url = '/api/mcp'): ApiRequest {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  return { method: 'POST', headers, body, url } as ApiRequest
}

function fakeRes(): ApiResponse & { body: unknown; statusCode: number } {
  const res = { statusCode: 200, body: undefined as unknown, headersSent: false, headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { res.headers[name.toLowerCase()] = value },
    json(body: unknown) { res.body = body; res.headersSent = true },
    end(data?: unknown) { if (data !== undefined && res.body === undefined) res.body = data; res.headersSent = true } }
  return res as unknown as ApiResponse & { body: unknown; statusCode: number }
}

async function runtime() {
  const credentials = new MemoryCredentialStore()
  const issued = await createCredential(credentials, { displayName: 'Operations agent', createdBy: null })
  const options = testHandlerOptions(
    { credentials, rateLimiter: unlimited, now: () => new Date('2026-11-23T10:00:00.000Z') },
    createMasterToolRegistry(undefined, { confirmations: new MemoryConfirmationStore() }),
    new MemoryAuditSink()
  )
  return { issued, options }
}

async function call(token: string, name: string, args: Record<string, unknown>, options: Awaited<ReturnType<typeof runtime>>['options'], url = '/api/mcp') {
  const res = fakeRes()
  await handleMasterMcp(fakeReq(token, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }, url), res, options)
  return res
}

describe('Master MCP forbidden operations (spec §27.B)', () => {
  it('keeps every forbidden and alternate name out of tools/list and the authorised catalogue', () => {
    const listed = new Set(createMasterToolRegistry().names())
    expect(listed.size).toBe(IMPLEMENTED_MASTER_TOOL_NAMES.length)
    expect([...listed]).toEqual([...IMPLEMENTED_MASTER_TOOL_NAMES])
    for (const name of FORBIDDEN_TOOL_NAMES) {
      expect(isForbiddenTool(name)).toBe(true)
      expect(listed.has(name)).toBe(false)
      expect((MASTER_TOOL_CATALOGUE as readonly string[]).includes(name)).toBe(false)
    }
    for (const name of ALTERNATES) {
      expect(isForbiddenTool(name)).toBe(true)
      expect(listed.has(name)).toBe(false)
    }
  })

  it('refuses every forbidden and alternate tool name on tools/call, including mixed-case aliases', async () => {
    const { issued, options } = await runtime()
    const names = [...new Set<string>([...FORBIDDEN_TOOL_NAMES, ...ALTERNATES])]
    for (const name of names) {
      const res = await call(issued.token, name, { sql: 'drop schema public cascade', studentId: '11111111-1111-4111-8111-111111111111' }, options)
      const payload = (res.body as { result: { isError?: boolean; structuredContent: { error: string; message: string } } }).result
      expect(res.statusCode, name).toBe(200)
      expect(payload.isError, name).toBe(true)
      expect(payload.structuredContent.error, name).toBe('forbidden_tool')
      expect(payload.structuredContent.message, name).toBe(FORBIDDEN_SCOPE_MESSAGE)
    }
  })

  it('refuses the same forbidden operations when the request is posted to the rewritten system endpoint', async () => {
    const { issued, options } = await runtime()
    const res = await call(issued.token, 'execute_sql', { sql: 'select 1' }, options, '/api/control/system?route=mcp')
    const payload = (res.body as { result: { isError?: boolean; structuredContent: { error: string } } }).result
    expect(payload.isError).toBe(true)
    expect(payload.structuredContent.error).toBe('forbidden_tool')
  })

  it('does not accept a Master MCP bearer token as Control Centre authority on /api/control/settings', async () => {
    const { issued } = await runtime()
    const res = fakeRes()
    await settingsHandler(
      { method: 'POST', headers: { authorization: `Bearer ${issued.token}` }, body: { action: 'access.update', signupEnabled: true, signinEnabled: true }, url: '/api/control/settings' } as ApiRequest,
      res
    )
    expect(res.statusCode).toBeGreaterThanOrEqual(401)
    expect(res.statusCode).not.toBe(200)
    const body = JSON.stringify(res.body ?? {})
    expect(body).not.toMatch(/"ok"\s*:\s*true/)
  })
})

describe('Master MCP high-impact confirmation coverage', () => {
  it('documents confirmation on remaining high-impact tools and returns a bounded preview for maintenance, unused media and message delete', () => {
    const listed = createMasterToolRegistry().list()
    const required = [
      'publish_site_content',
      'restore_site_content_version',
      'publish_student_dashboard_layout',
      'restore_student_dashboard_layout_version',
      'ban_student',
      'warn_student',
      'unban_student',
      'hide_exam',
      'replace_site_ai_api_key',
      'remove_site_ai_provider',
      'delete_site_media',
      'delete_contact_message',
      'set_maintenance_mode'
    ]
    for (const name of required) {
      const tool = listed.find(item => item.name === name)
      expect(tool, name).toBeTruthy()
      expect(JSON.stringify(tool?.inputSchema), name).toMatch(/confirmationToken/)
      expect(tool?.description, name).toMatch(/confirm/i)
    }
  })
})
