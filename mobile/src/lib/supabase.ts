/**
 * The same Supabase project, database, RLS policies, and accounts as the website. The mobile client
 * differs only in how it stores the session (Keystore-backed) and in deep-link handling, which the
 * app performs itself because React Native has no URL bar to detect sessions from.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { AppState, type AppStateStatus } from 'react-native'
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseConfigured } from './config'
import { secureSessionStorage } from './secure-storage'

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: secureSessionStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce'
      },
      global: { headers: { 'X-Client-Info': 'stracker-mobile' } }
    })
  : null

/** Token refresh runs only while the app is in the foreground, as the supabase-js guide for React Native recommends. */
export function followAppStateForAuthRefresh(): () => void {
  if (!supabase) return () => undefined
  const client = supabase
  const handle = (state: AppStateStatus) => {
    if (state === 'active') client.auth.startAutoRefresh()
    else client.auth.stopAutoRefresh()
  }
  const subscription = AppState.addEventListener('change', handle)
  handle(AppState.currentState)
  return () => {
    subscription.remove()
    client.auth.stopAutoRefresh()
  }
}
