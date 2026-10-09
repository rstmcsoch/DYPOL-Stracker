import { isPrivilegedSupabaseKey, resolveSupabasePublicKey } from './supabase-key'

/**
 * Public, build-time configuration. Only EXPO_PUBLIC_* values are compiled into the app, and
 * they must be literal `process.env.EXPO_PUBLIC_…` reads so Expo can inline them.
 */
export const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim()

const candidatePublicKey = resolveSupabasePublicKey(
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
)

/** A privileged (service-role) key must never reach the client. If one is configured, cloud features stay off. */
const privilegedKeyRejected = isPrivilegedSupabaseKey(candidatePublicKey)
if (privilegedKeyRejected) {
  console.warn('Stracker: the configured Supabase key is privileged (service role) and was not loaded. Use the publishable key.')
}

export const SUPABASE_PUBLISHABLE_KEY = privilegedKeyRejected ? '' : candidatePublicKey

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://dypol-stracker.vercel.app').trim().replace(/\/+$/, '')

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY)

/** Mirrors the website: the device-only preview exists only in development without cloud configuration. */
export const localPreviewEnabled = __DEV__ && !supabaseConfigured
