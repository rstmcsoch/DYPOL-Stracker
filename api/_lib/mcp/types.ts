/**
 * Shared types for the Stracker Master MCP principal.
 *
 * This actor is independent of the Supabase Owner, Control Center roles,
 * student accounts and the student-facing Stracker AI. It must never carry
 * an Owner role or a fabricated user identity.
 */

export const MASTER_ACTOR_TYPE = 'master_mcp' as const
export type MasterActorType = typeof MASTER_ACTOR_TYPE

export const MASTER_AUTH_METHOD = 'bearer_token' as const

export interface MasterActor {
  actorType: MasterActorType
  connectionId: string
  credentialId: string
  credentialLabel: string
  requestId: string
  authenticationMethod: typeof MASTER_AUTH_METHOD
  authenticatedAt: string
}

export type MasterCredentialStatus = 'active' | 'revoked'

export interface MasterCredentialRecord {
  id: string
  displayName: string
  tokenHash: string
  tokenHint: string
  status: MasterCredentialStatus
  createdAt: string
  createdBy: string | null
  lastUsedAt: string | null
  revokedAt: string | null
  revokedBy: string | null
}

export interface IssuedMasterCredential {
  id: string
  displayName: string
  token: string
  tokenHint: string
  createdAt: string
}

export type MasterAuditResult = 'success' | 'denied' | 'failed'

export interface MasterAuditEvent {
  requestId: string
  credentialId: string | null
  credentialLabel: string | null
  toolName: string | null
  action: string
  targetType?: string
  targetId?: string
  targetStudentId?: string
  result: MasterAuditResult
  errorCategory?: string
  reason?: string
  changedFields?: string[]
  beforeSummary?: Record<string, unknown>
  afterSummary?: Record<string, unknown>
  relatedVersion?: string
  relatedTaskId?: string
}

export const MCP_MAX_REQUEST_BYTES = 256_000
export const MCP_CONFIRMATION_TTL_MS = 10 * 60 * 1000
export const MASTER_API_LIMIT = { bucket: 'mcp-api', limit: 120, windowSeconds: 60 } as const
export const MASTER_ANON_LIMIT = { bucket: 'mcp-anon', limit: 60, windowSeconds: 60 } as const

export const MASTER_SERVER_INFO = {
  name: 'stracker-master-mcp',
  version: '1.0.0'
} as const
