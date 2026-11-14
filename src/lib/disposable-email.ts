import { supabase } from './supabase'

export const DISPOSABLE_EMAIL_MESSAGE = 'Temporary or disposable email addresses aren\'t allowed. Please use your regular email.'

/** Mainstream and privacy-relay providers that are never treated as disposable (mirrors the database). */
const NEVER_BLOCK = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.in', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'live.in', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'privaterelay.appleid.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com', 'rocketmail.com',
  'proton.me', 'protonmail.com', 'pm.me', 'duck.com', 'aol.com', 'zoho.com', 'zohomail.in', 'rediffmail.com', 'gmx.com', 'gmx.net',
  'mail.com', 'yandex.com', 'tutanota.com', 'tuta.io', 'fastmail.com'
])

export function emailDomain(email: string): string | null {
  const match = /@([^@\s]+)$/.exec(email.trim().toLowerCase())
  const domain = match?.[1]?.replace(/\.+$/, '')
  return domain && domain.includes('.') ? domain : null
}

const CHECK_TIMEOUT_MS = 3_000

/**
 * Instant feedback for sign-up step 1: one tiny RPC that answers true/false for this address
 * against the server's blocklist. Fails open (a slow or failed check never blocks the form);
 * the database trigger on new accounts is the authoritative check.
 */
export async function isDisposableEmail(email: string): Promise<boolean> {
  const domain = emailDomain(email)
  if (!domain || NEVER_BLOCK.has(domain) || !supabase) return false
  try {
    const check = supabase.rpc('is_disposable_email', { p_email: email.trim() })
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), CHECK_TIMEOUT_MS))
    const result = await Promise.race([check, timeout])
    if (!result || result.error) return false
    return result.data === true
  } catch {
    return false
  }
}
