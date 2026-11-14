/**
 * Cloudflare Turnstile (bot check) for the email/password auth forms.
 *
 * The site key is public. Supabase Auth verifies the token server-side with the secret key,
 * which lives only in the Supabase Auth settings — never in this repository or the browser.
 * Tokens are single-use, so every form fetches a fresh one per attempt and resets the widget.
 *
 * The production widget ("DYPOL Stracker sign-in") only accepts dypol-stracker.vercel.app.
 * Every other host (Vercel previews, localhost, tests) uses Cloudflare's always-pass test key,
 * whose tokens a real secret rejects — so previews cannot sign in once Supabase enforces
 * CAPTCHA, but they never show a broken widget.
 */
export const TURNSTILE_PRODUCTION_SITE_KEY = '0x4AAAAAAGAz4aglDafb5t2v'
export const TURNSTILE_PRODUCTION_HOST = 'dypol-stracker.vercel.app'
/** Cloudflare's documented "always passes" test site key. */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA'
export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export function turnstileSiteKey(hostname: string, configured?: string): string {
  const fromEnv = configured?.trim()
  if (hostname === TURNSTILE_PRODUCTION_HOST) return fromEnv || TURNSTILE_PRODUCTION_SITE_KEY
  // A production key only works on its own hostname; anywhere else use the test key.
  if (fromEnv && fromEnv !== TURNSTILE_PRODUCTION_SITE_KEY) return fromEnv
  return TURNSTILE_TEST_SITE_KEY
}

export interface TurnstileRenderOptions {
  sitekey: string
  theme?: 'light' | 'dark' | 'auto'
  size?: 'normal' | 'compact' | 'flexible'
  appearance?: 'always' | 'execute' | 'interaction-only'
  action?: string
  callback?: (token: string) => void
  'error-callback'?: (code?: string) => boolean | void
  'expired-callback'?: () => void
  'timeout-callback'?: () => void
  'refresh-expired'?: 'auto' | 'manual' | 'never'
  'response-field'?: boolean
}

export interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string | undefined
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
  getResponse: (widgetId?: string) => string | undefined
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let loading: Promise<TurnstileApi> | null = null

/** Loads the official script once, on first use (only the auth pages ever call this). */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no_window'))
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (loading) return loading
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT_URL
    script.async = true
    script.defer = true
    script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile_unavailable'))
    script.onerror = () => { loading = null; script.remove(); reject(new Error('turnstile_load_failed')) }
    document.head.appendChild(script)
  })
  return loading
}
