import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../http.js'
import { logAIEvent } from '../diagnostics.js'
import type { IssuedMasterCredential, MasterCredentialRecord } from './types.js'
import { generateMasterToken, hashMasterSecret, hashesEqual, normalizeDisplayName, tokenHint } from './token.js'

export interface CredentialStore {
  insert(record: MasterCredentialRecord): Promise<void>
  findByHash(tokenHash: string): Promise<MasterCredentialRecord | null>
  list(): Promise<MasterCredentialRecord[]>
  findById(id: string): Promise<MasterCredentialRecord | null>
  revoke(id: string, revokedAt: string, revokedBy: string | null): Promise<boolean>
  touchLastUsed(id: string, usedAt: string): Promise<void>
}

function mapRow(row: Record<string, unknown>): MasterCredentialRecord {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    tokenHash: String(row.token_hash),
    tokenHint: String(row.token_hint),
    status: row.status === 'revoked' ? 'revoked' : 'active',
    createdAt: String(row.created_at),
    createdBy: typeof row.created_by === 'string' ? row.created_by : null,
    lastUsedAt: typeof row.last_used_at === 'string' ? row.last_used_at : null,
    revokedAt: typeof row.revoked_at === 'string' ? row.revoked_at : null,
    revokedBy: typeof row.revoked_by === 'string' ? row.revoked_by : null
  }
}

export function publicCredentialView(record: MasterCredentialRecord): Omit<MasterCredentialRecord, 'tokenHash'> {
  return {
    id: record.id,
    displayName: record.displayName,
    tokenHint: record.tokenHint,
    status: record.status,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
    revokedBy: record.revokedBy
  }
}

export async function createCredential(
  store: CredentialStore,
  options: { displayName: unknown; createdBy: string | null; now?: Date }
): Promise<IssuedMasterCredential> {
  const displayName = normalizeDisplayName(options.displayName)
  if (!displayName) throw new ApiError(400, 'invalid_display_name', 'Give the connection a name of 1 to 80 characters.')
  const token = generateMasterToken()
  const now = (options.now ?? new Date()).toISOString()
  const record: MasterCredentialRecord = {
    id: randomUUID(),
    displayName,
    tokenHash: hashMasterSecret(token),
    tokenHint: tokenHint(token),
    status: 'active',
    createdAt: now,
    createdBy: options.createdBy,
    lastUsedAt: null,
    revokedAt: null,
    revokedBy: null
  }
  await store.insert(record)
  return { id: record.id, displayName, token, tokenHint: record.tokenHint, createdAt: now }
}

/**
 * Resolve a presented bearer secret to an active credential. The hash comparison
 * is constant-time. A missing or revoked secret returns the same unsuccessful result.
 */
export async function authenticateCredential(store: CredentialStore, presented: string): Promise<MasterCredentialRecord | null> {
  const tokenHash = hashMasterSecret(presented)
  const record = await store.findByHash(tokenHash)
  if (!record || !hashesEqual(record.tokenHash, tokenHash)) return null
  if (record.status !== 'active' || record.revokedAt) return null
  return record
}

export async function revokeCredential(
  store: CredentialStore,
  id: string,
  revokedBy: string | null,
  now = new Date()
): Promise<boolean> {
  return store.revoke(id, now.toISOString(), revokedBy)
}

export class MemoryCredentialStore implements CredentialStore {
  readonly rows = new Map<string, MasterCredentialRecord>()

  async insert(record: MasterCredentialRecord): Promise<void> {
    this.rows.set(record.id, { ...record })
  }

  async findByHash(tokenHash: string): Promise<MasterCredentialRecord | null> {
    for (const record of this.rows.values()) {
      if (hashesEqual(record.tokenHash, tokenHash)) return { ...record }
    }
    return null
  }

  async list(): Promise<MasterCredentialRecord[]> {
    return [...this.rows.values()].map(row => ({ ...row }))
  }

  async findById(id: string): Promise<MasterCredentialRecord | null> {
    const row = this.rows.get(id)
    return row ? { ...row } : null
  }

  async revoke(id: string, revokedAt: string, revokedBy: string | null): Promise<boolean> {
    const row = this.rows.get(id)
    if (!row || row.status === 'revoked') return false
    this.rows.set(id, { ...row, status: 'revoked', revokedAt, revokedBy })
    return true
  }

  async touchLastUsed(id: string, usedAt: string): Promise<void> {
    const row = this.rows.get(id)
    if (!row || row.status !== 'active') return
    this.rows.set(id, { ...row, lastUsedAt: usedAt })
  }
}

export class SupabaseCredentialStore implements CredentialStore {
  constructor(private readonly admin: SupabaseClient) {}

  async insert(record: MasterCredentialRecord): Promise<void> {
    const { error } = await this.admin.from('master_mcp_credentials').insert({
      id: record.id,
      display_name: record.displayName,
      token_hash: record.tokenHash,
      token_hint: record.tokenHint,
      status: record.status,
      created_at: record.createdAt,
      created_by: record.createdBy,
      last_used_at: record.lastUsedAt,
      revoked_at: record.revokedAt,
      revoked_by: record.revokedBy
    })
    if (error) {
      logAIEvent('error', 'master_mcp_credential_insert_failed', { code: error.code ?? '' })
      throw new ApiError(503, 'master_mcp_unavailable', 'The Master MCP connection could not be saved. Try again in a moment.')
    }
  }

  async findByHash(tokenHash: string): Promise<MasterCredentialRecord | null> {
    const { data, error } = await this.admin
      .from('master_mcp_credentials')
      .select('id, display_name, token_hash, token_hint, status, created_at, created_by, last_used_at, revoked_at, revoked_by')
      .eq('token_hash', tokenHash)
      .maybeSingle()
    if (error) {
      logAIEvent('error', 'master_mcp_credential_lookup_failed', { code: error.code ?? '' })
      throw new ApiError(503, 'master_mcp_unavailable', 'The Master MCP connection could not be verified. Try again in a moment.')
    }
    return data ? mapRow(data as Record<string, unknown>) : null
  }

  async list(): Promise<MasterCredentialRecord[]> {
    const { data, error } = await this.admin
      .from('master_mcp_credentials')
      .select('id, display_name, token_hash, token_hint, status, created_at, created_by, last_used_at, revoked_at, revoked_by')
      .order('created_at', { ascending: false })
    if (error) {
      logAIEvent('error', 'master_mcp_credential_list_failed', { code: error.code ?? '' })
      throw new ApiError(503, 'master_mcp_unavailable', 'Master MCP connections could not be loaded. Try again in a moment.')
    }
    return (data ?? []).map(row => mapRow(row as Record<string, unknown>))
  }

  async findById(id: string): Promise<MasterCredentialRecord | null> {
    const { data, error } = await this.admin
      .from('master_mcp_credentials')
      .select('id, display_name, token_hash, token_hint, status, created_at, created_by, last_used_at, revoked_at, revoked_by')
      .eq('id', id)
      .maybeSingle()
    if (error) {
      logAIEvent('error', 'master_mcp_credential_lookup_failed', { code: error.code ?? '' })
      throw new ApiError(503, 'master_mcp_unavailable', 'The Master MCP connection could not be loaded. Try again in a moment.')
    }
    return data ? mapRow(data as Record<string, unknown>) : null
  }

  async revoke(id: string, revokedAt: string, revokedBy: string | null): Promise<boolean> {
    const { data, error } = await this.admin
      .from('master_mcp_credentials')
      .update({ status: 'revoked', revoked_at: revokedAt, revoked_by: revokedBy })
      .eq('id', id)
      .eq('status', 'active')
      .select('id')
      .maybeSingle()
    if (error) {
      logAIEvent('error', 'master_mcp_credential_revoke_failed', { code: error.code ?? '' })
      throw new ApiError(503, 'master_mcp_unavailable', 'The Master MCP connection could not be revoked. Try again in a moment.')
    }
    return Boolean(data)
  }

  async touchLastUsed(id: string, usedAt: string): Promise<void> {
    const { error } = await this.admin
      .from('master_mcp_credentials')
      .update({ last_used_at: usedAt })
      .eq('id', id)
      .eq('status', 'active')
    if (error) logAIEvent('error', 'master_mcp_credential_touch_failed', { code: error.code ?? '' })
  }
}
