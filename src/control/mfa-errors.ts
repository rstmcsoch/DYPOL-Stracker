/**
 * Turns a Supabase Auth MFA error into a specific, non-revealing message. Supabase checks the
 * code against the previous, current and next 30-second step (RFC 6238, ±1 step), so a code that
 * is refused while the app still shows it almost always means the phone's clock is off.
 */
export function mfaErrorMessage(error: { code?: string; status?: number; message?: string } | null | undefined): string {
  const code = error?.code ?? ''
  const status = error?.status ?? 0
  if (code === 'mfa_verification_failed' || code === 'mfa_verification_rejected') {
    return 'That code did not match. If a code still showing in your authenticator is refused, your phone\'s clock is probably off: turn on automatic date and time (in Google Authenticator: Settings, Time correction for codes, Sync now), then enter the current code.'
  }
  if (code === 'mfa_challenge_expired') return 'That verification attempt expired. Enter the current code again.'
  if (code === 'over_request_rate_limit' || code === 'too_many_requests' || status === 429) return 'Too many attempts. Wait a minute, then enter the current code.'
  if (code === 'session_not_found' || code === 'session_expired' || code === 'bad_jwt' || code === 'refresh_token_not_found' || status === 401 || status === 403) return 'Your sign-in session ended. Sign out, sign in again, then enter the current code.'
  if (code === 'mfa_factor_not_found') return 'Your authenticator is no longer registered for this account. See the recovery procedure.'
  if (!status) return 'The code could not be checked because the connection failed. Check your connection and try again.'
  return 'That code was not accepted. Use the current code from your authenticator app.'
}
