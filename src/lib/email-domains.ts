/**
 * Email-domain rules shared by the sign-up form, the Control Centre and the API.
 * Pure data, no network. The same built-in list lives in the database function
 * `public.never_block_email_domain` (a test keeps the two identical).
 */

/** Mainstream providers (and Apple's relay) that are never checked at all, client or server. */
export const BUILT_IN_ALLOWED_DOMAINS: readonly string[] = [
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com', 'rocketmail.com',
  'yahoo.co.in', 'yahoo.in', 'yahoo.co.uk', 'yahoo.ca', 'yahoo.com.au', 'yahoo.fr', 'yahoo.de', 'yahoo.es', 'yahoo.it',
  'yahoo.co.jp', 'yahoo.com.br', 'yahoo.com.mx', 'yahoo.com.sg', 'yahoo.com.ph', 'yahoo.co.id',
  'icloud.com', 'me.com', 'mac.com', 'privaterelay.appleid.com',
  'qq.com', 'foxmail.com', 'vip.qq.com',
  '163.com', '126.com', 'yeah.net',
  'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru',
  'yandex.com', 'yandex.ru', 'ya.ru',
  'naver.com',
  'aol.com',
  'gmx.com', 'gmx.de', 'gmx.net',
  'web.de',
  'proton.me', 'protonmail.com', 'pm.me',
  'rediffmail.com',
  'zohomail.com', 'zoho.com',
  'comcast.net',
  't-online.de',
  'sina.com', 'sina.com.cn', 'sina.net',
  'orange.fr', 'wanadoo.fr',
  'tuta.com', 'tutanota.com', 'tuta.io'
]

const BUILT_IN = new Set(BUILT_IN_ALLOWED_DOMAINS)

export function isBuiltInAllowedDomain(domain: string): boolean {
  return BUILT_IN.has(domain.toLowerCase())
}

/** The domain part of an address, lowercased, without a trailing dot; null when incomplete. */
export function emailDomain(email: string): string | null {
  const match = /@([^@\s]+)$/.exec(email.trim().toLowerCase())
  const domain = match?.[1]?.replace(/\.+$/, '')
  return domain && domain.includes('.') ? domain : null
}

const HOSTNAME = /^(?=.{3,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z][a-z0-9-]{0,61}[a-z0-9]$/

/**
 * Normalises an owner-entered domain: trims, lowercases, drops a trailing dot. Returns null for
 * anything that is not a plain hostname (no @, no scheme, no path, no spaces, at least one dot).
 */
export function normalizeDomainInput(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/\.+$/, '')
  if (!domain || domain.includes('@') || !HOSTNAME.test(domain)) return null
  return domain
}

export const GITHUB_BLOCKLIST_URL = 'https://github.com/disposable-email-domains/disposable-email-domains/blob/main/disposable_email_blocklist.conf'

/** The free, open disposable-domain lists merged into the server block list (normal lists only, never "strict" ones). */
export const DISPOSABLE_LIST_SOURCES: ReadonlyArray<{ name: string; url: string }> = [
  { name: 'disposable-email-domains', url: GITHUB_BLOCKLIST_URL },
  { name: 'disposable/disposable-email-domains', url: 'https://github.com/disposable/disposable-email-domains' },
  { name: '7c/fakefilter', url: 'https://github.com/7c/fakefilter' }
]
