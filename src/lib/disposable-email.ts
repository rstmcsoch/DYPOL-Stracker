import { supabase } from './supabase'
import { emailDomain, isBuiltInAllowedDomain } from './email-domains'

export { emailDomain } from './email-domains'

export const DISPOSABLE_EMAIL_MESSAGE = 'Temporary or disposable email addresses aren\'t allowed. Please use your regular email.'

const CHECK_TIMEOUT_MS = 3_000

/**
 * One tiny RPC that answers true/false for this address against the server's rules (built-in
 * allowlist, the owner's allow/block lists, then the GitHub list). Built-in providers are never
 * sent. Fails open: a slow or failed check never blocks; the database decides on sign-up.
 */
export async function isDisposableEmail(email: string): Promise<boolean> {
  const domain = emailDomain(email)
  if (!domain || isBuiltInAllowedDomain(domain) || !supabase) return false
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

/**
 * Background check for sign-up step 1: started quietly once a complete address has been typed,
 * read when the person presses Next. Never shows anything while typing.
 */
export function createDisposableEmailPrecheck(check: (email: string) => Promise<boolean> = isDisposableEmail) {
  let current: { key: string; result: boolean | null; promise: Promise<boolean> } | null = null
  const keyOf = (email: string) => email.trim().toLowerCase()
  const start = (email: string): Promise<boolean> => {
    const key = keyOf(email)
    if (current?.key === key) return current.promise
    const entry: { key: string; result: boolean | null; promise: Promise<boolean> } = { key, result: null, promise: Promise.resolve(false) }
    entry.promise = check(email).catch(() => false).then(value => { entry.result = value; return value })
    current = entry
    return entry.promise
  }
  return {
    /** Quietly start (or reuse) the check for this address. Built-in providers are skipped. */
    prefetch(email: string): void {
      const domain = emailDomain(email)
      if (!domain || isBuiltInAllowedDomain(domain)) return
      void start(email)
    },
    /**
     * The answer for Next: immediate when the background check is done; otherwise waits at most
     * `maxWaitMs` and then lets the person through (the server is authoritative).
     */
    async resolve(email: string, maxWaitMs = 600): Promise<boolean> {
      const domain = emailDomain(email)
      if (!domain || isBuiltInAllowedDomain(domain)) return false
      const key = keyOf(email)
      if (current?.key === key && current.result !== null) return current.result
      const promise = start(email)
      const timeout = new Promise<boolean>(resolve => setTimeout(() => resolve(false), maxWaitMs))
      return Promise.race([promise, timeout])
    }
  }
}
