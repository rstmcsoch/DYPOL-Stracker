/**
 * Public, build-time configuration. Only EXPO_PUBLIC_* values are compiled into the app, and
 * they must be literal `process.env.EXPO_PUBLIC_…` reads so Expo can inline them.
 */
export const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim()
export const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://dypol-stracker.vercel.app').trim().replace(/\/+$/, '')

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

/** Mirrors the website: the device-only preview exists only in development without cloud configuration. */
export const localPreviewEnabled = __DEV__ && !supabaseConfigured
