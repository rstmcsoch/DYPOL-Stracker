import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, {
  TURNSTILE_BREAK_MS,
  TURNSTILE_BREAK_SECONDS,
  TURNSTILE_CLEARANCE_COOKIE,
  TURNSTILE_CLEARANCE_HEADER
} from '../_lib/control-routes/turnstile-clearance.js'
import systemRouter from './system.js'

function fakeRes() {
  const headers: Record<string, string | string[]> = {}
  const res = {
    statusCode: 200,
    headersSent: false,
    body: undefined as Record<string, unknown> | undefined,
    headers,
    setHeader(key: string, value: string | string[]) {
      headers[key.toLowerCase()] = value
    },
    end(chunk?: string) {
      res.body = chunk ? JSON.parse(chunk) as Record<string, unknown> : undefined
    }
  }
  return res
}

function extractCookiePair(setCookie: string | string[] | undefined): string {
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return (first ?? '').split(';')[0] ?? ''
}

describe('15-minute Turnstile clearance API (/api/control/system?route=turnstile-clearance)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-20T05:00:00.000Z'))
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-secret-key-for-hmac')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('POST mints an HttpOnly signed cookie (Max-Age=900) + 64-hex nonce for a fixed 15-minute break', async () => {
    const res = fakeRes()
    await systemRouter({
      method: 'POST',
      url: '/api/control/system?route=turnstile-clearance',
      headers: { 'user-agent': 'Mozilla/5.0 TestBrowser', 'x-forwarded-proto': 'https', host: 'dypol-stracker.vercel.app' },
      body: { verified: true, action: 'login' }
    } as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({
      ok: true,
      cleared: true,
      remainingMs: TURNSTILE_BREAK_MS
    })
    expect(String(res.body?.nonce)).toMatch(/^[0-9a-f]{64}$/)

    const setCookie = String(res.headers['set-cookie'] ?? '')
    expect(setCookie).toContain(`${TURNSTILE_CLEARANCE_COOKIE}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain(`Max-Age=${TURNSTILE_BREAK_SECONDS}`)
  })

  it('GET stays cleared during the 15-minute window without extending expiry, then expires at exactly 15 minutes', async () => {
    const postRes = fakeRes()
    await handler({
      method: 'POST',
      url: '/api/control/system?route=turnstile-clearance',
      headers: { 'user-agent': 'Mozilla/5.0 TestBrowser' },
      body: { verified: true, action: 'passkey' }
    } as never, postRes as never)

    const cookie = extractCookiePair(postRes.headers['set-cookie'])
    const nonce = String(postRes.body?.nonce)
    const originalExpiresAt = Number(postRes.body?.expiresAt)

    // 10 minutes later: still cleared, and expiresAt is NOT extended (fixed window).
    vi.advanceTimersByTime(10 * 60 * 1000)
    const midRes = fakeRes()
    await handler({
      method: 'GET',
      url: '/api/control/system?route=turnstile-clearance',
      headers: {
        cookie,
        'user-agent': 'Mozilla/5.0 TestBrowser',
        [TURNSTILE_CLEARANCE_HEADER]: nonce
      }
    } as never, midRes as never)

    expect(midRes.statusCode).toBe(200)
    expect(midRes.body).toMatchObject({
      ok: true,
      cleared: true,
      expiresAt: originalExpiresAt,
      remainingMs: 5 * 60 * 1000
    })
    expect(midRes.headers['set-cookie']).toBeUndefined()

    // 5 more minutes (total 15 minutes): expired and cookie is cleared.
    vi.advanceTimersByTime(5 * 60 * 1000)
    const expRes = fakeRes()
    await handler({
      method: 'GET',
      url: '/api/control/system?route=turnstile-clearance',
      headers: {
        cookie,
        'user-agent': 'Mozilla/5.0 TestBrowser',
        [TURNSTILE_CLEARANCE_HEADER]: nonce
      }
    } as never, expRes as never)

    expect(expRes.body).toMatchObject({ ok: true, cleared: false, reason: 'expired' })
    expect(String(expRes.headers['set-cookie'])).toContain('Max-Age=0')
  })

  it('GET fails immediately when cookies are deleted, when page reloads (nonce missing/wrong), when cookie is tampered, or when User-Agent changes', async () => {
    const postRes = fakeRes()
    await handler({
      method: 'POST',
      url: '/api/control/system?route=turnstile-clearance',
      headers: { 'user-agent': 'BrowserA' },
      body: { verified: true, action: 'signup' }
    } as never, postRes as never)

    const cookie = extractCookiePair(postRes.headers['set-cookie'])
    const nonce = String(postRes.body?.nonce)

    // 1. Cookies deleted (no Cookie header)
    const noCookie = fakeRes()
    await handler({
      method: 'GET',
      headers: { 'user-agent': 'BrowserA', [TURNSTILE_CLEARANCE_HEADER]: nonce }
    } as never, noCookie as never)
    expect(noCookie.body).toMatchObject({ ok: true, cleared: false, reason: 'cookie_missing' })

    // 2. Page reloaded or tab closed/reopened (cookie still in browser, but in-memory nonce gone)
    const noNonce = fakeRes()
    await handler({
      method: 'GET',
      headers: { cookie, 'user-agent': 'BrowserA' }
    } as never, noNonce as never)
    expect(noNonce.body).toMatchObject({ ok: true, cleared: false, reason: 'nonce_mismatch' })

    // 3. Wrong nonce
    const wrongNonce = fakeRes()
    await handler({
      method: 'GET',
      headers: { cookie, 'user-agent': 'BrowserA', [TURNSTILE_CLEARANCE_HEADER]: 'f'.repeat(64) }
    } as never, wrongNonce as never)
    expect(wrongNonce.body).toMatchObject({ ok: true, cleared: false, reason: 'nonce_mismatch' })

    // 4. Tampered cookie signature
    const tampered = fakeRes()
    await handler({
      method: 'GET',
      headers: { cookie: `${cookie}tampered`, 'user-agent': 'BrowserA', [TURNSTILE_CLEARANCE_HEADER]: nonce }
    } as never, tampered as never)
    expect(tampered.body).toMatchObject({ ok: true, cleared: false, reason: 'invalid_signature' })

    // 5. Cross-browser replay (different User-Agent)
    const diffUa = fakeRes()
    await handler({
      method: 'GET',
      headers: { cookie, 'user-agent': 'BrowserB', [TURNSTILE_CLEARANCE_HEADER]: nonce }
    } as never, diffUa as never)
    expect(diffUa.body).toMatchObject({ ok: true, cleared: false, reason: 'ua_mismatch' })
  })

  it('rejects unverified POST and clears cookie on DELETE', async () => {
    const badPost = fakeRes()
    await handler({ method: 'POST', headers: {}, body: { action: 'login' } } as never, badPost as never)
    expect(badPost.statusCode).toBe(400)

    const delRes = fakeRes()
    await handler({ method: 'DELETE', headers: {} } as never, delRes as never)
    expect(delRes.statusCode).toBe(200)
    expect(String(delRes.headers['set-cookie'])).toContain('Max-Age=0')
  })
})
