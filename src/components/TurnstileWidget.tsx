import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { loadTurnstile, turnstileSiteKey, type TurnstileApi } from '../lib/turnstile'

export interface TurnstileHandle {
  /**
   * A fresh single-use token, waiting briefly while Cloudflare finishes its visible check. Resolves `undefined` when the widget is unavailable; Supabase Auth then decides.
   */
  getToken: () => Promise<string | undefined>
  /** Throw away the used token and start a new check. Call after every attempt. */
  reset: () => void
}

const TOKEN_WAIT_MS = 20_000

function pageTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

/** Follows the page's Light / Night setting so the widget is re-rendered with the matching theme. */
function usePageTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState(pageTheme)
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() => setTheme(pageTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return theme
}

/**
 * Cloudflare Turnstile, always visible (appearance "always"): a full-width verification box
 * placed just above the submit button. Space is reserved before it loads so the form does not
 * jump. Loaded lazily on the pages that use it. Disabled under Vitest (no network in jsdom).
 */
export const TurnstileWidget = forwardRef<TurnstileHandle, { action: string }>(function TurnstileWidget({ action }, ref) {
  const container = useRef<HTMLDivElement>(null)
  const state = useRef<{ api: TurnstileApi | null; id: string | null; token: string | null; failed: boolean; waiters: Array<(token: string | undefined) => void> }>({
    api: null, id: null, token: null, failed: false, waiters: []
  })
  const disabled = import.meta.env.MODE === 'test'
  const theme = usePageTheme()

  useEffect(() => {
    if (disabled) return
    const current = state.current
    let active = true
    const settle = (token: string | undefined) => {
      const waiters = current.waiters.splice(0)
      waiters.forEach(resolve => resolve(token))
    }
    void loadTurnstile().then(api => {
      if (!active || !container.current) return
      current.api = api
      current.id = api.render(container.current, {
        sitekey: turnstileSiteKey(window.location.hostname, import.meta.env.VITE_TURNSTILE_SITE_KEY),
        theme,
        size: 'flexible',
        appearance: 'always',
        action,
        'refresh-expired': 'auto',
        'response-field': false,
        callback: token => { current.token = token; current.failed = false; settle(token) },
        'expired-callback': () => { current.token = null },
        'timeout-callback': () => { current.token = null },
        'error-callback': () => { current.token = null; current.failed = true; settle(undefined); return true }
      }) ?? null
    }).catch(() => { current.failed = true; settle(undefined) })
    return () => {
      active = false
      settle(undefined)
      if (current.api && current.id) {
        try { current.api.remove(current.id) } catch { /* already gone */ }
      }
      current.api = null
      current.id = null
      current.token = null
    }
  }, [action, disabled, theme])

  useImperativeHandle(ref, () => ({
    getToken: () => {
      const current = state.current
      if (disabled) return Promise.resolve(undefined)
      if (current.token) return Promise.resolve(current.token)
      if (current.failed) {
        // One retry after an error, then let the server decide.
        current.failed = false
        if (current.api && current.id) {
          try { current.api.reset(current.id) } catch { /* ignore */ }
        }
      }
      return new Promise<string | undefined>(resolve => {
        const timer = window.setTimeout(() => {
          current.waiters = current.waiters.filter(waiter => waiter !== done)
          resolve(undefined)
        }, TOKEN_WAIT_MS)
        const done = (token: string | undefined) => { window.clearTimeout(timer); resolve(token) }
        current.waiters.push(done)
      })
    },
    reset: () => {
      const current = state.current
      current.token = null
      if (current.api && current.id) {
        try { current.api.reset(current.id) } catch { /* ignore */ }
      }
    }
  }), [disabled])

  if (disabled) return null
  return <div ref={container} className="turnstile-slot" data-testid="turnstile-slot" aria-label="Security check" />
})
