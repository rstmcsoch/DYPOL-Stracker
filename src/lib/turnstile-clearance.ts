/**
 * Client-side manager for the individual 15-minute Turnstile break.
 *
 * Hardcore invariants:
 *  1. Strictly in-memory JS state ONLY (never localStorage, sessionStorage, or IndexedDB).
 *     Closing the tab OR reloading the page immediately wipes the in-memory `nonce`, so
 *     Turnstile verification is required again on the very next check.
 *  2. Fixed 15-minute window (non-sliding). Activity inside the 15 minutes NEVER extends
 *     `expiresAt`. A timer automatically clears state the instant 15 minutes elapse.
 *  3. Server-verified against the HttpOnly HMAC-signed cookie (`dypol_ts_clr`) on every
 *     check (`GET /api/control/system?route=turnstile-clearance`, `cache: 'no-store'`).
 *     If the user deletes cookies or clears site cache/data — even while keeping the tab
 *     open — the server reports `cleared: false` and the client immediately drops clearance
 *     and forces fresh visible Turnstile verification.
 */

export const TURNSTILE_BREAK_MS = 15 * 60 * 1000
export const TURNSTILE_CLEARANCE_ENDPOINT = '/api/control/system?route=turnstile-clearance'
export const TURNSTILE_CLEARANCE_HEADER = 'X-Turnstile-Clearance'

export interface TurnstileClearanceState {
  nonce: string
  issuedAt: number
  expiresAt: number
}

type Listener = (cleared: boolean) => void

let state: TurnstileClearanceState | null = null
let expiryTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<Listener>()

function notify(cleared: boolean): void {
  listeners.forEach(listener => {
    try { listener(cleared) } catch { /* ignore subscriber errors */ }
  })
}

function clearExpiryTimer(): void {
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer)
    expiryTimer = null
  }
}

function scheduleExpiry(expiresAt: number): void {
  clearExpiryTimer()
  const delay = Math.max(0, expiresAt - Date.now())
  expiryTimer = setTimeout(() => {
    clearLocalTurnstileClearance()
  }, delay)
}

/** Clears the in-memory break immediately and notifies all mounted Turnstile widgets. */
export function clearLocalTurnstileClearance(): void {
  const wasCleared = state !== null
  state = null
  clearExpiryTimer()
  if (wasCleared) notify(false)
}

/** Synchronous check of whether the in-memory 15-minute break is currently active. */
export function isTurnstileClearedLocally(now = Date.now()): boolean {
  if (!state) return false
  if (now >= state.expiresAt) {
    clearLocalTurnstileClearance()
    return false
  }
  return true
}

/** Returns remaining milliseconds in the current 15-minute break, or 0 if not cleared. */
export function turnstileBreakRemainingMs(now = Date.now()): number {
  if (!isTurnstileClearedLocally(now) || !state) return 0
  return Math.max(0, state.expiresAt - now)
}

/** Subscribes to clearance state changes (e.g. 15-minute expiry or cookie deletion). */
export function subscribeTurnstileClearance(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Starts a fresh individual 15-minute break after a Turnstile verification succeeds.
 * Mints the server-signed HttpOnly cookie and stores the matching 256-bit `nonce`
 * strictly in JS memory. Never extends an already-active 15-minute window.
 */
export async function grantTurnstileClearance(action: string): Promise<boolean> {
  // Never extend an existing unexpired 15-minute window.
  if (isTurnstileClearedLocally()) return true
  if (typeof fetch !== 'function') return false
  try {
    const response = await fetch(TURNSTILE_CLEARANCE_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ verified: true, action })
    })
    if (!response.ok) return false
    const data = await response.json().catch(() => null) as {
      ok?: boolean
      cleared?: boolean
      nonce?: unknown
      issuedAt?: unknown
      expiresAt?: unknown
    } | null
    if (
      !data?.ok
      || data.cleared !== true
      || typeof data.nonce !== 'string'
      || data.nonce.length !== 64
      || typeof data.issuedAt !== 'number'
      || typeof data.expiresAt !== 'number'
      || data.expiresAt <= Date.now()
    ) {
      return false
    }
    state = {
      nonce: data.nonce,
      issuedAt: data.issuedAt,
      expiresAt: Math.min(data.expiresAt, Date.now() + TURNSTILE_BREAK_MS)
    }
    scheduleExpiry(state.expiresAt)
    notify(true)
    return true
  } catch {
    return false
  }
}

/**
 * Verifies with the server that BOTH the in-memory `nonce` AND the HttpOnly signed
 * cookie (`dypol_ts_clr`) are still present, valid, and within the fixed 15-minute window.
 * If cookies/cache were cleared or 15 minutes elapsed, clears local state immediately
 * and returns `false` so visible Turnstile verification runs again.
 */
export async function verifyTurnstileClearance(): Promise<boolean> {
  if (!isTurnstileClearedLocally() || !state) return false
  if (typeof fetch !== 'function') return false
  const currentNonce = state.nonce
  try {
    const response = await fetch(TURNSTILE_CLEARANCE_ENDPOINT, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        [TURNSTILE_CLEARANCE_HEADER]: currentNonce
      }
    })
    if (!response.ok) {
      clearLocalTurnstileClearance()
      return false
    }
    const data = await response.json().catch(() => null) as {
      ok?: boolean
      cleared?: boolean
      expiresAt?: unknown
    } | null
    if (!data?.ok || data.cleared !== true) {
      clearLocalTurnstileClearance()
      return false
    }
    if (typeof data.expiresAt === 'number' && state && state.nonce === currentNonce) {
      // Never extend past the original window; sync to server's fixed expiry.
      state.expiresAt = Math.min(state.expiresAt, data.expiresAt)
      if (Date.now() >= state.expiresAt) {
        clearLocalTurnstileClearance()
        return false
      }
      scheduleExpiry(state.expiresAt)
    }
    return true
  } catch {
    // Fail closed: if we cannot confirm the HttpOnly cookie is still present, require verification.
    clearLocalTurnstileClearance()
    return false
  }
}

/** Explicitly clears both in-memory state and the HttpOnly clearance cookie on the server. */
export async function revokeTurnstileClearance(): Promise<void> {
  clearLocalTurnstileClearance()
  if (typeof fetch !== 'function') return
  try {
    await fetch(TURNSTILE_CLEARANCE_ENDPOINT, {
      method: 'DELETE',
      credentials: 'same-origin',
      cache: 'no-store'
    })
  } catch {
    // Local state is already cleared.
  }
}

/**
 * Click-path plan for obtaining a Turnstile token.
 *
 * During an active 15-minute break, a pre-warmed silent token is returned immediately
 * so Control Centre passkey / step-up does not wait on a new Cloudflare execute or a
 * clearance fetch (those happen when the widget mounts, not on the button click).
 * Outside the break, the visible widget path is unchanged.
 */
export type TurnstileTokenPlan =
  | { action: 'return'; token: string }
  | { action: 'execute' }
  | { action: 'challenge' }
  | { action: 'reopen-visible' }

export function planTurnstileTokenRequest(input: {
  mode: 'visible' | 'cleared'
  locallyCleared: boolean
  token: string | null
}): TurnstileTokenPlan {
  if (input.mode === 'cleared') {
    if (input.locallyCleared && input.token) return { action: 'return', token: input.token }
    if (input.locallyCleared) return { action: 'execute' }
    return { action: 'reopen-visible' }
  }
  if (input.token) return { action: 'return', token: input.token }
  return { action: 'challenge' }
}

export interface ResolveTurnstileTokenInput {
  mode: 'visible' | 'cleared'
  token: string | null
  failed: boolean
  executeStarted: boolean
  verifyClearance: () => Promise<boolean>
  execute: () => void
  reset: () => void
  onClearanceLost: () => void
}

/**
 * Resolves a Turnstile token for a submit / passkey click.
 *
 * Fast path (no network, no execute): the 15-minute break is still locally active
 * and a silent token was already pre-warmed. Clearance itself is server-validated
 * when the widget mounts, not on this click, so Chrome's user-activation window
 * is not spent on a round-trip before WebAuthn starts.
 *
 * If the break is active but no token is ready yet, the server clearance cookie
 * is re-checked, then a silent execute may run. If the break has ended or the
 * cookie is gone, the visible widget is reopened.
 */
export async function resolveTurnstileToken(
  input: ResolveTurnstileTokenInput
): Promise<{ token?: string; wait: boolean }> {
  const plan = planTurnstileTokenRequest({
    mode: input.mode,
    locallyCleared: isTurnstileClearedLocally(),
    token: input.token
  })

  if (plan.action === 'return') return { token: plan.token, wait: false }

  if (input.mode === 'cleared') {
    const stillCleared = await input.verifyClearance()
    if (!stillCleared) {
      input.onClearanceLost()
      return { wait: true }
    }
    if (input.token) return { token: input.token, wait: false }
    if (!input.executeStarted) input.execute()
    return { wait: true }
  }

  if (input.token) return { token: input.token, wait: false }
  if (input.failed) input.reset()
  return { wait: true }
}

/** Silent widgets in the 15-minute break should execute as soon as they render. */
export function shouldPrewarmSilentTurnstile(mode: 'visible' | 'cleared'): boolean {
  return mode === 'cleared'
}
