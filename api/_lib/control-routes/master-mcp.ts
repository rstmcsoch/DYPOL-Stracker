import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError, readJson, sendJson } from '../http.js'
import { controlHandler, recordAuditEvent, recordBoundedDenial, requireStepUp, type ControlContext } from '../control.js'
import { masterCapabilityOverview } from '../mcp/capabilities.js'
import { IMPLEMENTED_MASTER_TOOL_NAMES } from '../mcp/registry.js'
import {
  createCredential,
  publicCredentialView,
  revokeCredential,
  SupabaseCredentialStore,
  type CredentialStore
} from '../mcp/credentials.js'
import { MASTER_ANON_LIMIT, MASTER_API_LIMIT } from '../mcp/types.js'
import { sanitizeMasterAuditEvent } from '../mcp/audit.js'

/**
 * Control Centre → Settings → Master MCP.
 *   GET  /api/control/master-mcp     Owner + aal2: connection status, endpoint, capabilities, activity
 *   POST /api/control/master-mcp     { action: 'create' | 'revoke' | 'rotate', ... }
 *                                   Owner + aal2 + fresh single-use step-up. Never allowDuringOwnerReadOnly.
 *
 * Master bearer tokens cannot use this route (authorizeControl requires a Supabase JWT).
 * The raw token is returned only in the create/rotate response and is never stored or audited.
 */

const PRODUCTION_MCP_URL = 'https://dypol-stracker.vercel.app/api/mcp'
const TRANSPORT = 'Streamable HTTP (JSON-RPC)' as const

export const MASTER_MCP_SECURITY_NOTES = [
  'Master MCP credentials are separate from the Owner account. They never inherit Owner identity or Control Centre roles.',
  'A newly issued token is shown once and is not stored in recoverable form. Raw tokens are never written to the database, logs, or audit events.',
  'Global Stracker AI provider keys that Master MCP can manage are stored encrypted. Student BYOK keys are inaccessible to Master MCP.',
  'Master MCP cannot change roles or permissions, change the Owner, open Security Centre controls, or delete a user account.'
] as const

const mutationBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), displayName: z.string() }).strict(),
  z.object({ action: z.literal('revoke'), id: z.uuid() }).strict(),
  z.object({ action: z.literal('rotate'), id: z.uuid() }).strict()
])

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

export function masterMcpEndpointUrl(req: ApiRequest): string {
  const forwarded = headerValue(req.headers['x-forwarded-host']).split(',')[0]?.trim() ?? ''
  const host = forwarded || (headerValue(req.headers.host).split(',')[0]?.trim() ?? '')
  if (!host) return PRODUCTION_MCP_URL
  const proto = headerValue(req.headers['x-forwarded-proto']).split(',')[0]?.trim() || 'https'
  return `${proto}://${host}/api/mcp`
}

async function refuse(context: ControlContext, action: string, errorCode: string, status: number, message: string, targetId?: string): Promise<never> {
  await recordBoundedDenial(context.admin, {
    requestId: context.requestId,
    actorId: context.userId,
    actorRole: context.role,
    action,
    targetType: 'master_mcp',
    targetId,
    errorCode
  })
  throw new ApiError(status, errorCode, message)
}

async function requireOwner(context: ControlContext, action: string): Promise<void> {
  if (context.role !== 'owner') {
    await refuse(context, action, 'owner_only', 403, 'Only the owner can manage the Master MCP connection.')
  }
}

function publicConnection(record: Parameters<typeof publicCredentialView>[0]) {
  return publicCredentialView(record)
}

type AuditRow = {
  created_at?: unknown
  request_id?: unknown
  credential_id?: unknown
  credential_label?: unknown
  action?: unknown
  tool_name?: unknown
  target_type?: unknown
  target_id?: unknown
  result?: unknown
  error_category?: unknown
  reason?: unknown
}

function publicActivity(row: AuditRow) {
  const result = row.result === 'denied' || row.result === 'failed' ? row.result : 'success'
  const safe = sanitizeMasterAuditEvent({
    requestId: typeof row.request_id === 'string' ? row.request_id : '',
    credentialId: typeof row.credential_id === 'string' ? row.credential_id : null,
    credentialLabel: typeof row.credential_label === 'string' ? row.credential_label : null,
    toolName: typeof row.tool_name === 'string' ? row.tool_name : null,
    action: typeof row.action === 'string' ? row.action : 'master.unknown',
    targetType: typeof row.target_type === 'string' ? row.target_type : undefined,
    targetId: typeof row.target_id === 'string' ? row.target_id : undefined,
    result,
    errorCategory: typeof row.error_category === 'string' ? row.error_category : undefined,
    reason: typeof row.reason === 'string' ? row.reason : undefined
  })
  return {
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    credentialId: safe.credentialId,
    credentialLabel: safe.credentialLabel,
    action: safe.action,
    toolName: safe.toolName,
    targetType: safe.targetType ?? null,
    targetId: safe.targetId ?? null,
    result: safe.result,
    errorCategory: safe.errorCategory ?? null,
    reason: safe.reason ?? null
  }
}

async function loadActivity(admin: ControlContext['admin']) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await admin
    .from('master_mcp_audit_events')
    .select('created_at, request_id, credential_id, credential_label, action, tool_name, target_type, target_id, result, error_category, reason')
    .order('created_at', { ascending: false })
    .limit(80)
  if (error) {
    throw new ApiError(503, 'master_mcp_unavailable', 'Master MCP activity could not be loaded. The connection tables may not be applied yet.')
  }
  const events = (data ?? []).map(row => publicActivity(row as AuditRow))
  const recentActions = events.slice(0, 30)
  const recentFailures = events.filter(event => event.result === 'denied' || event.result === 'failed').slice(0, 20)
  const recentRateLimited = events.filter(event => event.errorCategory === 'rate_limited' && event.createdAt && event.createdAt >= dayAgo).length
  const toolUsageMap = new Map<string, number>()
  for (const event of events) {
    if (!event.toolName || event.result !== 'success') continue
    if (event.createdAt && event.createdAt < since) continue
    toolUsageMap.set(event.toolName, (toolUsageMap.get(event.toolName) ?? 0) + 1)
  }
  const toolUsage = [...toolUsageMap.entries()]
    .map(([toolName, count]) => ({ toolName, count }))
    .sort((a, b) => b.count - a.count || a.toolName.localeCompare(b.toolName))
  return { recentActions, recentFailures, recentRateLimited, toolUsage }
}

async function handleGet(req: ApiRequest, context: ControlContext, res: ApiResponse): Promise<void> {
  const store = new SupabaseCredentialStore(context.admin)
  let records
  try {
    records = await store.list()
  } catch (error) {
    if (error instanceof ApiError && error.code === 'master_mcp_unavailable') {
      throw new ApiError(503, 'master_mcp_unavailable', 'Master MCP is not available yet. The database migration has not been applied.')
    }
    throw error
  }
  const activity = await loadActivity(context.admin)
  const lastUsedAt = records
    .map(record => record.lastUsedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null
  sendJson(res, 200, {
    endpointUrl: masterMcpEndpointUrl(req),
    transport: TRANSPORT,
    connections: records.map(publicConnection),
    ...masterCapabilityOverview(IMPLEMENTED_MASTER_TOOL_NAMES),
    rateLimits: {
      authenticatedPerMinute: MASTER_API_LIMIT.limit,
      anonymousPerMinute: MASTER_ANON_LIMIT.limit,
      recentRateLimited: activity.recentRateLimited
    },
    lastUsedAt,
    toolUsage: activity.toolUsage,
    recentActions: activity.recentActions,
    recentFailures: activity.recentFailures,
    securityNotes: [...MASTER_MCP_SECURITY_NOTES]
  })
}

async function auditCredential(
  context: ControlContext,
  action: 'master_mcp.create' | 'master_mcp.revoke' | 'master_mcp.rotate',
  connection: ReturnType<typeof publicConnection>,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await recordAuditEvent(context.admin, {
    requestId: context.requestId,
    actorId: context.userId,
    actorRole: context.role,
    action,
    targetType: 'master_mcp',
    targetId: connection.id,
    outcome: 'success',
    severity: action === 'master_mcp.revoke' ? 'warning' : 'notice',
    summary: {
      displayName: connection.displayName,
      tokenHint: connection.tokenHint,
      status: connection.status,
      ...extra
    }
  })
}

async function handleCreate(store: CredentialStore, context: ControlContext, displayName: string, res: ApiResponse): Promise<void> {
  await requireStepUp(context, { action: 'master_mcp.create', targetType: 'master_mcp' })
  const issued = await createCredential(store, { displayName, createdBy: context.userId })
  const record = await store.findById(issued.id)
  if (!record) throw new ApiError(503, 'master_mcp_unavailable', 'The Master MCP connection was created but could not be loaded. Try again in a moment.')
  const connection = publicConnection(record)
  await auditCredential(context, 'master_mcp.create', connection)
  sendJson(res, 200, { ok: true, token: issued.token, tokenHint: issued.tokenHint, connection })
}

async function handleRevoke(store: CredentialStore, context: ControlContext, id: string, res: ApiResponse): Promise<void> {
  await requireStepUp(context, { action: 'master_mcp.revoke', targetType: 'master_mcp', targetId: id })
  const existing = await store.findById(id)
  if (!existing || existing.status !== 'active') {
    await refuse(context, 'master_mcp.revoke', 'not_found', 404, 'That Master MCP connection was not found or is already revoked.', id)
    return
  }
  const revoked = await revokeCredential(store, id, context.userId)
  if (!revoked) {
    await refuse(context, 'master_mcp.revoke', 'not_found', 404, 'That Master MCP connection was not found or is already revoked.', id)
    return
  }
  const record = await store.findById(id)
  if (!record) throw new ApiError(503, 'master_mcp_unavailable', 'The Master MCP connection was revoked but could not be reloaded.')
  const connection = publicConnection(record)
  await auditCredential(context, 'master_mcp.revoke', connection)
  sendJson(res, 200, { ok: true, connection })
}

async function handleRotate(store: CredentialStore, context: ControlContext, id: string, res: ApiResponse): Promise<void> {
  await requireStepUp(context, { action: 'master_mcp.rotate', targetType: 'master_mcp', targetId: id })
  const existing = await store.findById(id)
  if (!existing || existing.status !== 'active') {
    await refuse(context, 'master_mcp.rotate', 'not_found', 404, 'That Master MCP connection was not found or is already revoked.', id)
    return
  }
  const revoked = await revokeCredential(store, id, context.userId)
  if (!revoked) {
    await refuse(context, 'master_mcp.rotate', 'not_found', 404, 'That Master MCP connection was not found or is already revoked.', id)
    return
  }
  const issued = await createCredential(store, { displayName: existing.displayName, createdBy: context.userId })
  const record = await store.findById(issued.id)
  if (!record) throw new ApiError(503, 'master_mcp_unavailable', 'The previous token was revoked, but a replacement could not be loaded. Create a new connection.')
  const connection = publicConnection(record)
  await auditCredential(context, 'master_mcp.rotate', connection, { revokedId: id, revokedHint: existing.tokenHint })
  sendJson(res, 200, { ok: true, token: issued.token, tokenHint: issued.tokenHint, connection, revokedId: id })
}

async function handlePost(req: ApiRequest, context: ControlContext, res: ApiResponse): Promise<void> {
  const parsed = mutationBody.safeParse(await readJson(req, 8_000))
  if (!parsed.success) throw new ApiError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Check the connection details and try again.')
  const store = new SupabaseCredentialStore(context.admin)
  const body = parsed.data
  if (body.action === 'create') return handleCreate(store, context, body.displayName, res)
  if (body.action === 'revoke') return handleRevoke(store, context, body.id, res)
  return handleRotate(store, context, body.id, res)
}

export async function masterMcpHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET', 'POST'], { requireAal2: true, permission: null }, async context => {
    const action = req.method === 'POST' ? 'master_mcp.manage' : 'master_mcp.view'
    await requireOwner(context, action)
    if (req.method === 'GET') await handleGet(req, context, res)
    else await handlePost(req, context, res)
  })
}
