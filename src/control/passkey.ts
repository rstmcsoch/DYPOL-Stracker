import { supabase } from '../lib/supabase'

/**
 * Owner-only passkey verification for the console's second step and for settings step-up.
 *
 * Supabase runs the WebAuthn ceremony (signInWithPasskey) and issues a fresh session whose
 * `amr` records the passkey and its time. The server accepts that as the second step ONLY for
 * the owner (consoleAssurance) and refuses any other role whose session carries a passkey; the
 * database refuses to store a passkey for anyone but the owner. The browser decides nothing.
 *
 * The ceremony replaces this tab's session, so the previous session is signed out on the
 * server afterwards (best effort) instead of being left valid in the background.
 */
export type PasskeyResult = { ok: true } | { ok: false; message: string }

export async function verifyWithOwnerPasskey(): Promise<PasskeyResult> {
  if (!supabase) return { ok: false, message: 'Cloud sign-in is not configured.' }
  const { data: current } = await supabase.auth.getSession()
  const previous = current.session
  if (!previous) return { ok: false, message: 'Your session has ended. Sign in again.' }
  let result
  try {
    result = await supabase.auth.signInWithPasskey()
  } catch {
    return { ok: false, message: 'The passkey check did not finish. Try again, or use your authenticator code.' }
  }
  if (result.error || !result.data?.user) return { ok: false, message: passkeyErrorMessage(result.error) }
  if (result.data.user.id !== previous.user.id) {
    // Someone else's passkey on this device: never continue as a different account here.
    await supabase.auth.signOut({ scope: 'local' })
    return { ok: false, message: 'That passkey belongs to a different account. Sign in again.' }
  }
  await endPreviousSession(previous.access_token)
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
  const text = error && typeof error === 'object' ? `${(error as { code?: string }).code ?? ''} ${(error as { message?: string }).message ?? ''}`.toLowerCase() : ''
  if (/abort|cancel|notallowed|not allowed/.test(text)) return 'The passkey prompt was closed. Nothing changed. Try again, or use your authenticator code.'
  if (/disabled|not enabled|passkey.*off/.test(text)) return 'Passkeys are switched off for this project. Use your authenticator code.'
  return 'Your passkey could not be verified. Try again, or use your authenticator code.'
}
