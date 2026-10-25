import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { issueModelApproval, verifyModelApproval } from './model-approval'
import { AI_CREDENTIALS_ENCRYPTION_KEY_VAR as VAR } from './server-config'

const subject = { userId: 'u1', baseUrl: 'https://integrate.api.nvidia.com/v1', protocol: 'openai-compatible', modelId: 'z-ai/glm-5.3', apiKey: 'nvapi-secret' }
let saved: string | undefined

describe('custom model approval token', () => {
  beforeEach(() => { saved = process.env[VAR]; process.env[VAR] = randomBytes(32).toString('base64') })
  afterEach(() => { if (saved === undefined) delete process.env[VAR]; else process.env[VAR] = saved })

  it('verifies only the same user, endpoint, model and key, and never contains the key', () => {
    const token = issueModelApproval(subject)
    expect(token).toBeTruthy()
    expect(token).not.toContain('nvapi')
    expect(verifyModelApproval(token!, subject)).toBe(true)
    expect(verifyModelApproval(token!, { ...subject, modelId: 'other' })).toBe(false)
    expect(verifyModelApproval(token!, { ...subject, apiKey: 'different' })).toBe(false)
    expect(verifyModelApproval(token!, { ...subject, userId: 'u2' })).toBe(false)
    expect(verifyModelApproval(token!, { ...subject, baseUrl: 'https://evil.example/v1' })).toBe(false)
    expect(verifyModelApproval(token!, subject, Date.now() + 16 * 60_000)).toBe(false)
    expect(verifyModelApproval(`${token!}x`, subject)).toBe(false)
    expect(verifyModelApproval(undefined, subject)).toBe(false)
  })
})
