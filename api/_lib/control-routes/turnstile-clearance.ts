import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { ApiRequest, ApiResponse } from '../http.js'
import { methodNotAllowed, readJson, sendJson } from '../http.js'

/**
 * End-to-end 15-minute individual Turnstile break.
 *
 * Security model:
 *  - Fixed 15-minute window (900 seconds) from the moment of Turnstile verification.
 *    Activity inside the 15 minutes NEVER extends or refreshes the expiry.
 *  - Bound to BOTH:
 *      1. An HttpOnly, SameSite=Lax (and Secure on HTTPS) HMAC-SHA256 signed cookie
 *         (`dypol_ts_clr`, Max-Age=900). Clearing cookies or site cache/data deletes
 *         this cookie so the very next check fails with `cookie_missing`.
 *      2. A 256-bit random `nonce` returned in JSON and held ONLY in browser JS memory
 *         (never localStorage/sessionStorage). Closing the tab OR reloading the page
 *         destroys the in-memory nonce so the very next check fails with `nonce_mismatch`.
 *      3. A SHA-256 hash of the browser's User-Agent, blocking cross-browser cookie replay.
 *  - Routed through `api/control/system.ts?route=turnstile-clearance` to stay within
 *    Vercel Hobby's 12 serverless-function limit.
 */

export const TURNSTILE_CLEARANCE_COOKIE = 'dypol_ts_clr'
export const TURNSTILE_BREAK_SECONDS = 15 * 60
export const TURNSTILE_BREAK_MS = TURNSTILE_BREAK_SECONDS * 1000
export const TURNSTILE_CLEARANCE_HEADER = 'x-turnstile-clearance'

const MAX_ACTION_LENGTH = 48
const NONCE_PATTERN = /^[0-9a-f]{64}$/

export interface ClearancePayload {
  v: 1
  iat: number
  exp: number
  nonceHash: string
  uaHash: string
  action: string
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function signingKey(): Buffer | null {
  const raw = (
    process.env.TURNSTILE_CLEARANCE_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.TURNSTILE_SECRET_KEY
    || ''
  ).trim()
  if (!raw) return null
  return createHmac('sha256', raw).update('dypol-turnstile-clearance-key-v1').digest()
}

function signPayload(payload: ClearancePayload, key: Buffer): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', key).update(encoded).digest('base64url')
  return `${encoded}.${sig}`
}

export function verifySignedCookie(
  rawCookie: string | null | undefined,
  key: Buffer
): { ok: true; payload: ClearancePayload } | { ok: false; reason: 'cookie_missing' | 'invalid_signature' | 'malformed' } {
  if (!rawCookie || typeof rawCookie !== 'string') return { ok: false, reason: 'cookie_missing' }
  const dot = rawCookie.indexOf('.')
  if (dot <= 0 || dot !== rawCookie.lastIndexOf('.')) return { ok: false, reason: 'malformed' }
  const encoded = rawCookie.slice(0, dot)
  const providedSig = rawCookie.slice(dot + 1)
  if (!encoded || !providedSig) return { ok: false, reason: 'malformed' }

  const expectedSig = createHmac('sha256', key).update(encoded).digest('base64url')
  const a = Buffer.from(providedSig, 'utf8')
  const b = Buffer.from(expectedSig, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'invalid_signature' }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<ClearancePayload>
    if (
      parsed.v !== 1
      || typeof parsed.iat !== 'number' || !Number.isFinite(parsed.iat)
      || typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp)
      || typeof parsed.nonceHash !== 'string' || !NONCE_PATTERN.test(parsed.nonceHash)
      || typeof parsed.uaHash !== 'string' || !NONCE_PATTERN.test(parsed.uaHash)
      || typeof parsed.action !== 'string'
    ) {
      return { ok: false, reason: 'malformed' }
    }
    return {
      ok: true,
      payload: {
        v: 1,
        iat: parsed.iat,
        exp: parsed.exp,
        nonceHash: parsed.nonceHash,
        uaHash: parsed.uaHash,
        action: parsed.action
      }
    }
  } catch {
    return { ok: false, reason: 'malformed' }
  }
}

export function readCookie(cookieHeader: string | string[] | undefined, name: string): string | null {
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader
  if (!raw) return null
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim() || null
    }
  }
  return null
}

function isHttpsRequest(req: ApiRequest): boolean {
  const proto = req.headers['x-forwarded-proto']
  if (typeof proto === 'string' && proto.split(',')[0]?.trim().toLowerCase() === 'https') return true
  const host = typeof req.headers.host === 'string' ? req.headers.host.toLowerCase() : ''
  if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) return true
  return process.env.NODE_ENV === 'production'
}

function buildCookieHeader(value: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `${TURNSTILE_CLEARANCE_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

function userAgentHash(req: ApiRequest): string {
  const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 512) : ''
  return sha256Hex(`ua:${ua}`)
}

function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

function readHeaderValue(req: ApiRequest, name: string): string {
  const raw = req.headers[name] ?? req.headers[name.toLowerCase()]
  if (Array.isArray(raw)) return (raw[0] ?? '').trim()
  return typeof raw === 'string' ? raw.trim() : ''
}

export default async function turnstileClearanceHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  res.setHeader('X-Robots-Tag', 'noindex')
  const method = (req.method ?? 'GET').toUpperCase()
  const secure = isHttpsRequest(req)

  if (method === 'DELETE') {
    res.setHeader('Set-Cookie', buildCookieHeader('', 0, secure))
    sendJson(res, 200, { ok: true, cleared: false })
    return
  }

  const key = signingKey()
  if (!key) {
    sendJson(res, 503, { ok: false, cleared: false, reason: 'unavailable' })
    return
  }

  if (method === 'POST') {
    let body: Record<string, unknown> = {}
    try {
      body = await readJson(req, 4_000)
    } catch {
      sendJson(res, 400, { ok: false, cleared: false, reason: 'invalid_request' })
      return
    }
    if (body.verified !== true) {
      sendJson(res, 400, { ok: false, cleared: false, reason: 'verification_required' })
      return
    }
    const rawAction = typeof body.action === 'string' ? body.action.trim() : 'default'
    const action = rawAction.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, MAX_ACTION_LENGTH) || 'default'

    const now = Date.now()
    const exp = now + TURNSTILE_BREAK_MS
    const nonce = randomBytes(32).toString('hex')
    const payload: ClearancePayload = {
      v: 1,
      iat: now,
      exp,
      nonceHash: sha256Hex(`nonce:${nonce}`),
      uaHash: userAgentHash(req),
      action
    }
    const signed = signPayload(payload, key)
    res.setHeader('Set-Cookie', buildCookieHeader(signed, TURNSTILE_BREAK_SECONDS, secure))
    sendJson(res, 200, {
      ok: true,
      cleared: true,
      nonce,
      issuedAt: now,
      expiresAt: exp,
      remainingMs: TURNSTILE_BREAK_MS
    })
    return
  }

  if (method === 'GET') {
    const rawCookie = readCookie(req.headers.cookie, TURNSTILE_CLEARANCE_COOKIE)
    const verified = verifySignedCookie(rawCookie, key)
    if (!verified.ok) {
      if (rawCookie) res.setHeader('Set-Cookie', buildCookieHeader('', 0, secure))
      sendJson(res, 200, { ok: true, cleared: false, reason: verified.reason })
      return
    }

    const now = Date.now()
    const { payload } = verified
    if (now >= payload.exp || payload.exp - payload.iat > TURNSTILE_BREAK_MS + 1_000) {
      res.setHeader('Set-Cookie', buildCookieHeader('', 0, secure))
      sendJson(res, 200, { ok: true, cleared: false, reason: 'expired' })
      return
    }

    const headerNonce = readHeaderValue(req, TURNSTILE_CLEARANCE_HEADER)
    if (!NONCE_PATTERN.test(headerNonce) || !constantTimeHexEqual(sha256Hex(`nonce:${headerNonce}`), payload.nonceHash)) {
      sendJson(res, 200, { ok: true, cleared: false, reason: 'nonce_mismatch' })
      return
    }

    if (!constantTimeHexEqual(userAgentHash(req), payload.uaHash)) {
      sendJson(res, 200, { ok: true, cleared: false, reason: 'ua_mismatch' })
      return
    }

    // Never extend or re-issue the cookie: the 15-minute break is strictly fixed.
    sendJson(res, 200, {
      ok: true,
      cleared: true,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
      remainingMs: Math.max(0, payload.exp - now)
    })
    return
  }

  methodNotAllowed(res, ['GET', 'POST', 'DELETE'])
}
