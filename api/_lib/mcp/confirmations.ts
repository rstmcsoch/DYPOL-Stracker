import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../http.js'
import { logAIEvent } from '../diagnostics.js'
import { cleanText } from '../control-policy.js'
import { MCP_CONFIRMATION_TTL_MS } from './types.js'
import { generateMasterToken, hashMasterSecret, hashesEqual } from './token.js'

export interface ConfirmationRecord {
  id: string
  credentialId: string
  tokenHash: string
  toolName: string
  targetType: string | null
  targetId: string | null
  targetStudentId: string | null
  argumentDigest: string
  resourceVersion: string | null
  expiresAt: string
  consumedAt: string | null
  createdAt: string
}

export interface ConfirmationRequest {
  credentialId: string
  toolName: string
  targetType?: string
  targetId?: string
  targetStudentId?: string
  arguments: unknown
  resourceVersion?: string
}

export interface ConfirmationStore {
  insert(record: ConfirmationRecord): Promise<void>
  findByHash(tokenHash: string): Promise<ConfirmationRecord | null>
  consume(tokenHash: string, nowIso: string): Promise<ConfirmationRecord | null>
}

export function canonicalArgumentDigest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}

export function issueConfirmation(
  request: ConfirmationRequest,
  now = new Date(),
  ttlMs = MCP_CONFIRMATION_TTL_MS
): { token: string; record: ConfirmationRecord } {
  const token = generateMasterToken()
  const createdAt = now.toISOString()
  const record: ConfirmationRecord = {
    id: randomUUID(),
    credentialId: request.credentialId,
    tokenHash: hashMasterSecret(token),
    toolName: request.toolName,
    targetType: request.targetType ? cleanText(request.targetType, 40) || null : null,
    targetId: request.targetId ? cleanText(request.targetId, 120) || null : null,
    targetStudentId: request.targetStudentId ?? null,
    argumentDigest: canonicalArgumentDigest(request.arguments ?? {}),
    resourceVersion: request.resourceVersion ? cleanText(request.resourceVersion, 80) || null : null,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    consumedAt: null,
    createdAt
  }
  return { token, record }
}

export function confirmationMatches(record: ConfirmationRecord, request: ConfirmationRequest, now = new Date()): 'ok' | 'expired' | 'mismatch' | 'replayed' {
  if (record.consumedAt) return 'replayed'
  if (Date.parse(record.expiresAt) <= now.getTime()) return 'expired'
  const expected = canonicalArgumentDigest(request.arguments ?? {})
  const sameConnection = record.credentialId === request.credentialId
  const sameTool = record.toolName === request.toolName
  const sameTarget = (record.targetType ?? null) === (request.targetType ?? null)
    && (record.targetId ?? null) === (request.targetId ?? null)
    && (record.targetStudentId ?? null) === (request.targetStudentId ?? null)
  const sameVersion = (record.resourceVersion ?? null) === (request.resourceVersion ?? null)
  if (!sameConnection || !sameTool || !sameTarget || !sameVersion || !hashesEqual(record.argumentDigest, expected)) return 'mismatch'
  return 'ok'
}

export const CONFIRMATION_MESSAGES = {
  expired: 'That confirmation has expired. Review the change and confirm again.',
  mismatch: 'That confirmation does not match this operation or target. Review the change and confirm again.',
  replayed: 'That confirmation has already been used. Review the change and confirm again.',
  missing: 'This action needs a valid confirmation token. Review the preview and confirm it first.'
} as const

export async function consumeConfirmation(
  store: ConfirmationStore,
  token: string,
  request: ConfirmationRequest,
  now = new Date()
): Promise<ConfirmationRecord> {
  const tokenHash = hashMasterSecret(token)
  const existing = await store.findByHash(tokenHash)
  if (!existing) throw new ApiError(400, 'confirmation_required', CONFIRMATION_MESSAGES.missing)
  const verdict = confirmationMatches(existing, request, now)
  if (verdict !== 'ok') throw new ApiError(400, 'confirmation_invalid', CONFIRMATION_MESSAGES[verdict])
  const consumed = await store.consume(tokenHash, now.toISOString())
  if (!consumed || consumed.consumedAt !== now.toISOString()) {
    throw new ApiError(400, 'confirmation_invalid', CONFIRMATION_MESSAGES.replayed)
  }
  return consumed
}

export class MemoryConfirmationStore implements ConfirmationStore {
  readonly rows = new Map<string, ConfirmationRecord>()

  async insert(record: ConfirmationRecord): Promise<void> {
    this.rows.set(record.tokenHash, { ...record })
  }

  async findByHash(tokenHash: string): Promise<ConfirmationRecord | null> {
    const record = this.rows.get(tokenHash)
    return record ? { ...record } : null
  }

  async consume(tokenHash: string, nowIso: string): Promise<ConfirmationRecord | null> {
    const record = this.rows.get(tokenHash)
    if (!record) return null
    if (record.consumedAt) return { ...record }
    const next = { ...record, consumedAt: nowIso }
    this.rows.set(tokenHash, next)
    return next
  }
}

export class SupabaseConfirmationStore implements ConfirmationStore {
  constructor(private readonly admin: SupabaseClient) {}

  async insert(record: ConfirmationRecord): Promise<void> {
    const { error } = await this.admin.from('master_mcp_confirmation_tokens').insert({
      id: record.id,
      credential_id: record.credentialId,
      token_hash: record.tokenHash,
      tool_name: record.toolName,
      target_type: record.targetType,
      target_id: record.targetId,
      target_student_id: record.targetStudentId,
      argument_digest: record.argumentDigest,
      resource_version: record.resourceVersion,
      expires_at: record.expiresAt,
      consumed_at: record.consumedAt,
      created_at: record.createdAt
    })
    if (error) {
      logAIEvent('error', 'master_mcp_confirmation_insert_failed', { code: error.code ?? '' })
      throw new ApiError(503, 'master_mcp_unavailable', 'The confirmation could not be created. Try again in a moment.')
    }
  }

  async findByHash(tokenHash: string): Promise<ConfirmationRecord | null> {
    const { data, error } = await this.admin
      .from('master_mcp_confirmation_tokens')
      .select('id, credential_id, token_hash, tool_name, target_type, target_id, target_student_id, argument_digest, resource_version, expires_at, consumed_at, created_at')
      .eq('token_hash', tokenHash)
      .maybeSingle()
    if (error) {
      logAIEvent('error', 'master_mcp_confirmation_lookup_failed', { code: error.code ?? '' })
      throw new ApiError(503, 'master_mcp_unavailable', 'The confirmation could not be checked. Try again in a moment.')
    }
    return data ? mapConfirmation(data as Record<string, unknown>) : null
  }

  async consume(tokenHash: string, nowIso: string): Promise<ConfirmationRecord | null> {
    const { data, error } = await this.admin
      .from('master_mcp_confirmation_tokens')
      .update({ consumed_at: nowIso })
      .eq('token_hash', tokenHash)
      .is('consumed_at', null)
      .select('id, credential_id, token_hash, tool_name, target_type, target_id, target_student_id, argument_digest, resource_version, expires_at, consumed_at, created_at')
      .maybeSingle()
    if (error) {
      logAIEvent('error', 'master_mcp_confirmation_consume_failed', { code: error.code ?? '' })
      throw new ApiError(503, 'master_mcp_unavailable', 'The confirmation could not be checked. Try again in a moment.')
    }
    return data ? mapConfirmation(data as Record<string, unknown>) : null
  }
}

function mapConfirmation(row: Record<string, unknown>): ConfirmationRecord {
  return {
    id: String(row.id),
    credentialId: String(row.credential_id),
    tokenHash: String(row.token_hash),
    toolName: String(row.tool_name),
    targetType: typeof row.target_type === 'string' ? row.target_type : null,
    targetId: typeof row.target_id === 'string' ? row.target_id : null,
    targetStudentId: typeof row.target_student_id === 'string' ? row.target_student_id : null,
    argumentDigest: String(row.argument_digest),
    resourceVersion: typeof row.resource_version === 'string' ? row.resource_version : null,
    expiresAt: String(row.expires_at),
    consumedAt: typeof row.consumed_at === 'string' ? row.consumed_at : null,
    createdAt: String(row.created_at)
  }
}
