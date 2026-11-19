import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { TURNSTILE_TEST_SECRET, turnstileSecret, verifyTurnstile } from './turnstile-verify.js'

const ok = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 })

describe('turnstileSecret', () => {
  it('requires the env var in production and uses the always-pass test secret elsewhere', () => {
    expect(turnstileSecret({ VERCEL_ENV: 'production' })).toBeNull()
    expect(turnstileSecret({ VERCEL_ENV: 'production', TURNSTILE_SECRET_KEY: ' s ' })).toBe('s')
    expect(turnstileSecret({ VERCEL_ENV: 'preview' })).toBe(TURNSTILE_TEST_SECRET)
    expect(turnstileSecret({})).toBe(TURNSTILE_TEST_SECRET)
  })
})

describe('verifyTurnstile', () => {
  const prod = { VERCEL_ENV: 'production', TURNSTILE_SECRET_KEY: 'real-secret' }
  it('accepts a confirmed token with the expected action', async () => {
    await expect(verifyTurnstile('t', 'contact', { env: prod, fetcher: ok({ success: true, action: 'contact', hostname: 'dypol-stracker.vercel.app' }) })).resolves.toBeUndefined()
  })
  it('rejects a token issued for another form', async () => {
    await expect(verifyTurnstile('t', 'contact', { env: prod, fetcher: ok({ success: true, action: 'login' }) })).rejects.toMatchObject({ status: 400, code: 'captcha_failed' })
  })
  it('rejects a production token with a missing or empty action', async () => {
    await expect(verifyTurnstile('t', 'contact', { env: prod, fetcher: ok({ success: true }) })).rejects.toMatchObject({ status: 400, code: 'captcha_failed' })
    await expect(verifyTurnstile('t', 'contact', { env: prod, fetcher: ok({ success: true, action: '' }) })).rejects.toMatchObject({ status: 400, code: 'captcha_failed' })
  })
  it('rejects a production token issued for another hostname', async () => {
    await expect(verifyTurnstile('t', 'contact', { env: prod, fetcher: ok({ success: true, action: 'contact', hostname: 'evil.example' }) })).rejects.toMatchObject({ status: 400, code: 'captcha_failed' })
  })
  it('rejects unconfirmed, missing and oversized tokens', async () => {
    await expect(verifyTurnstile('t', 'contact', { env: prod, fetcher: ok({ success: false }) })).rejects.toMatchObject({ status: 400 })
    await expect(verifyTurnstile(undefined, 'contact', { env: prod, fetcher: ok({ success: true }) })).rejects.toMatchObject({ status: 400 })
    await expect(verifyTurnstile('x'.repeat(2049), 'contact', { env: prod, fetcher: ok({ success: true }) })).rejects.toMatchObject({ status: 400 })
  })
  it('answers 503 when Cloudflare cannot be reached', async () => {
    await expect(verifyTurnstile('t', 'contact', { env: prod, fetcher: async () => { throw new Error('down') } })).rejects.toMatchObject({ status: 503, code: 'captcha_unavailable' })
  })
  it('never ships a real secret in source', () => {
    const source = readFileSync(new URL('./turnstile-verify.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/0x4AAAAAA[A-Za-z0-9_-]{10,}/)
  })
})
