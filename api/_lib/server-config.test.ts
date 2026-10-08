import { afterEach, describe, expect, it } from 'vitest'
import {
  AI_CREDENTIALS_ENCRYPTION_KEY_VAR,
  SUPABASE_ANON_KEY_VAR,
  SUPABASE_SERVICE_ROLE_KEY_VAR,
  SUPABASE_URL_VAR,
  credentialEncryptionKey,
  credentialEncryptionStatus,
  evaluateServerConfig,
  supabaseServerConfig
} from './server-config'

const SERVER_VARS = [
  SUPABASE_URL_VAR,
  'VITE_SUPABASE_URL',
  SUPABASE_ANON_KEY_VAR,
  'VITE_SUPABASE_ANON_KEY',
  SUPABASE_SERVICE_ROLE_KEY_VAR,
  AI_CREDENTIALS_ENCRYPTION_KEY_VAR
] as const

const saved: Record<string, string | undefined> = {}
for (const name of SERVER_VARS) saved[name] = process.env[name]

function clearServerEnv() {
  for (const name of SERVER_VARS) delete process.env[name]
}

afterEach(() => {
  clearServerEnv()
  for (const name of SERVER_VARS) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
})

function fullyConfiguredEnv() {
  clearServerEnv()
  process.env[SUPABASE_URL_VAR] = 'https://example.supabase.co'
  process.env[SUPABASE_ANON_KEY_VAR] = 'public-anon-key'
  process.env[SUPABASE_SERVICE_ROLE_KEY_VAR] = 'server-only-service-role-secret'
  process.env[AI_CREDENTIALS_ENCRYPTION_KEY_VAR] = 'ab'.repeat(32)
}

describe('evaluateServerConfig', () => {
  it('reports every missing server-only variable when nothing is configured', () => {
    clearServerEnv()
    const status = evaluateServerConfig()
    expect(status.configured).toBe(false)
    expect(status.reason).toBe('supabase_server_config_missing')
    expect(status.checks).toEqual({ supabaseServerConfig: false, credentialEncryption: false })
    expect(status.missing).toEqual([SUPABASE_URL_VAR, SUPABASE_ANON_KEY_VAR, SUPABASE_SERVICE_ROLE_KEY_VAR, AI_CREDENTIALS_ENCRYPTION_KEY_VAR])
    expect(status.invalid).toEqual([])
  })

  it('reports only the service-role key and encryption key when just the public VITE_ variables are set', () => {
    // The classic deployment mistake: only the browser-safe variables exist in the project.
    clearServerEnv()
    process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
    process.env.VITE_SUPABASE_ANON_KEY = 'public-anon-key'
    const status = evaluateServerConfig()
    expect(status.configured).toBe(false)
    expect(status.reason).toBe('supabase_server_config_missing')
    expect(status.missing).toEqual([SUPABASE_SERVICE_ROLE_KEY_VAR, AI_CREDENTIALS_ENCRYPTION_KEY_VAR])
  })

  it('is configured when all server-only variables are present and well formed', () => {
    fullyConfiguredEnv()
    const status = evaluateServerConfig()
    expect(status.configured).toBe(true)
    expect(status.reason).toBeNull()
    expect(status.missing).toEqual([])
    expect(status.invalid).toEqual([])
    expect(status.checks).toEqual({ supabaseServerConfig: true, credentialEncryption: true })
  })

  it('flags a malformed Supabase URL as invalid without treating it as missing', () => {
    fullyConfiguredEnv()
    process.env[SUPABASE_URL_VAR] = 'not a url'
    const status = evaluateServerConfig()
    expect(status.configured).toBe(false)
    expect(status.reason).toBe('supabase_url_invalid')
    expect(status.invalid).toEqual([SUPABASE_URL_VAR])
    expect(status.missing).toEqual([])
  })

  it('flags a malformed encryption key as invalid and a missing one as missing', () => {
    fullyConfiguredEnv()
    process.env[AI_CREDENTIALS_ENCRYPTION_KEY_VAR] = 'too-short'
    let status = evaluateServerConfig()
    expect(status.configured).toBe(false)
    expect(status.reason).toBe('credential_encryption_invalid')
    expect(status.invalid).toEqual([AI_CREDENTIALS_ENCRYPTION_KEY_VAR])

    delete process.env[AI_CREDENTIALS_ENCRYPTION_KEY_VAR]
    status = evaluateServerConfig()
    expect(status.configured).toBe(false)
    expect(status.reason).toBe('credential_encryption_missing')
    expect(status.missing).toEqual([AI_CREDENTIALS_ENCRYPTION_KEY_VAR])
  })

  it('never includes secret values in the reported status', () => {
    fullyConfiguredEnv()
    process.env[AI_CREDENTIALS_ENCRYPTION_KEY_VAR] = 'cd'.repeat(32)
    const status = evaluateServerConfig()
    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain('server-only-service-role-secret')
    expect(serialized).not.toContain('cd'.repeat(32))
    expect(serialized).not.toContain('public-anon-key')
  })
})

describe('supabaseServerConfig', () => {
  it('resolves values and falls back to the public VITE_ variables for URL and anon key', () => {
    clearServerEnv()
    process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
    process.env.VITE_SUPABASE_ANON_KEY = 'public-anon-key'
    process.env[SUPABASE_SERVICE_ROLE_KEY_VAR] = 'service-role'
    const resolved = supabaseServerConfig()
    expect(resolved.ok).toBe(true)
    if (resolved.ok) {
      expect(resolved.config.url).toBe('https://example.supabase.co')
      expect(resolved.config.anonKey).toBe('public-anon-key')
      expect(resolved.config.serviceRoleKey).toBe('service-role')
    }
  })

  it('fails closed when the service-role key is missing even if the public variables exist', () => {
    clearServerEnv()
    process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
    process.env.VITE_SUPABASE_ANON_KEY = 'public-anon-key'
    const resolved = supabaseServerConfig()
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.missing).toEqual([SUPABASE_SERVICE_ROLE_KEY_VAR])
  })
})

describe('credentialEncryptionKey', () => {
  it('accepts 64 hex characters and base64 of exactly 32 bytes', () => {
    clearServerEnv()
    process.env[AI_CREDENTIALS_ENCRYPTION_KEY_VAR] = 'ef'.repeat(32)
    expect(credentialEncryptionKey()?.byteLength).toBe(32)
    expect(credentialEncryptionStatus()).toBe('ok')

    process.env[AI_CREDENTIALS_ENCRYPTION_KEY_VAR] = Buffer.alloc(32, 7).toString('base64')
    expect(credentialEncryptionKey()?.byteLength).toBe(32)
    expect(credentialEncryptionStatus()).toBe('ok')
  })

  it('returns null for missing, short, or wrongly sized keys', () => {
    clearServerEnv()
    expect(credentialEncryptionKey()).toBeNull()
    expect(credentialEncryptionStatus()).toBe('missing')

    process.env[AI_CREDENTIALS_ENCRYPTION_KEY_VAR] = 'too-short'
    expect(credentialEncryptionKey()).toBeNull()
    expect(credentialEncryptionStatus()).toBe('invalid')

    process.env[AI_CREDENTIALS_ENCRYPTION_KEY_VAR] = Buffer.alloc(31, 7).toString('base64')
    expect(credentialEncryptionKey()).toBeNull()
    expect(credentialEncryptionStatus()).toBe('invalid')
  })
})
