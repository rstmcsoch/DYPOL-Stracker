import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Passkeys belong to the owner alone (see consoleAssurance and the database trigger
 * control_enforce_owner_only_passkeys). These helpers only ever read or delete; registration
 * happens in the owner's browser through Supabase Auth.
 */
export async function ownerHasPasskey(admin: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data, error } = await admin.auth.admin.passkey.listPasskeys({ userId })
    return !error && Array.isArray(data) && data.length > 0
  } catch {
    return false
  }
}

/** Removes every passkey of an account. Passkeys may be switched off for the project: treated as none. */
export async function deleteAllPasskeys(admin: SupabaseClient, userId: string): Promise<number> {
  let removed = 0
  try {
    const { data, error } = await admin.auth.admin.passkey.listPasskeys({ userId })
    if (error || !Array.isArray(data)) return 0
    for (const passkey of data) {
      const { error: deleteError } = await admin.auth.admin.passkey.deletePasskey({ userId, passkeyId: passkey.id })
      if (!deleteError) removed += 1
    }
  } catch {
    return removed
  }
  return removed
}
