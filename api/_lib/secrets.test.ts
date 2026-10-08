import { afterEach,describe,expect,it } from 'vitest'
import { decryptCredential,encryptCredential,redactPotentialSecrets } from './secrets'

const priorKey = process.env.AI_CREDENTIALS_ENCRYPTION_KEY

afterEach(() => {
  if (priorKey === undefined) delete process.env.AI_CREDENTIALS_ENCRYPTION_KEY
  else process.env.AI_CREDENTIALS_ENCRYPTION_KEY = priorKey
})

describe('server-side provider credential protection',() => {
  it('uses authenticated encryption and never stores the plaintext in the envelope',() => {
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY = '11'.repeat(32)
    const secret = 'sk-test-provider-secret-value-123456789'
    const encrypted = encryptCredential(secret)
    expect(encrypted).toMatch(/^v1\./)
    expect(encrypted).not.toContain(secret)
    expect(decryptCredential(encrypted)).toBe(secret)
  })

  it('fails closed when an encrypted credential is opened with a different key',() => {
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY = '22'.repeat(32)
    const encrypted = encryptCredential('provider-secret-123456789')
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY = '33'.repeat(32)
    expect(() => decryptCredential(encrypted)).toThrow(/could not be opened/)
  })

  it('requires a correctly sized encryption key',() => {
    delete process.env.AI_CREDENTIALS_ENCRYPTION_KEY
    expect(() => encryptCredential('secret')).toThrow(/not configured/)
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY = 'too-short'
    expect(() => encryptCredential('secret')).toThrow(/not configured/)
  })

  it('redacts common provider keys and bearer credentials before persistence',() => {
    const value = 'Key sk-ant-123456789012345678901234; Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnopqrstuvwx'
    const safe = redactPotentialSecrets(value)
    expect(safe).not.toContain('sk-ant-')
    expect(safe).not.toContain('eyJhbGci')
    expect(safe).toContain('[redacted credential]')
  })
})
