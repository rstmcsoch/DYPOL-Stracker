import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../http.js'

export interface AuthUserRecord {
  id: string
  email?: string
  created_at?: string
  email_confirmed_at?: string | null
  last_sign_in_at?: string | null
  banned_until?: string | null
  app_metadata?: Record<string, unknown>
}

const PAGE_SIZE = 200
const MAX_PAGES = 500

/** Bounded page through Supabase Auth. Never returns factors, identities or credentials. */
export async function listAuthUsers(admin: SupabaseClient, unavailable = 'directory_unavailable', message = 'The user directory could not be loaded from Supabase Auth.'): Promise<AuthUserRecord[]> {
  const users: AuthUserRecord[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE })
    if (error) throw new ApiError(503, unavailable, message)
    const batch = (data?.users ?? []) as AuthUserRecord[]
    users.push(...batch.map(sanitizeAuthUser))
    if (batch.length < PAGE_SIZE) return users
  }
  throw new ApiError(503, unavailable, 'The user directory exceeded the safe pagination limit.')
}

export async function getAuthUser(admin: SupabaseClient, id: string): Promise<AuthUserRecord> {
  const { data, error } = await admin.auth.admin.getUserById(id)
  if (error || !data?.user) throw new ApiError(404, 'user_not_found', 'That account could not be found.')
  return sanitizeAuthUser(data.user as AuthUserRecord)
}

export function isAccountSuspended(user: { banned_until?: string | null }, now = Date.now()): boolean {
  return Boolean(user.banned_until && Date.parse(user.banned_until) > now)
}

export function signInMethodOf(user: AuthUserRecord): string | null {
  const provider = user.app_metadata?.provider
  return typeof provider === 'string' && provider.length <= 40 ? provider : null
}

function sanitizeAuthUser(user: AuthUserRecord): AuthUserRecord {
  return {
    id: user.id,
    email: user.email,
    created_at: user.created_at,
    email_confirmed_at: user.email_confirmed_at,
    last_sign_in_at: user.last_sign_in_at,
    banned_until: user.banned_until,
    app_metadata: user.app_metadata && typeof user.app_metadata.provider === 'string'
      ? { provider: user.app_metadata.provider }
      : undefined
  }
}
