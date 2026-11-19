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
 *  - Request modal mediation (`optional`) explicitly without passing a custom `signal`, so
 *    `@supabase/auth-js` uses its built-in pending-ceremony cancellation instead of overriding it.
 *  - Forward the Cloudflare Turnstile `captchaToken` because Supabase Auth enforces project-wide
 *    CAPTCHA protection on `signInWithPasskey()` as well as password/signup endpoints.
 *  - Inspect both the error and its `.cause` (where WebAuthn wrappers place browser DOMExceptions)
 *    and include a sanitized diagnostic summary in the owner-only alert so mobile/tablet Chrome
 *    errors are visible without DevTools.
 *
 * The ceremony replaces this tab's session, so the previous session is signed out on the
 * server afterwards (best effort) instead of being left valid in the background.
 */
export type PasskeyResult = { ok: true } | { ok: false; message: string }

type PasskeyAuthClient = NonNullable<typeof supabase>['auth'] & {
  signInWithPasskey: (params?: {
    options?: { mediation?: CredentialMediationRequirement; signal?: AbortSignal; captchaToken?: string }
  }) => ReturnType<NonNullable<typeof supabase>['auth']['signInWithPasskey']>
}

interface ExtractedPasskeyError {
  name: string
  code: string
  status: number | null
  message: string
  causeName: string
  causeCode: string
  causeMessage: string
}

function asErrorRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function extractPasskeyError(error: unknown): ExtractedPasskeyError {
  const obj = asErrorRecord(error)
  const cause = asErrorRecord(obj?.cause)
  return {
    name: cleanString(obj?.name),
    code: cleanString(obj?.code),
    status: typeof obj?.status === 'number' && Number.isFinite(obj.status) ? obj.status : null,
    message: obj ? cleanString(obj.message) : cleanString(error),
    causeName: cleanString(cause?.name),
    causeCode: cleanString(cause?.code),
    causeMessage: cleanString(cause?.message)
  }
}

function formatPasskeyDiagnostic(info: ExtractedPasskeyError): string {
  const parts: string[] = []
  const tag = info.code || (info.name && info.name !== 'Error' ? info.name : '')
  if (tag) parts.push(tag)
  if (info.causeCode && info.causeCode !== tag) parts.push(info.causeCode)
  else if (info.causeName && info.causeName !== 'Error' && info.causeName !== tag) parts.push(info.causeName)
  if (info.status !== null) parts.push(`HTTP ${info.status}`)
  const rawMessage = info.causeMessage || info.message
  const safeMessage = rawMessage
    .replace(/Bearer\s+\S+/gi, '[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  if (safeMessage && safeMessage.toLowerCase() !== tag.toLowerCase()) parts.push(safeMessage)
  return parts.join(' · ')
}

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
  const info = extractPasskeyError(error)
  const host = typeof window !== 'undefined' ? window.location.host : ''
  console.warn('[control:passkey]', {
    stage,
    name: info.name,
    code: info.code,
    status: info.status,
    causeName: info.causeName,
    causeCode: info.causeCode,
    host
  })
}

export async function verifyWithOwnerPasskey(captchaToken?: string): Promise<PasskeyResult> {
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

  const auth = supabase.auth as PasskeyAuthClient
  let result
  try {
    // Let @supabase/auth-js manage pending-ceremony cancellation natively (passing a custom
    // AbortSignal disables the SDK's built-in pending-ceremony abort).
    result = await auth.signInWithPasskey({
      options: {
        mediation: 'optional',
        ...(captchaToken ? { captchaToken } : {})
      }
    })
  } catch (error) {
    logPasskeyFailure('ceremony', error)
    return { ok: false, message: passkeyErrorMessage(error) }
  }

  if (result.error || !result.data?.user) {
    const err = result.error ?? { code: 'no_session_returned', message: 'Supabase returned no user session.' }
    logPasskeyFailure('verify', err)
    return { ok: false, message: passkeyErrorMessage(err) }
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
  const info = extractPasskeyError(error)
  const text = [info.name, info.code, info.message, info.causeName, info.causeCode, info.causeMessage]
    .join(' ')
    .toLowerCase()
  const host = typeof window !== 'undefined' ? window.location.host : ''
  const detail = formatPasskeyDiagnostic(info)
  const withDetail = (base: string): string => (detail ? `${base} (${detail})` : base)

  if (/captcha_failed|captcha protection|captcha_token|captcha/.test(text)) {
    return withDetail('The security check (Turnstile) did not complete. Wait for the green check above “Use passkey” and try again, or use your authenticator code.')
  }
  if (/securityerror|relying party|rpid|rp id|origin.*not|invalid.*origin|domain/.test(text)) {
    return withDetail(`This browser blocked the passkey for ${host || 'this address'}. Open Stracker on https://dypol-stracker.vercel.app (not a preview URL) and check Supabase → Authentication → Passkeys (Relying Party ID: dypol-stracker.vercel.app).`)
  }
  if (/webauthn_verification_failed|credential verification failed|backup.*eligible|flag inconsistency/.test(text)) {
    return withDetail('Supabase rejected the passkey verification (known issue when a synced passkey changes state after registration). Re-add the passkey in Settings → Security, or use your authenticator code.')
  }
  if (/webauthn_challenge_expired|challenge.*expired/.test(text)) {
    return withDetail('The passkey request timed out before it finished. Click “Use passkey” to try again.')
  }
  if (/notsupportederror|not supported/.test(text)) {
    return withDetail('This browser profile does not support this passkey. Check that your device screen lock and Chrome password manager are enabled, or use your authenticator code.')
  }
  if (/disabled|not enabled|passkey.*off/.test(text)) {
    return withDetail('Passkeys are switched off for this project. Use your authenticator code.')
  }
  if (/abort|cancel|notallowed|not allowed|already pending|error_ceremony_aborted/.test(text)) {
    return withDetail('The passkey prompt was closed or denied by the browser. Make sure you are on the exact saved domain, your device screen lock is on, and no passkey extension is blocking Chrome — then try again, or use your authenticator code.')
  }
  return withDetail('Your passkey could not be verified. Try again, or use your authenticator code.')
}
