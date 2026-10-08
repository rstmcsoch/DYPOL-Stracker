/**
 * Single source of truth for the server-only configuration the Stracker AI backend requires.
 *
 * The AI functions are BYOK: per-user provider API keys are supplied by each user and stored
 * encrypted. The deployment itself only needs application-level server configuration:
 *
 *   SUPABASE_URL                     Supabase project URL (falls back to VITE_SUPABASE_URL)
 *   SUPABASE_ANON_KEY                public anon/publishable key (falls back to VITE_SUPABASE_ANON_KEY)
 *   SUPABASE_SERVICE_ROLE_KEY        server-only service role key — never exposed to the browser
 *   AI_CREDENTIALS_ENCRYPTION_KEY    64 hex chars (or base64 of 32 bytes) used to encrypt stored keys
 *
 * No global GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / DEEPSEEK_API_KEY / QWEN_API_KEY
 * is required or read: those credentials belong to each user, never to the deployment.
 *
 * Everything in this module reports variable NAMES and booleans only. Secret values are never
 * returned, logged, or included in any status object.
 */

export type ServerConfigReason =
  | 'supabase_server_config_missing'
  | 'supabase_url_invalid'
  | 'credential_encryption_missing'
  | 'credential_encryption_invalid'

export interface ServerConfigStatus {
  /** True only when every server-only requirement is present and well formed. */
  configured: boolean
  checks: { supabaseServerConfig: boolean; credentialEncryption: boolean }
  /** Safe, normalized reason code. Null when configured. Never contains secret values. */
  reason: ServerConfigReason | null
  /** Names of required variables that are not set. Names only — never values. */
  missing: string[]
  /** Names of variables that are set but malformed. Names only — never values. */
  invalid: string[]
}

export interface SupabaseServerConfig {
  url: string
  anonKey: string
  serviceRoleKey: string
}

export const SUPABASE_URL_VAR = 'SUPABASE_URL'
export const SUPABASE_ANON_KEY_VAR = 'SUPABASE_ANON_KEY'
export const SUPABASE_SERVICE_ROLE_KEY_VAR = 'SUPABASE_SERVICE_ROLE_KEY'
export const AI_CREDENTIALS_ENCRYPTION_KEY_VAR = 'AI_CREDENTIALS_ENCRYPTION_KEY'

const URL_FALLBACKS = [SUPABASE_URL_VAR, 'VITE_SUPABASE_URL'] as const
const ANON_FALLBACKS = [SUPABASE_ANON_KEY_VAR, 'VITE_SUPABASE_ANON_KEY'] as const

type Env = Record<string, string | undefined>

function firstPresent(env: Env, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim()
    if (value) return value
  }
  return undefined
}

/**
 * Resolve the Supabase server configuration. The anon key may come from the public VITE_
 * variable (it is browser-safe by design), but the service-role key has no fallback: it must
 * be configured as a server-only variable or the backend correctly refuses to start.
 */
export function supabaseServerConfig(env: Env = process.env): { ok: true; config: SupabaseServerConfig } | { ok: false; reason: ServerConfigReason; missing: string[]; invalid: string[] } {
  const url = firstPresent(env, URL_FALLBACKS)
  const anonKey = firstPresent(env, ANON_FALLBACKS)
  const serviceRoleKey = env[SUPABASE_SERVICE_ROLE_KEY_VAR]?.trim() || undefined
  const missing: string[] = []
  if (!url) missing.push(SUPABASE_URL_VAR)
  if (!anonKey) missing.push(SUPABASE_ANON_KEY_VAR)
  if (!serviceRoleKey) missing.push(SUPABASE_SERVICE_ROLE_KEY_VAR)
  if (missing.length) return { ok: false, reason: 'supabase_server_config_missing', missing, invalid: [] }
  try {
    // Format check only. The URL is public project metadata; the value is never reported.
    new URL(url!)
  } catch {
    return { ok: false, reason: 'supabase_url_invalid', missing: [], invalid: [SUPABASE_URL_VAR] }
  }
  return { ok: true, config: { url: url!, anonKey: anonKey!, serviceRoleKey: serviceRoleKey! } }
}

/** Parse the credential encryption key. Returns null when missing or malformed; never throws. */
export function credentialEncryptionKey(env: Env = process.env): Buffer | null {
  const raw = env[AI_CREDENTIALS_ENCRYPTION_KEY_VAR]?.trim()
  if (!raw) return null
  if (/^[a-f\d]{64}$/i.test(raw)) return Buffer.from(raw, 'hex')
  // Also accept base64 of exactly 32 bytes, matching the original storage format.
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    const key = Buffer.from(raw, 'base64')
    if (key.byteLength === 32) return key
  }
  return null
}

export function credentialEncryptionStatus(env: Env = process.env): 'ok' | 'missing' | 'invalid' {
  if (!env[AI_CREDENTIALS_ENCRYPTION_KEY_VAR]?.trim()) return 'missing'
  return credentialEncryptionKey(env) ? 'ok' : 'invalid'
}

/**
 * Evaluate the complete server-only configuration. Used by the authenticated AI functions
 * (fail closed with a safe public message) and by the public /api/ai/health endpoint so the
 * frontend can tell "backend misconfigured" apart from "user has not connected a provider".
 */
export function evaluateServerConfig(env: Env = process.env): ServerConfigStatus {
  const supabase = supabaseServerConfig(env)
  const encryption = credentialEncryptionStatus(env)
  const checks = { supabaseServerConfig: supabase.ok, credentialEncryption: encryption === 'ok' }
  const missing = [...(supabase.ok ? [] : supabase.missing)]
  const invalid = [...(supabase.ok ? [] : supabase.invalid)]
  if (encryption === 'missing') missing.push(AI_CREDENTIALS_ENCRYPTION_KEY_VAR)
  if (encryption === 'invalid') invalid.push(AI_CREDENTIALS_ENCRYPTION_KEY_VAR)
  const reason: ServerConfigReason | null = !supabase.ok
    ? supabase.reason
    : encryption === 'missing'
      ? 'credential_encryption_missing'
      : encryption === 'invalid'
        ? 'credential_encryption_invalid'
        : null
  return { configured: checks.supabaseServerConfig && checks.credentialEncryption, checks, reason, missing, invalid }
}
