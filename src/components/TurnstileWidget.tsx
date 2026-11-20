import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react'
import { loadTurnstile, turnstileSiteKey, type TurnstileApi } from '../lib/turnstile'
import {
  clearLocalTurnstileClearance,
  grantTurnstileClearance,
  isTurnstileClearedLocally,
  subscribeTurnstileClearance,
  verifyTurnstileClearance
} from '../lib/turnstile-clearance'

export interface TurnstileHandle {
  /**
   * A fresh single-use token, waiting briefly while Cloudflare finishes its check.
   * During an active 15-minute server-verified break, no visible verification box is shown;
   * a silent background token is still obtained on submit when needed by Supabase Auth.
   * Resolves `undefined` when the widget is unavailable; Supabase Auth then decides.
   */
  getToken: () => Promise<string | undefined>
  /** Throw away the used token and prepare for the next attempt. Call after every attempt. */
  reset: () => void
}

const TOKEN_WAIT_MS = 20_000

/**
 * The theme of the page around the widget: Control Centre carries its Light / Dark choice on
 * `data-cc-theme`, public pages (sign-in, sign-up, reset, contact) use `data-public-theme`, and
 * signed-in notebook pages use `data-theme` on the document root.
 */
function pageTheme(element: HTMLElement | null): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  const control = element?.closest<HTMLElement>('[data-cc-theme]')?.dataset.ccTheme
  if (control) return control === 'dark' ? 'dark' : 'light'
  const scoped = element?.closest<HTMLElement>('[data-public-theme]')?.dataset.publicTheme
  if (scoped) return scoped === 'dark' ? 'dark' : 'light'
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

/** Follows the page's Light / Night setting so the widget is re-rendered with the matching theme. */
function usePageTheme(container: RefObject<HTMLDivElement | null>): 'light' | 'dark' | null {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null)
  useEffect(() => {
    const update = () => setTheme(pageTheme(container.current))
    update()
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-theme', 'data-public-theme', 'data-cc-theme'] })
    return () => observer.disconnect()
  }, [container])
  return theme
}

const HIDDEN_SLOT_STYLE = {
  position: 'absolute',
  width: 0,
  height: 0,
  minHeight: 0,
  overflow: 'hidden',
  opacity: 0,
  pointerEvents: 'none'
} as const

/**
 * Cloudflare Turnstile with an individual 15-minute fixed-window break:
 *  - On a fresh page load, after reload, after tab close, after cookie/cache deletion, or
 *    after 15 minutes expire: renders visibly (`appearance: "always"`) above the submit button.
 *  - After passing verification: grants a server-signed 15-minute break (HttpOnly cookie +
 *    in-memory tab nonce). During those 15 minutes, subsequent forms and Control Centre
 *    passkey/step-up prompts hide the Turnstile box completely and only obtain a silent
 *    background token on submit so Supabase Auth never rejects the request.
 *  - Disabled under Vitest (no network in jsdom).
 */
export const TurnstileWidget = forwardRef<TurnstileHandle, { action: string }>(function TurnstileWidget({ action }, ref) {
  const container = useRef<HTMLDivElement>(null)
  const state = useRef<{
    api: TurnstileApi | null
    id: string | null
    token: string | null
    failed: boolean
    waiters: Array<(token: string | undefined) => void>
  }>({
    api: null, id: null, token: null, failed: false, waiters: []
  })
  const disabled = import.meta.env.MODE === 'test'
  const theme = usePageTheme(container)

  // Start in 'cleared' mode only if this tab already holds an unexpired in-memory nonce,
  // then immediately verify the HttpOnly cookie with the server on mount.
  const [mode, setMode] = useState<'visible' | 'cleared'>(() => (
    !disabled && isTurnstileClearedLocally() ? 'cleared' : 'visible'
  ))
  const [interactiveRequired, setInteractiveRequired] = useState(false)
  const modeRef = useRef(mode)
  modeRef.current = mode

  // Resolve any pending waiters only when the component actually unmounts (not during mode switch).
  useEffect(() => {
    const current = state.current
    return () => {
      const waiters = current.waiters.splice(0)
      waiters.forEach(resolve => resolve(undefined))
    }
  }, [])

  // Confirm HttpOnly cookie is still present on mount (catches cookie/cache deletion without reload)
  // and react immediately when the 15-minute fixed window expires.
  useEffect(() => {
    if (disabled) return
    let active = true
    if (isTurnstileClearedLocally()) {
      void verifyTurnstileClearance().then(ok => {
        if (!active) return
        if (!ok) {
          setInteractiveRequired(false)
          setMode('visible')
        }
      })
    }
    const unsubscribe = subscribeTurnstileClearance(cleared => {
      if (!active) return
      if (!cleared) {
        setInteractiveRequired(false)
        setMode('visible')
      }
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [disabled])

  useEffect(() => {
    if (disabled || !theme) return
    const current = state.current
    let active = true
    const settle = (token: string | undefined) => {
      const waiters = current.waiters.splice(0)
      waiters.forEach(resolve => resolve(token))
    }
    void loadTurnstile().then(api => {
      if (!active || !container.current) return
      current.api = api
      const isClearedMode = mode === 'cleared'
      current.id = api.render(container.current, {
        sitekey: turnstileSiteKey(window.location.hostname, import.meta.env.VITE_TURNSTILE_SITE_KEY),
        theme,
        size: 'flexible',
        appearance: isClearedMode ? 'interaction-only' : 'always',
        execution: isClearedMode ? 'execute' : 'render',
        action,
        'refresh-expired': isClearedMode ? 'never' : 'auto',
        'response-field': false,
        callback: token => {
          current.token = token
          current.failed = false
          if (modeRef.current === 'visible') {
            // Fresh human verification succeeded: start the fixed 15-minute break.
            void grantTurnstileClearance(action)
          }
          setInteractiveRequired(false)
          settle(token)
        },
        'before-interactive-callback': () => {
          if (active) setInteractiveRequired(true)
        },
        'after-interactive-callback': () => {
          if (active) setInteractiveRequired(false)
        },
        'expired-callback': () => { current.token = null },
        'timeout-callback': () => { current.token = null },
        'error-callback': () => { current.token = null; current.failed = true; settle(undefined); return true }
      }) ?? null
    }).catch(() => { current.failed = true; settle(undefined) })
    return () => {
      active = false
      if (current.api && current.id) {
        try { current.api.remove(current.id) } catch { /* already gone */ }
      }
      current.api = null
      current.id = null
      current.token = null
    }
  }, [action, disabled, theme, mode])

  useImperativeHandle(ref, () => ({
    getToken: async () => {
      const current = state.current
      if (disabled) return undefined

      if (modeRef.current === 'cleared') {
        // Re-verify with the server before using the 15-minute break:
        // catches cookie/cache deletion or exact 15-minute expiry in real time.
        const stillCleared = await verifyTurnstileClearance()
        if (!stillCleared) {
          clearLocalTurnstileClearance()
          setInteractiveRequired(false)
          setMode('visible')
          return new Promise<string | undefined>(resolve => {
            const timer = window.setTimeout(() => {
              current.waiters = current.waiters.filter(waiter => waiter !== done)
              resolve(undefined)
            }, TOKEN_WAIT_MS)
            const done = (token: string | undefined) => { window.clearTimeout(timer); resolve(token) }
            current.waiters.push(done)
          })
        }
        if (current.token) return current.token
        if (current.api && current.id && typeof current.api.execute === 'function') {
          try {
            current.api.execute(current.id)
          } catch {
            try { current.api.reset(current.id) } catch { /* ignore */ }
          }
        }
      } else {
        if (current.token) return current.token
        if (current.failed) {
          // One retry after an error, then let the server decide.
          current.failed = false
          if (current.api && current.id) {
            try { current.api.reset(current.id) } catch { /* ignore */ }
          }
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
      if (isTurnstileClearedLocally()) {
        // Transition to hidden cleared mode after the first verified attempt so the
        // visible Turnstile box does not re-spin during the 15-minute break.
        setInteractiveRequired(false)
        if (modeRef.current !== 'cleared') {
          setMode('cleared')
          return
        }
      }
      if (current.api && current.id) {
        try { current.api.reset(current.id) } catch { /* ignore */ }
      }
    }
  }), [disabled])

  if (disabled) return null
  const hideSlot = mode === 'cleared' && !interactiveRequired
  return (
    <div
      ref={container}
      className={hideSlot ? 'turnstile-slot turnstile-slot--cleared' : 'turnstile-slot'}
      style={hideSlot ? HIDDEN_SLOT_STYLE : undefined}
      data-testid="turnstile-slot"
      data-turnstile-mode={hideSlot ? 'cleared' : 'visible'}
      aria-label={hideSlot ? undefined : 'Security check'}
      aria-hidden={hideSlot ? true : undefined}
    />
  )
})
