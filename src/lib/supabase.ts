import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
export const supabase = supabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'pkce'
      },
      global: { headers: { 'X-Client-Info': 'stracker-web' } }
    })
  : null

export const localPreviewEnabled = import.meta.env.DEV && !supabaseConfigured

/** supabase-js's default localStorage key for the persisted session (sb-<project-ref>-auth-token). */
export const supabaseAuthStorageKey = supabaseUrl ? (() => {
  try { return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token` } catch { return null }
})() : null

/**
 * The user saved with this device's session, read straight from storage without the auth lock.
 * Only used to keep a signed-in reload from waiting forever if session restore hangs; the server
 * still checks the real token (RLS) on every request.
 */
export function readStoredSessionUser(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage) {
  if (!storage || !supabaseAuthStorageKey) return null
  try {
    const raw = storage.getItem(supabaseAuthStorageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { user?: { id?: unknown } | null; currentSession?: { user?: { id?: unknown } | null } }
    const user = parsed?.user ?? parsed?.currentSession?.user
    return user && typeof user.id === 'string' ? user as import('@supabase/supabase-js').User : null
  } catch { return null }
}
