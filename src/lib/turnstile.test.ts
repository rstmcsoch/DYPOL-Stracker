import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { TURNSTILE_PRODUCTION_SITE_KEY, TURNSTILE_TEST_SITE_KEY, turnstileSiteKey } from './turnstile'

describe('Turnstile site key', () => {
  it('uses the production widget only on the production host', () => {
    expect(turnstileSiteKey('dypol-stracker.vercel.app')).toBe(TURNSTILE_PRODUCTION_SITE_KEY)
    expect(turnstileSiteKey('dypol-stracker.vercel.app', TURNSTILE_PRODUCTION_SITE_KEY)).toBe(TURNSTILE_PRODUCTION_SITE_KEY)
  })
  it('falls back to Cloudflare\'s test key on previews and localhost, even if the production key is configured', () => {
    expect(turnstileSiteKey('dypol-stracker-git-x-dypollabs.vercel.app', TURNSTILE_PRODUCTION_SITE_KEY)).toBe(TURNSTILE_TEST_SITE_KEY)
    expect(turnstileSiteKey('localhost')).toBe(TURNSTILE_TEST_SITE_KEY)
  })
  it('lets a deployment override the key with its own widget', () => {
    expect(turnstileSiteKey('preview.example', '0x4AAAAAAOther')).toBe('0x4AAAAAAOther')
  })
  it('never ships a Turnstile secret in the client source', () => {
    const source = readFileSync(new URL('./turnstile.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/secret\s*[:=]\s*['"]0x/i)
    expect(source).not.toMatch(/0x4AAAAAAA[A-Za-z0-9_-]{20,}/)
  })
})

describe('Turnstile CSP', () => {
  it('allows only the official Cloudflare challenge origin for the script and iframe', () => {
    const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as { headers: Array<{ headers: Array<{ key: string; value: string }> }> }
    const csp = vercel.headers.flatMap(entry => entry.headers).find(header => header.key === 'Content-Security-Policy')?.value ?? ''
    expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com;")
    expect(csp).toContain('frame-src https://challenges.cloudflare.com;')
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
  })
})
