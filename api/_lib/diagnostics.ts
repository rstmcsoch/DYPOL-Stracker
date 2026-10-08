import { randomUUID } from 'node:crypto'
import { redactPotentialSecrets } from '../../src/lib/ai/sanitize.js'

/**
 * Structured server diagnostics for Stracker AI.
 *
 * Logs are one JSON object per line. Only the explicitly listed fields are emitted, values are
 * redacted, and any field whose name suggests a credential is dropped entirely. Never pass API
 * keys, decrypted credentials, authorization headers, cookies, or raw provider payloads here.
 */

export type DiagnosticValue = string | number | boolean | null | undefined
const SENSITIVE_FIELD = /key|token|secret|auth|cookie|password|credential|header|body|payload/i
const MAX_TEXT = 400

export function newReference(prefix = 'req'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

function cleanValue(value: DiagnosticValue): DiagnosticValue {
  if (typeof value === 'string') return redactPotentialSecrets(value).replace(/\s+/g, ' ').slice(0, MAX_TEXT)
  return value
}

export function logAIEvent(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, DiagnosticValue> = {}): void {
  const safe: Record<string, DiagnosticValue> = {}
  for (const [name, value] of Object.entries(fields)) {
    if (SENSITIVE_FIELD.test(name)) continue
    safe[name] = cleanValue(value)
  }
  const line = JSON.stringify({ ts: new Date().toISOString(), level, source: 'stracker-ai', event, ...safe })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.info(line)
}

/**
 * Describe an unexpected exception without leaking provider payloads or secrets: the error class,
 * a redacted message, and the top application frames (file and function names only).
 */
export function describeUnexpectedError(error: unknown): Record<string, DiagnosticValue> {
  if (!(error instanceof Error)) return { errorType: typeof error }
  const frames = (error.stack ?? '')
    .split('\n')
    .slice(1, 6)
    .map(line => redactPotentialSecrets(line.trim()).replace(/\(.*[\\/]([^\\/]+:\d+:\d+)\)/, '($1)').slice(0, 160))
  return {
    errorType: error.name,
    errorMessage: redactPotentialSecrets(error.message).slice(0, MAX_TEXT),
    errorFrames: frames.join(' | ')
  }
}
