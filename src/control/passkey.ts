import { supabase, supabaseAuthStorageKey } from '../lib/supabase'

/**
 * Owner-only passkey verification for the console's second step and for settings step-up.
 *
 * Supabase runs the WebAuthn ceremony (signInWithPasskey) and issues a fresh session whose
 * `amr` records the passkey and its time. The server accepts that as the second step ONLY for
 * the owner (consoleAssurance) and refuses any other role whose session carries a passkey; the
 * database refuses to store a passkey for anyone but the owner. The browser decides nothing.
 *
 * Chrome/Chromium notes:
 *  - Read the existing session synchronously from storage when available so we do not burn
 *    Chrome's 5-second transient user activation waiting on a token refresh before WebAuthn starts.
 *  - Abort any lingering WebAuthn ceremony before starting a new one so Chrome never rejects
 *    with `NotAllowedError` ("A request is already pending").
 *  - Request modal mediation (`optional`) explicitly so Chromium opens the passkey picker rather
 *    than silently failing or waiting on Conditional UI.
 *
 * The ceremony replaces this tab's session, so the previous session is signed out on the
 * server afterwards (best effort) instead of being left valid in the background.
 */
export type PasskeyResult = { ok: true } | { ok: false; message: string }

type PasskeyAuthClient = NonNullable<typeof supabase>['auth'] & {
  signInWithPasskey: (params?: {
    options?: { mediation?: CredentialMediationRequirement; signal?: AbortSignal }
  }) => ReturnType<NonNullable<typeof supabase>['auth']['signInWithPasskey']>
}

let activePasskeyAbort: AbortController | null = null

function readStoredSession(): { userId: string; accessToken: string } | null {
  if (typeof localStorage === 'undefined' || !supabaseAuthStorageKey) return null
  try {
    const raw = localStorage.getItem(supabaseAuthStorageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      user?: { id?: unknown } | null
      access_token?: unknown
      currentSession?: { user?: { id?: unknown } | null; access_token?: unknown } | null
    }
    const userId = parsed?.user?.id ?? parsed?.currentSession?.user?.id
    const accessToken = parsed?.access_token ?? parsed?.currentSession?.access_token
    if (typeof userId === 'string' && typeof accessToken === 'string' && userId && accessToken) {
      return { userId, accessToken }
    }
    return null
  } catch {
    return null
  }
}

function logPasskeyFailure(stage: string, error: unknown): void {
  if (typeof console === 'undefined') return
  const obj = error && typeof error === 'object' ? (error as { name?: unknown; code?: unknown; message?: unknown }) : null
  const name = typeof obj?.name === 'string' ? obj.name : ''
  const code = typeof obj?.code === 'string' ? obj.code : ''
  const host = typeof window !== 'undefined' ? window.location.host : ''
  console.warn('[control:passkey]', { stage, name, code, host })
}

export async function verifyWithOwnerPasskey(): Promise<PasskeyResult> {
  if (!supabase) return { ok: false, message: 'Cloud sign-in is not configured.' }
  if (typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'undefined') {
    return { ok: false, message: 'This browser cannot use passkeys on this page. Open Stracker over HTTPS in a supported browser, or use your authenticator code.' }
  }

  let previous = readStoredSession()
  if (!previous) {
    const { data: current } = await supabase.auth.getSession()
    if (current.session?.user?.id && current.session.access_token) {
      previous = { userId: current.session.user.id, accessToken: current.session.access_token }
    }
  }
  if (!previous) return { ok: false, message: 'Your session has ended. Sign in again.' }

  // Cancel any stale WebAuthn ceremony so Chrome/Chromium never throws "already pending".
  if (activePasskeyAbort) {
    try { activePasskeyAbort.abort() } catch { /* ignore */ }
  }
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  activePasskeyAbort = controller

  const auth = supabase.auth as PasskeyAuthClient
  let result
  try {
    result = await auth.signInWithPasskey(
      controller ? { options: { mediation: 'optional', signal: controller.signal } } : { options: { mediation: 'optional' } }
    )
  } catch (error) {
    logPasskeyFailure('ceremony', error)
    return { ok: false, message: passkeyErrorMessage(error) }
  } finally {
    if (activePasskeyAbort === controller) activePasskeyAbort = null
  }

  if (result.error || !result.data?.user) {
    logPasskeyFailure('verify', result.error)
    return { ok: false, message: passkeyErrorMessage(result.error) }
  }
  if (result.data.user.id !== previous.userId) {
    // Someone else's passkey on this device: never continue as a different account here.
    await supabase.auth.signOut({ scope: 'local' })
    return { ok: false, message: 'That passkey belongs to a different account. Sign in again.' }
  }
  if (previous.accessToken && previous.accessToken !== result.data.session?.access_token) {
    await endPreviousSession(previous.accessToken)
  }
  return { ok: true }
}

async function endPreviousSession(accessToken: string): Promise<void> {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url || !key) return
  try {
    await fetch(`${url}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${accessToken}` } })
  } catch {
    // The old session still expires on its own; nothing else depends on this.
  }
}

export function passkeyErrorMessage(error: unknown): string {
  const obj = error && typeof error === 'object' ? (error as { name?: string; code?: string; message?: string }) : null
  const text = obj ? `${obj.name ?? ''} ${obj.code ?? ''} ${obj.message ?? ''}`.toLowerCase() : String(error ?? '').toLowerCase()
  const host = typeof window !== 'undefined' ? window.location.host : ''

  if (/securityerror|relying party|rpid|rp id|origin.*not|invalid.*origin|domain/.test(text)) {
    return `This browser blocked the passkey for ${host || 'this address'}. Open Stracker on https://dypol-stracker.vercel.app (not a preview URL) and check Supabase → Authentication → Passkeys (Relying Party ID: dypol-stracker.vercel.app).`
  }
  if (/webauthn_verification_failed|backup.*eligible|flag inconsistency/.test(text)) {
    return 'Supabase rejected the passkey verification (this can happen if a synced passkey changed state). Try again, re-add the passkey in Settings → Security, or use your authenticator code.'
  }
  if (/webauthn_challenge_expired|challenge.*expired/.test(text)) {
    return 'The passkey request timed out before it finished. Click “Use passkey” to try again.'
  }
  if (/notsupportederror|not supported/.test(text)) {
    return 'This browser profile does not support this passkey. Check that your device screen lock and Chrome password manager are enabled, or use your authenticator code.'
  }
  if (/disabled|not enabled|passkey.*off/.test(text)) {
    return 'Passkeys are switched off for this project. Use your authenticator code.'
  }
  if (/abort|cancel|notallowed|not allowed|already pending/.test(text)) {
    return 'The passkey prompt was closed or denied by the browser. Make sure you are on the exact saved domain, your device screen lock is on, and no passkey extension is blocking Chrome — then try again, or use your authenticator code.'
  }
  return 'Your passkey could not be verified. Try again, or use your authenticator code.'
}
