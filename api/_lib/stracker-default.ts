import type { SupabaseClient } from '@supabase/supabase-js'
import { runtimeHealth, type ProviderConfigRow } from './registry.js'
import { publicCompanyName } from './model-company.js'

/**
 * Stracker AI (Default): the owner's site-wide providers that every signed-in student can use.
 * Students only ever see the brand name, the active model name and a ready/unavailable state.
 * Keys, key hints, endpoints, vendor IDs and the owner's identity never leave the server.
 */
export const STRACKER_AI_NAME = 'Stracker AI (Default)'
export const STRACKER_PROVIDER_ID = 'stracker'
export const STRACKER_UNAVAILABLE = 'Stracker AI’s default models are not responding right now. Add your own AI model in the Stracker AI window (Add your own model) or in Settings → AI Assistant to keep going.'
export const STRACKER_DAILY_LIMIT = 'You have reached today’s Stracker AI limit. Add your own AI model to keep going, or try again tomorrow.'
export const STRACKER_MINUTE_LIMIT = 'Stracker AI is handling several of your requests. Wait a minute and try again, or add your own AI model.'

export interface SiteAISettings { enabled: boolean; perUserPerMinute: number; perUserDaily: number }
export const DEFAULT_SITE_AI_SETTINGS: SiteAISettings = { enabled: true, perUserPerMinute: 4, perUserDaily: 40 }
export type AIPreference = 'stracker' | 'own'

export type SiteProviderRow = ProviderConfigRow & { site: true }

export function isSiteRow(row: ProviderConfigRow): row is SiteProviderRow {
  return (row as Partial<SiteProviderRow>).site === true
}

/** Provider ID recorded and shown for a row: the default is always just "stracker". */
export function publicProviderId(row: ProviderConfigRow): string {
  return isSiteRow(row) ? STRACKER_PROVIDER_ID : row.provider_id
}

export function publicProviderName(row: ProviderConfigRow): string {
  return isSiteRow(row) ? STRACKER_AI_NAME : row.display_name || row.provider_id
}

/**
 * The only model detail students see for a Stracker AI (Default) row: company + family
 * (e.g. "Google Gemini", "NVIDIA Nemotron"), or "Stracker AI" when unknown. Never the model ID or owner label.
 */
export function publicSiteModelName(row: Pick<ProviderConfigRow, 'provider_id' | 'model_id' | 'capabilities'>): string {
  return publicCompanyName(row.provider_id, row.model_id, (row.capabilities as unknown as Record<string, unknown> | null | undefined)?.company)
}

/** Model ID shown and stored for students: the company for Stracker AI rows, the real ID for their own. */
export function publicModelId(row: ProviderConfigRow): string {
  return isSiteRow(row) ? publicSiteModelName(row) : row.model_id
}

/** Human model name, e.g. "models/gemini-3.6-flash" → "gemini-3.6-flash". */
export function friendlyModelName(modelId: string): string {
  return modelId.replace(/^models\//, '').trim().slice(0, 120)
}

export function normalizeSiteSettings(row: Record<string, unknown> | null | undefined): SiteAISettings {
  const int = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback
  return {
    enabled: typeof row?.enabled === 'boolean' ? row.enabled : DEFAULT_SITE_AI_SETTINGS.enabled,
    perUserPerMinute: int(row?.per_user_per_minute, 1, 60, DEFAULT_SITE_AI_SETTINGS.perUserPerMinute),
    perUserDaily: int(row?.per_user_daily, 1, 1000, DEFAULT_SITE_AI_SETTINGS.perUserDaily)
  }
}

export async function readSiteSettings(admin: SupabaseClient): Promise<SiteAISettings> {
  const { data } = await admin.from('site_ai_settings').select('enabled,per_user_per_minute,per_user_daily').eq('id', 1).maybeSingle()
  return normalizeSiteSettings(data as Record<string, unknown> | null)
}

/** Enabled site providers in the owner's fallback order (priority 1 first). Read failures mean "none". */
export async function readSiteProviders(admin: SupabaseClient): Promise<SiteProviderRow[]> {
  const { data, error } = await admin.from('site_ai_providers').select('*').eq('enabled', true).order('priority', { ascending: true }).order('created_at', { ascending: true })
  if (error) return []
  return ((data ?? []) as ProviderConfigRow[]).map(row => ({ ...row, site: true as const }))
}

export function derivePreference(stored: string | null | undefined, userRows: ProviderConfigRow[]): AIPreference {
  if (stored === 'stracker') return 'stracker'
  const usable = (row: ProviderConfigRow) => row.enabled && row.connection_status === 'connected'
  // "Own" only holds while the student still has a working provider; otherwise Stracker AI answers.
  if (stored === 'own') return userRows.some(usable) ? 'own' : 'stracker'
  // No explicit choice: the owner's Stracker AI models come first, the student's own models follow.
  return 'stracker'
}

export async function readStoredPreference(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin.from('ai_user_preferences').select('preferred').eq('user_id', userId).maybeSingle()
  return (data as { preferred?: string } | null)?.preferred ?? null
}

export async function writePreference(admin: SupabaseClient, userId: string, preferred: AIPreference): Promise<boolean> {
  const { error } = await admin.from('ai_user_preferences').upsert({ user_id: userId, preferred, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  return !error
}

export interface PublicStrackerStatus {
  name: string
  model: string | null
  status: 'ready' | 'unavailable'
  preferred: boolean
  dailyLimit: number
  usedToday: number
}

/**
 * The ONLY description of the default that reaches students. Built field by field from safe
 * values so a new column on the provider row can never leak by accident.
 */
export function publicStrackerStatus(input: { settings: SiteAISettings; rows: ProviderConfigRow[]; preference: AIPreference; usedToday: number }): PublicStrackerStatus {
  const ready = input.settings.enabled ? input.rows.filter(row => row.enabled && runtimeHealth(row) === 'ready') : []
  const active = ready[0] ?? null
  return {
    name: STRACKER_AI_NAME,
    model: active ? publicSiteModelName(active) : null,
    status: active ? 'ready' : 'unavailable',
    preferred: input.preference === 'stracker',
    dailyLimit: input.settings.perUserDaily,
    usedToday: Math.max(0, Math.min(input.settings.perUserDaily, Math.trunc(input.usedToday)))
  }
}

export const STRACKER_MINUTE_BUCKET = 'stracker_minute'
export const STRACKER_DAY_BUCKET = 'stracker_day'

export async function strackerUsedToday(admin: SupabaseClient, userId: string): Promise<number> {
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const { count } = await admin.from('ai_rate_events').select('user_id', { count: 'exact', head: true }).eq('user_id', userId).eq('bucket', STRACKER_DAY_BUCKET).gt('created_at', since)
  return count ?? 0
}

/** Takes one default-provider request slot: per-minute first, then the rolling 24-hour cap. */
export async function takeStrackerSlot(admin: SupabaseClient, userId: string, settings: SiteAISettings): Promise<'ok' | 'minute' | 'day' | 'unavailable'> {
  const take = async (bucket: string, limit: number, windowSeconds: number) => {
    const { data, error } = await admin.rpc('ai_take_rate_slot', { owner: userId, bucket, per_user_limit: limit, window_seconds: windowSeconds })
    return error ? null : data === true
  }
  const minute = await take(STRACKER_MINUTE_BUCKET, settings.perUserPerMinute, 60)
  if (minute === null) return 'unavailable'
  if (!minute) return 'minute'
  const day = await take(STRACKER_DAY_BUCKET, settings.perUserDaily, 86_400)
  if (day === null) return 'unavailable'
  return day ? 'ok' : 'day'
}

/**
 * Owner reorder of the Stracker AI fallback chain: moves one model a place earlier ('up') or
 * later ('down') and rewrites priorities as 1..n so the order is always gap-free and unique.
 */
export async function reorderSiteProviders(admin: SupabaseClient, id: string, direction: 'up' | 'down'): Promise<{ order: string[]; position: number } | 'not_found' | 'failed'> {
  const { data, error } = await admin.from('site_ai_providers').select('id,priority,created_at').order('priority', { ascending: true }).order('created_at', { ascending: true })
  if (error || !data) return 'failed'
  const rows = [...(data as Array<{ id: string; priority?: number | null; created_at?: string | null }>)]
    .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  const order = rows.map(row => row.id)
  const from = order.indexOf(id)
  if (from < 0) return 'not_found'
  const to = direction === 'up' ? Math.max(0, from - 1) : Math.min(order.length - 1, from + 1)
  if (to !== from) [order[from], order[to]] = [order[to]!, order[from]!]
  const results = await Promise.all(order.map((rowId, index) => admin.from('site_ai_providers').update({ priority: index + 1 }).eq('id', rowId)))
  if (results.some(result => result.error)) return 'failed'
  return { order, position: to + 1 }
}
