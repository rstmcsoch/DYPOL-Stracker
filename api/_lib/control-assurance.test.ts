import { describe, expect, it } from 'vitest'
import {
  CONTROL_SESSION_MAX_AGE_SECONDS,
  consoleAssurance,
  isSessionExpired,
  latestPasskeyTimestamp,
  sessionAuthenticatedAt
} from './control-policy'

const t = 1_800_000_000
describe('consoleAssurance', () => {
  it('everyone: aal2 with a TOTP code opens the console', () => {
    expect(consoleAssurance('viewer', 'aal2', [{ method: 'password', timestamp: t - 100 }, { method: 'totp', timestamp: t }])).toEqual({ granted: true, method: 'totp', verifiedAt: t, passkeyRefused: false })
  })
  it('aal1 password or Google alone never opens it', () => {
    expect(consoleAssurance('owner', 'aal1', [{ method: 'password', timestamp: t }]).granted).toBe(false)
    expect(consoleAssurance('administrator', 'aal1', [{ method: 'oauth', timestamp: t }]).granted).toBe(false)
  })
  it('a TOTP entry without aal2 is not trusted', () => {
    expect(consoleAssurance('owner', 'aal1', [{ method: 'totp', timestamp: t }]).granted).toBe(false)
  })
  it('owner: passkey (sign-in or WebAuthn MFA) opens it, newest proof wins', () => {
    expect(consoleAssurance('owner', 'aal1', [{ method: 'passkey', timestamp: t }])).toMatchObject({ granted: true, method: 'passkey', verifiedAt: t })
    expect(consoleAssurance('owner', 'aal2', [{ method: 'mfa/webauthn', timestamp: t }])).toMatchObject({ granted: true, method: 'passkey' })
    expect(consoleAssurance('owner', 'aal2', [{ method: 'passkey', timestamp: t - 50 }, { method: 'totp', timestamp: t }])).toMatchObject({ method: 'totp', verifiedAt: t })
  })
  it('non-owners with any passkey ceremony are refused outright', () => {
    for (const role of ['administrator', 'moderator', 'viewer'] as const) {
      expect(consoleAssurance(role, 'aal1', [{ method: 'passkey', timestamp: t }])).toMatchObject({ granted: false, passkeyRefused: true })
      expect(consoleAssurance(role, 'aal2', [{ method: 'totp', timestamp: t }, { method: 'passkey', timestamp: t - 9 }])).toMatchObject({ granted: false, passkeyRefused: true })
      expect(consoleAssurance(role, 'aal2', [{ method: 'mfa/webauthn', timestamp: t }])).toMatchObject({ granted: false, passkeyRefused: true })
    }
  })
  it('ignores malformed amr entries', () => {
    expect(latestPasskeyTimestamp([{ method: 'passkey', timestamp: 'x' }, null, 5])).toBeNull()
    expect(consoleAssurance('owner', 'aal2', 'nope').granted).toBe(false)
  })
})

describe('Control Centre 6-hour absolute session limit', () => {
  it('caps authority sessions at 6 hours (21,600 seconds)', () => {
    expect(CONTROL_SESSION_MAX_AGE_SECONDS).toBe(21_600)
  })

  it('picks the earliest valid authentication timestamp from amr', () => {
    expect(sessionAuthenticatedAt([
      { method: 'totp', timestamp: t - 60 },
      { method: 'password', timestamp: t - 10_000 },
      { method: 'passkey', timestamp: t - 500 }
    ])).toBe(t - 10_000)
    expect(sessionAuthenticatedAt([{ method: 'oauth', timestamp: 'bad' }, null, { method: 'password', timestamp: 0 }])).toBeNull()
    expect(sessionAuthenticatedAt('not-an-array')).toBeNull()
  })

  it('remains active before 6 hours and expires at exactly 6 hours and beyond', () => {
    const startedAt = t - CONTROL_SESSION_MAX_AGE_SECONDS
    expect(isSessionExpired(startedAt, t - 1)).toBe(false)
    expect(isSessionExpired(startedAt, t)).toBe(true)
    expect(isSessionExpired(startedAt, t + 3_600)).toBe(true)
    expect(isSessionExpired(null, t)).toBe(false)
  })
})
