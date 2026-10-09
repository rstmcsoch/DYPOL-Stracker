/**
 * Pure helpers for the public Supabase key. They run both in the app and in app.config.ts (Node),
 * so they use no platform APIs: no Buffer, atob, or TextDecoder.
 */

/**
 * The publishable key is the canonical setting. EXPO_PUBLIC_SUPABASE_ANON_KEY is accepted as an
 * alias for projects that still use the legacy anon key. Blank values count as unset.
 */
export function resolveSupabasePublicKey(canonical: string | undefined, alias: string | undefined): string {
  return (canonical ?? '').trim() || (alias ?? '').trim()
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Decodes a base64url JWT segment as ASCII. JWT claims used here are ASCII; returns null on bad input. */
function decodeJwtSegment(segment: string): string | null {
  let bits = 0
  let width = 0
  let text = ''
  for (const char of segment.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')) {
    const value = BASE64_ALPHABET.indexOf(char)
    if (value < 0) return null
    bits = ((bits << 6) | value) & 0xffffff
    width += 6
    if (width >= 8) {
      width -= 8
      text += String.fromCharCode((bits >> width) & 0xff)
    }
  }
  return text
}

/**
 * True for keys with database-wide privileges: the `sb_secret_` format and legacy JWTs whose role is
 * `service_role`. Such a key must never be compiled into the app. Fails closed: a three-part token
 * whose claims cannot be read is treated as privileged.
 */
export function isPrivilegedSupabaseKey(key: string): boolean {
  const value = key.trim()
  if (value.startsWith('sb_secret_')) return true
  const segments = value.split('.')
  if (segments.length !== 3) return false
  const payload = decodeJwtSegment(segments[1])
  if (payload === null) return true
  try {
    return (JSON.parse(payload) as { role?: unknown }).role === 'service_role'
  } catch {
    return true
  }
}
