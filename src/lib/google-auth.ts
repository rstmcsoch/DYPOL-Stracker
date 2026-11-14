import { GENERIC_SUSPENDED_MESSAGE } from './account-notices'
import { useEffect, useState } from 'react'
import { safeAppPath } from './safe-path'

/**
 * "Continue with Google" support.
 *
 * The button is shown only when the Supabase project actually has the Google provider
 * switched on. That is read at runtime from the public Auth settings endpoint
 * (`GET /auth/v1/settings` → `external.google`), so the button appears by itself once the
 * owner enables Google in the Supabase dashboard and never shows as a broken button before
 * that. The answer is cached briefly in memory and in sessionStorage.
 *
 * `VITE_GOOGLE_AUTH_FORCE_VISIBLE=1` forces the button on for local design builds only; it is
 * not set on Vercel. Clicking still re-checks the provider, so a forced button fails politely.
 */

export const GOOGLE_AUTH_CACHE_KEY = 'stracker-google-auth-v1'
export const GOOGLE_AUTH_CACHE_MS = 5 * 60_000
export const OAUTH_NEXT_KEY = 'stracker-oauth-next'
export const AUTH_CALLBACK_PATH = '/auth/callback'
export const GOOGLE_UNAVAILABLE_MESSAGE = 'Google sign-in isn’t available right now. Please use your email and password instead.'

type CacheEntry = { enabled: boolean; at: number }
let memoryCache: CacheEntry | null = null
let inFlight: Promise<boolean> | null = null

export function googleAuthForcedVisible(): boolean {
  return import.meta.env.VITE_GOOGLE_AUTH_FORCE_VISIBLE === '1'
}

function readCache(now: number): CacheEntry | null {
  if (memoryCache && now - memoryCache.at < GOOGLE_AUTH_CACHE_MS) return memoryCache
  try {
    const raw = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(GOOGLE_AUTH_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CacheEntry>
    if (typeof parsed.enabled !== 'boolean' || typeof parsed.at !== 'number') return null
    if (now - parsed.at >= GOOGLE_AUTH_CACHE_MS || parsed.at > now) return null
    memoryCache = { enabled: parsed.enabled, at: parsed.at }
    return memoryCache
  } catch {
    return null
  }
}

function writeCache(entry: CacheEntry) {
  memoryCache = entry
  try { sessionStorage.setItem(GOOGLE_AUTH_CACHE_KEY, JSON.stringify(entry)) } catch { /* storage may be unavailable */ }
}

/** Test hook: forget any cached answer. */
export function resetGoogleAuthCache() {
  memoryCache = null
  inFlight = null
  try { sessionStorage.removeItem(GOOGLE_AUTH_CACHE_KEY) } catch { /* ignore */ }
}

/** Reads `external.google` from the project's public Auth settings. Any failure means "not available". */
export async function fetchGoogleAuthEnabled(options: { fresh?: boolean; fetcher?: typeof fetch } = {}): Promise<boolean> {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url || !key) return false
  const now = Date.now()
  if (!options.fresh) {
    const cached = readCache(now)
    if (cached) return cached.enabled
    if (inFlight) return inFlight
  }
  const fetcher = options.fetcher ?? fetch
  const request = (async () => {
    try {
      const response = await fetcher(`${url.replace(/\/+$/, '')}/auth/v1/settings`, { headers: { apikey: key }, cache: 'no-store' })
      if (!response.ok) return false
      const body = await response.json() as { external?: Record<string, unknown> }
      const enabled = body?.external?.google === true
      writeCache({ enabled, at: Date.now() })
      return enabled
    } catch {
      return false
    } finally {
      inFlight = null
    }
  })()
  if (!options.fresh) inFlight = request
  return request
}

/** True once the Google provider is confirmed enabled (or forced for a local design build). */
export function useGoogleAuthAvailable(): boolean {
  const [enabled, setEnabled] = useState(() => googleAuthForcedVisible() || readCache(Date.now())?.enabled === true)
  useEffect(() => {
    if (googleAuthForcedVisible()) return
    let active = true
    void fetchGoogleAuthEnabled().then(value => { if (active) setEnabled(value) })
    return () => { active = false }
  }, [])
  return enabled
}

/** Same-origin path to open after the Google round trip; auth pages fall back to the notebook home. */
export function oauthNextPath(requested: string | null | undefined): string {
  const safe = safeAppPath(requested ?? '/')
  if (/^\/(login|signup|reset-password|auth\/)/.test(safe)) return '/'
  return safe
}

export function rememberOAuthNext(path: string) {
  try { sessionStorage.setItem(OAUTH_NEXT_KEY, oauthNextPath(path)) } catch { /* ignore */ }
}

export function takeOAuthNext(): string {
  try {
    const value = sessionStorage.getItem(OAUTH_NEXT_KEY)
    sessionStorage.removeItem(OAUTH_NEXT_KEY)
    return oauthNextPath(value)
  } catch {
    return '/'
  }
}

export interface OAuthCallbackProblem {
  kind: 'cancelled' | 'unavailable' | 'failed' | 'suspended'
  message: string
}

/**
 * Reads an OAuth error that Supabase or Google put on the callback URL (query or hash).
 * Raw provider text is never shown; it is mapped to a short, friendly message.
 */
export function parseOAuthCallbackError(search: string, hash: string): OAuthCallbackProblem | null {
  const params = new URLSearchParams(search.replace(/^\?/, ''))
  const hashParams = new URLSearchParams(hash.replace(/^#/, ''))
  const error = params.get('error') ?? hashParams.get('error')
  const code = params.get('error_code') ?? hashParams.get('error_code') ?? ''
  const description = params.get('error_description') ?? hashParams.get('error_description') ?? ''
  if (!error && !code && !description) return null
  return describeOAuthError(`${error ?? ''} ${code} ${description}`)
}

export function describeOAuthError(raw: string): OAuthCallbackProblem {
  const text = raw.toLowerCase()
  // Supabase Auth refuses a banned account with error_code=user_banned (often alongside
  // error=access_denied), so this is checked before the cancellation pattern.
  if (/user_banned|user is banned|banned/.test(text)) {
    return { kind: 'suspended', message: GENERIC_SUSPENDED_MESSAGE }
  }
  if (/access_denied|cancel|denied|user_cancelled/.test(text)) {
    return { kind: 'cancelled', message: 'Google sign-in was cancelled. You can try again, or use your email and password.' }
  }
  if (/provider is not enabled|unsupported provider|provider_disabled|validation_failed|not enabled/.test(text)) {
    return { kind: 'unavailable', message: GOOGLE_UNAVAILABLE_MESSAGE }
  }
  if (/signup.*(disabled|not allowed)|signups not allowed/.test(text)) {
    return { kind: 'failed', message: 'New Stracker accounts can’t be created right now. If you already have an account, log in with email.' }
  }
  return { kind: 'failed', message: 'We couldn’t finish signing you in with Google. Please try again, or use your email and password.' }
}

/** Auth providers attached to a Supabase user (`app_metadata.providers`, falling back to `provider`). */
export function userAuthProviders(appMetadata: Record<string, unknown> | undefined | null): string[] {
  const list = Array.isArray(appMetadata?.providers) ? appMetadata.providers.filter((item): item is string => typeof item === 'string') : []
  if (list.length) return [...new Set(list)]
  return typeof appMetadata?.provider === 'string' ? [appMetadata.provider] : []
}

/** Display name from Supabase user metadata: Stracker's own field first, then the Google profile name. */
export function displayNameFromMetadata(metadata: Record<string, unknown> | undefined | null): string {
  for (const key of ['display_name', 'full_name', 'name'] as const) {
    const value = metadata?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 100)
  }
  return ''
}
