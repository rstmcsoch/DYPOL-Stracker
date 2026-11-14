import { supabase } from './supabase'
import { clearLocalUserData } from './database'
import { parseNotice, readNoticeToken, storeNoticeToken, type AccountNotice } from './account-notices'

/**
 * Database calls for account notices. Each is one small RPC (primary-key or partial-index lookups);
 * the dashboard makes one on open. Nothing here logs reasons, tokens or passwords.
 */
export async function fetchMyNotice(): Promise<AccountNotice | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('my_account_notice')
  if (error) {
    // The session itself may be gone (revoked at ban time, or refresh refused with user_banned).
    // The device token still lets this device learn about its own ban.
    return banNoticeForDevice()
  }
  if (!data || typeof data !== 'object') return null
  const payload = data as { notice?: unknown; token?: unknown }
  storeNoticeToken(payload.token)
  return parseNotice(payload.notice)
}

/**
 * Discards everything this device holds for the account: cached study rows, unsynced edits
 * (the outbox) and cached images. The next sign-in reloads the server copy, so edits made
 * while banned vanish. The database refuses or skips them as well.
 */
export async function discardLocalAccountData(userId: string | null | undefined): Promise<void> {
  if (!userId) return
  await clearLocalUserData(userId).catch(() => undefined)
}

export async function acknowledgeNotice(id: string | undefined): Promise<void> {
  if (!supabase || !id) return
  await supabase.rpc('acknowledge_account_notice', { notice_id: id })
}

/** Ban details for the account this device last held (signed device token), or null. */
export async function banNoticeForDevice(): Promise<AccountNotice | null> {
  const token = readNoticeToken()
  if (!supabase || !token) return null
  const { data, error } = await supabase.rpc('account_ban_notice_for_token', { token })
  if (error) return null
  return parseNotice(data)
}

export type CredentialBanCheck = { kind: 'banned'; notice: AccountNotice } | { kind: 'limited' } | { kind: 'unproven' } | { kind: 'unavailable' }

/** After Auth answers user_banned: reveals the ban only if the database proves the password. */
export async function banNoticeForCredentials(email: string, password: string): Promise<CredentialBanCheck> {
  if (!supabase) return { kind: 'unavailable' }
  const { data, error } = await supabase.rpc('account_ban_notice_for_credentials', { email: email.trim(), password })
  if (error) return { kind: 'unavailable' }
  if (data && typeof data === 'object' && (data as { limited?: unknown }).limited === true) return { kind: 'limited' }
  const notice = parseNotice(data)
  return notice ? { kind: 'banned', notice } : { kind: 'unproven' }
}
