// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_AUTH_CACHE_KEY, GOOGLE_AUTH_CACHE_MS, GOOGLE_UNAVAILABLE_MESSAGE, describeOAuthError, displayNameFromMetadata, fetchGoogleAuthEnabled,
  oauthNextPath, parseOAuthCallbackError, rememberOAuthNext, resetGoogleAuthCache, takeOAuthNext, userAuthProviders
} from './google-auth'

function settingsResponse(google: boolean, ok = true) {
  return { ok, json: async () => ({ external: { email: true, google } }) } as Response
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example-ref.supabase.co/')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key')
  resetGoogleAuthCache()
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

describe('Google provider runtime check', () => {
  it('reads external.google from the public Auth settings with the anon key', async () => {
    const fetcher = vi.fn(async () => settingsResponse(true))
    await expect(fetchGoogleAuthEnabled({ fetcher })).resolves.toBe(true)
    expect(fetcher).toHaveBeenCalledWith('https://example-ref.supabase.co/auth/v1/settings', expect.objectContaining({ headers: { apikey: 'public-anon-key' } }))
  })

  it('stays hidden when the provider is off, the request fails or the body is unexpected', async () => {
    await expect(fetchGoogleAuthEnabled({ fetcher: vi.fn(async () => settingsResponse(false)) })).resolves.toBe(false)
    resetGoogleAuthCache()
    await expect(fetchGoogleAuthEnabled({ fetcher: vi.fn(async () => settingsResponse(true, false)) })).resolves.toBe(false)
    resetGoogleAuthCache()
    await expect(fetchGoogleAuthEnabled({ fetcher: vi.fn(async () => { throw new TypeError('Failed to fetch') }) })).resolves.toBe(false)
    resetGoogleAuthCache()
    await expect(fetchGoogleAuthEnabled({ fetcher: vi.fn(async () => ({ ok: true, json: async () => ({ external: { google: 'yes' } }) }) as unknown as Response) })).resolves.toBe(false)
  })

  it('is false without Supabase configuration and never calls the network', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    const fetcher = vi.fn()
    await expect(fetchGoogleAuthEnabled({ fetcher })).resolves.toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('caches the answer for a short time, and a fresh check bypasses the cache', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-14T06:00:00Z') })
    const fetcher = vi.fn(async () => settingsResponse(false))
    await fetchGoogleAuthEnabled({ fetcher })
    await fetchGoogleAuthEnabled({ fetcher })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.parse(sessionStorage.getItem(GOOGLE_AUTH_CACHE_KEY) ?? '{}').enabled).toBe(false)
    fetcher.mockImplementation(async () => settingsResponse(true))
    await expect(fetchGoogleAuthEnabled({ fetcher, fresh: true })).resolves.toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
    vi.setSystemTime(Date.now() + GOOGLE_AUTH_CACHE_MS + 1)
    fetcher.mockImplementation(async () => settingsResponse(false))
    await expect(fetchGoogleAuthEnabled({ fetcher })).resolves.toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})

describe('OAuth callback errors', () => {
  it('maps a cancelled consent screen to a friendly message', () => {
    const problem = parseOAuthCallbackError('?error=access_denied&error_description=The+user+denied+the+request', '')
    expect(problem?.kind).toBe('cancelled')
    expect(problem?.message).toMatch(/cancelled/)
  })

  it('maps a disabled provider to the "use email" message, from the query or the hash', () => {
    expect(parseOAuthCallbackError('?error=bad_request&error_description=Unsupported+provider%3A+provider+is+not+enabled', '')?.message).toBe(GOOGLE_UNAVAILABLE_MESSAGE)
    expect(parseOAuthCallbackError('', '#error=server_error&error_code=provider_disabled')?.kind).toBe('unavailable')
  })

  it('never echoes raw provider text and returns null for a clean URL', () => {
    const problem = parseOAuthCallbackError('?error=server_error&error_description=<script>secret-detail</script>', '')
    expect(problem?.kind).toBe('failed')
    expect(problem?.message).not.toContain('secret-detail')
    expect(parseOAuthCallbackError('?code=abc', '')).toBeNull()
    expect(describeOAuthError('Signups not allowed for this instance').message).toMatch(/can’t be created/)
  })
})

describe('post-sign-in destination', () => {
  it('only replays same-origin app paths and never returns to an auth page', () => {
    expect(oauthNextPath('/planner')).toBe('/planner')
    expect(oauthNextPath('/control-panel')).toBe('/control-panel')
    expect(oauthNextPath('https://evil.example/')).toBe('/')
    expect(oauthNextPath('//evil.example')).toBe('/')
    expect(oauthNextPath('/login')).toBe('/')
    expect(oauthNextPath('/auth/callback')).toBe('/')
    expect(oauthNextPath(null)).toBe('/')
  })

  it('remembers the destination once across the redirect', () => {
    rememberOAuthNext('/tests')
    expect(takeOAuthNext()).toBe('/tests')
    expect(takeOAuthNext()).toBe('/')
  })
})

describe('Google account metadata', () => {
  it('prefers Stracker display_name, then the Google full_name/name', () => {
    expect(displayNameFromMetadata({ display_name: 'Asha', full_name: 'Asha Rao' })).toBe('Asha')
    expect(displayNameFromMetadata({ full_name: ' Asha Rao ', name: 'A R' })).toBe('Asha Rao')
    expect(displayNameFromMetadata({ name: 'Asha' })).toBe('Asha')
    expect(displayNameFromMetadata({ display_name: '   ' })).toBe('')
    expect(displayNameFromMetadata(undefined)).toBe('')
  })

  it('reads linked sign-in methods', () => {
    expect(userAuthProviders({ provider: 'email', providers: ['email', 'google'] })).toEqual(['email', 'google'])
    expect(userAuthProviders({ provider: 'google' })).toEqual(['google'])
    expect(userAuthProviders(null)).toEqual([])
  })
})

describe('OAuth refusal for disposable domains', () => {
  it('explains a disposable-domain refusal without raw provider text', async () => {
    const { describeOAuthError } = await import('./google-auth')
    expect(describeOAuthError('server_error unexpected_failure Database error saving new user').message).toMatch(/disposable email addresses aren’t allowed/)
    expect(describeOAuthError('Temporary or disposable email addresses aren\'t allowed').message).toBe('Temporary or disposable email addresses aren’t allowed. Please use your regular email.')
  })
})
