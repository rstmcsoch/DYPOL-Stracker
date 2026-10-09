import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './http.js'

export interface RateBucket {
  bucket: string
  limit: number
  windowSeconds: number
}

const MISSING_FUNCTION = /ai_take_rate_slot|PGRST202|42883|schema cache|could not find the function/i

/**
 * Durable per-user limit for expensive AI endpoints.
 * Prefers the database function (row lock, works across serverless isolates).
 * If that migration is not applied yet, falls back to counting recent audit rows.
 */
export async function takeRateSlot(admin: SupabaseClient, userId: string, bucket: RateBucket): Promise<void> {
  const { data, error } = await admin.rpc('ai_take_rate_slot', {
    owner: userId,
    bucket: bucket.bucket,
    per_user_limit: bucket.limit,
    window_seconds: bucket.windowSeconds
  })
  if (!error) {
    if (data !== true) throw limited()
    return
  }
  if (!MISSING_FUNCTION.test(`${error.message ?? ''} ${error.code ?? ''}`)) {
    throw new ApiError(503, 'rate_limit_unavailable', 'Stracker could not check the request limit. Try again in a moment.')
  }
  await takeRateSlotFallback(admin, userId, bucket)
}

function limited(): ApiError {
  return new ApiError(429, 'request_limit', 'You have sent several AI requests recently. Wait a minute and try again.')
}

async function takeRateSlotFallback(admin: SupabaseClient, userId: string, bucket: RateBucket): Promise<void> {
  const since = new Date(Date.now() - bucket.windowSeconds * 1000).toISOString()
  const { count, error } = await admin.from('ai_action_audit')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('tool_name', bucket.bucket)
    .eq('action', 'rate_slot')
    .gte('created_at', since)
  if (error) throw new ApiError(503, 'rate_limit_unavailable', 'Stracker could not check the request limit. Try again in a moment.')
  if ((count ?? 0) >= bucket.limit) throw limited()
  const { error: insertError } = await admin.from('ai_action_audit').insert({
    user_id: userId,
    tool_name: bucket.bucket,
    action: 'rate_slot',
    success: true,
    details: {}
  })
  if (insertError) throw new ApiError(503, 'rate_limit_unavailable', 'Stracker could not check the request limit. Try again in a moment.')
}

export const CHAT_RATE: RateBucket = { bucket: 'chat', limit: 10, windowSeconds: 60 }
export const CONNECTION_TEST_RATE: RateBucket = { bucket: 'connection_test', limit: 6, windowSeconds: 60 }
export const MODEL_DISCOVERY_RATE: RateBucket = { bucket: 'model_discovery', limit: 12, windowSeconds: 60 }
