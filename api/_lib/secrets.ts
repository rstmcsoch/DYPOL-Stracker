import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { ApiError } from './http.js'
import { credentialEncryptionKey, credentialEncryptionStatus } from './server-config.js'
import { logAIEvent } from './diagnostics.js'
import { redactPotentialSecrets } from '../../src/lib/ai/sanitize.js'
export { redactPotentialSecrets }

function encryptionKey(): Buffer {
  const key = credentialEncryptionKey()
  if (!key) {
    // Log whether the key is missing or malformed — never the value — and expose the same safe
    // reason code to the client so Settings can name the actual problem.
    const reason = credentialEncryptionStatus() === 'missing' ? 'credential_encryption_missing' : 'credential_encryption_invalid'
    logAIEvent('warn', 'ai_credential_store_not_configured', { reason })
    throw new ApiError(503, 'credential_store_unavailable', 'Secure AI credential storage is not configured. Contact the Stracker administrator.', { reason })
  }
  return key
}

export function encryptCredential(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Versioned, authenticated envelope; changing the server key can be managed by
  // incrementing the version and retaining a short-lived decrypt key ring.
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`
}

export function decryptCredential(envelope: string): string {
  const [version, ivPart, tagPart, ciphertextPart, extra] = envelope.split('.')
  if (version !== 'v1' || !ivPart || !tagPart || !ciphertextPart || extra) {
    throw new ApiError(500, 'credential_unreadable', 'This saved provider credential could not be opened. Remove and reconnect it.')
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    throw new ApiError(500, 'credential_unreadable', 'This saved provider credential could not be opened. Remove and reconnect it.')
  }
}

export function maskedCredential(key: string): string {
  const suffix = key.slice(-4)
  return `••••••••••••${suffix}`
}
