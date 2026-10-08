import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { ApiRequest } from './http.js'
import { ApiError } from './http.js'

export interface AuthenticatedRequestContext {
  userId: string
  user: User
  userClient: SupabaseClient
  adminClient: SupabaseClient
}

function supabaseEnvironment() {
  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !anonKey || !serviceRoleKey) {
    throw new ApiError(503, 'backend_not_configured', 'The secure AI backend is not configured for this deployment yet.')
  }
  return { url, anonKey, serviceRoleKey }
}

export async function authenticateRequest(req: ApiRequest): Promise<AuthenticatedRequestContext> {
  const authorization = req.headers.authorization
  const match = typeof authorization === 'string' ? /^Bearer\s+([^\s]+)$/i.exec(authorization) : null
  if (!match?.[1]) throw new ApiError(401, 'unauthenticated', 'Sign in to use Stracker AI.')

  const { url, anonKey, serviceRoleKey } = supabaseEnvironment()
  const token = match[1]
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  const { data, error } = await authClient.auth.getUser(token)
  if (error || !data.user) throw new ApiError(401, 'unauthenticated', 'Your session has expired. Sign in again to use Stracker AI.')

  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
  const adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  return { userId: data.user.id, user: data.user, userClient, adminClient }
}

export function verifyOwnerRow<T extends { user_id?: string }>(row: T | null, userId: string): T {
  if (!row || row.user_id !== userId) throw new ApiError(404, 'not_found', 'That Stracker item could not be found in your account.')
  return row
}
