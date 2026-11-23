import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { cleanText } from '../control-policy.js'

/**
 * High-entropy Master MCP tokens. The raw secret is shown once to the Owner
 * and is never stored. Only a SHA-256 verifier is kept, compared in constant time.
 */

export const TOKEN_PREFIX = 'stmcp_'
const TOKEN_BYTES = 32
const HASH_PREFIX = 'stracker-master-mcp-v1:'

export function generateMasterToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`
}

export function hashMasterSecret(value: string): string {
  return createHash('sha256').update(`${HASH_PREFIX}${value}`).digest('hex')
}

export function tokenHint(token: string): string {
  const body = token.startsWith(TOKEN_PREFIX) ? token.slice(TOKEN_PREFIX.length) : token
  return body.slice(-4)
}

/**
 * Compare two hex digests in constant time. Different lengths still run a
 * dummy comparison so a missing row does not short-circuit obviously.
 */
export function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length || a.length === 0) {
    const dummy = Buffer.alloc(32)
    timingSafeEqual(dummy, dummy)
    return false
  }
  return timingSafeEqual(a, b)
}

export function presentedTokenLooksLikeJwt(token: string): boolean {
  const parts = token.split('.')
  return parts.length === 3 && parts.every(part => part.length > 0)
}

export function normalizeDisplayName(value: unknown): string | null {
  const name = cleanText(value, 80)
  return name.length >= 1 ? name : null
}

export function isMasterTokenShape(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (!value.startsWith(TOKEN_PREFIX)) return false
  const body = value.slice(TOKEN_PREFIX.length)
  return body.length >= 32 && body.length <= 64 && /^[A-Za-z0-9_-]+$/.test(body)
}
