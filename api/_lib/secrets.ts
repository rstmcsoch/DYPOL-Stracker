import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { ApiError } from './http.js'
import { redactPotentialSecrets } from '../../src/lib/ai/sanitize.js'
export { redactPotentialSecrets }

const KEY_BYTES = 32

function encryptionKey(): Buffer {
  const raw = process.env.AI_CREDENTIALS_ENCRYPTION_KEY?.trim()
  if (!raw) throw new ApiError(503, 'credential_store_unavailable', 'Secure AI credential storage is not configured. Contact the Stracker administrator.')
  let key: Buffer
  if (/^[a-f\d]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex')
  else {
    try { key = Buffer.from(raw, 'base64') }
    catch { throw new ApiError(503, 'credential_store_unavailable', 'Secure AI credential storage is not configured. Contact the Stracker administrator.') }
  }
  if (key.byteLength !== KEY_BYTES) throw new ApiError(503, 'credential_store_unavailable', 'Secure AI credential storage is not configured. Contact the Stracker administrator.')
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
