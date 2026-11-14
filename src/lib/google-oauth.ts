import { supabase } from './supabase'
import { AUTH_CALLBACK_PATH, GOOGLE_UNAVAILABLE_MESSAGE, describeOAuthError, fetchGoogleAuthEnabled, rememberOAuthNext } from './google-auth'

/**
 * Starts the Google OAuth round trip through Supabase (PKCE: the client is created with
 * flowType 'pkce', so Supabase returns ?code= to /auth/callback and supabase-js exchanges it).
 * Before leaving the page the provider is re-checked without the cache, so a stale or forced
 * button never sends the student to a raw Supabase error page.
 * Only the default scopes (openid, email, profile) are requested.
 */
export async function startGoogleOAuth(next: string): Promise<void> {
  if (!supabase) throw new Error('Cloud sign-in is not configured for this deployment.')
  const enabled = await fetchGoogleAuthEnabled({ fresh: true })
  if (!enabled) throw new Error(GOOGLE_UNAVAILABLE_MESSAGE)
  rememberOAuthNext(next)
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}${AUTH_CALLBACK_PATH}`,
      queryParams: { prompt: 'select_account' }
    }
  })
  if (error) throw new Error(describeOAuthError(error.message).message)
}
