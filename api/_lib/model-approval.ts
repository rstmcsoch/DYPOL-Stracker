import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { credentialEncryptionKey } from './server-config.js'

/**
 * Signed proof that a custom-provider model passed a real chat test during discovery. Saving that
 * exact model with the same endpoint, protocol and key marks it connected without a second test.
 * The token holds no secret: only a SHA-256 fingerprint of the key, bound to the user, and it
 * expires after 15 minutes. It is signed with a key derived from the credential encryption key.
 */
const TTL_MS = 15 * 60_000

export interface ApprovalSubject { userId: string; baseUrl: string | null | undefined; protocol: string | undefined; modelId: string; apiKey: string }

function signingKey(): Buffer | null {
  const key = credentialEncryptionKey()
  return key ? createHmac('sha256', key).update('stracker:model-approval:v1').digest() : null
}

function digest(subject: ApprovalSubject, expires: number): string {
  const fingerprint = createHash('sha256').update(subject.apiKey).digest('base64url')
  return [subject.userId, subject.baseUrl ?? '', subject.protocol ?? '', subject.modelId, fingerprint, String(expires)].join('\n')
}

export function issueModelApproval(subject: ApprovalSubject, now = Date.now()): string | null {
  const key = signingKey()
  if (!key) return null
  const expires = now + TTL_MS
  const signature = createHmac('sha256', key).update(digest(subject, expires)).digest('base64url')
  return `${expires}.${signature}`
}

export function verifyModelApproval(token: string | undefined, subject: ApprovalSubject, now = Date.now()): boolean {
  if (!token) return false
  const key = signingKey()
  const [expiresPart, signature, extra] = token.split('.')
  const expires = Number(expiresPart)
  if (!key || !signature || extra !== undefined || !Number.isFinite(expires) || expires < now || expires > now + TTL_MS) return false
  const expected = Buffer.from(createHmac('sha256', key).update(digest(subject, expires)).digest('base64url'))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
