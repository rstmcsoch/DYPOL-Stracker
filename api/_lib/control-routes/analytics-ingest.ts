import { createHmac, createHash } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiRequest, ApiResponse } from '../http.js'
import { readJson, sendJson } from '../http.js'
import { clientKeyHash, serviceClient } from '../control.js'
import { logAIEvent } from '../diagnostics.js'
import { SOURCES, cleanRoute, sanitizeProps } from '../../../src/lib/telemetry/taxonomy.js'

/**
 * POST /api/control/analytics-ingest — public, unauthenticated, write-only.
 * Accepts a batch of ≤25 allowlisted events from the first-party tracker (sendBeacon).
 * Never returns stored data. Unknown events and properties are dropped and counted.
 * IPs are only used (hashed) for the rate limit and never stored. Always answers 202
 * so a broken analytics backend can never surface as an error in the app.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const short = (max: number) => z.string().trim().max(max).nullable().optional()
const batchSchema = z.object({
  context: z.object({
    session_id: z.string().regex(UUID),
    user_id: z.string().regex(UUID).nullable().optional(),
    test: z.boolean().optional(),
    device: z.enum(['mobile', 'tablet', 'desktop']).optional(),
    viewport: z.string().regex(/^\d{1,5}x\d{1,5}$/).optional(),
    browser: z.string().regex(/^[a-z]{2,12}$/).optional(),
    referrer: short(120),
    utm_source: short(80), utm_medium: short(80), utm_campaign: short(80)
  }),
  events: z.array(z.object({
    id: z.string().regex(UUID),
    name: z.string().min(1).max(60),
    ts: z.string().max(40),
    source: z.enum(SOURCES),
    route: z.string().max(300),
    props: z.unknown().optional()
  })).min(1).max(25)
})

export const INGEST_RATE = { limit: 60, windowSeconds: 60 }

/** Keyed pseudonym for an account id. Same input → same ref; not reversible without the key. */
export function userRef(userId: string, secret: string): string {
  return createHmac('sha256', `stracker-analytics:${secret}`).update(userId.toLowerCase()).digest('hex').slice(0, 32)
}

export function analyticsSecret(): string {
  const configured = process.env.ANALYTICS_HASH_SECRET
  if (configured && configured.length >= 16) return configured
  return createHash('sha256').update(`derived:${process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'unset'}`).digest('hex')
}

function deploymentEnv(): 'production' | 'preview' | 'development' {
  const env = process.env.VERCEL_ENV
  return env === 'production' || env === 'preview' ? env : 'development'
}

/** Client timestamps are trusted only within [-24h, +5min] of receipt. */
export function clampTimestamp(value: string, now = Date.now()): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || parsed < now - 86_400_000 || parsed > now + 300_000) return new Date(now).toISOString()
  return new Date(parsed).toISOString()
}

const cleanText = (value: string | null | undefined, max: number) => {
  // eslint-disable-next-line no-control-regex
  const text = (value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max)
  return text || null
}

export interface IngestResult { stored: number; duplicates: number; unknown: number }

export async function ingestBatch(admin: SupabaseClient, raw: unknown, now = Date.now()): Promise<IngestResult | null> {
  const parsed = batchSchema.safeParse(raw)
  if (!parsed.success) { await admin.rpc('analytics_bump_stat', { p_kind: 'invalid_batch', p_detail: '', p_count: 1 }); return null }
  const { context, events } = parsed.data
  const secret = analyticsSecret()
  const shared = {
    session_id: context.session_id,
    user_ref: context.user_id ? userRef(context.user_id, secret) : null,
    env: deploymentEnv(),
    deployment_id: cleanText(process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_URL?.split('.')[0] ?? null, 80),
    device: context.device ?? null,
    viewport: context.viewport ?? null,
    browser: context.browser ?? null,
    referrer_domain: cleanText(context.referrer?.toLowerCase().replace(/^www\./, ''), 120),
    utm_source: cleanText(context.utm_source, 80), utm_medium: cleanText(context.utm_medium, 80), utm_campaign: cleanText(context.utm_campaign, 80),
    is_test: context.test === true || deploymentEnv() !== 'production'
  }
  const unknown = new Map<string, number>()
  const rows = []
  for (const event of events) {
    const clean = sanitizeProps(event.name, event.props)
    if (!clean) { unknown.set(event.name.slice(0, 60), (unknown.get(event.name.slice(0, 60)) ?? 0) + 1); continue }
    rows.push({ ...shared, id: event.id, name: event.name, ts: clampTimestamp(event.ts, now), source: event.source, route: cleanRoute(event.route), props: clean.props, dropped_props: clean.dropped.slice(0, 10), missing_props: clean.missing.slice(0, 10) })
  }
  for (const [name, count] of unknown) await admin.rpc('analytics_bump_stat', { p_kind: 'unknown_event', p_detail: name, p_count: count })
  if (!rows.length) return { stored: 0, duplicates: 0, unknown: events.length }
  const { data, error } = await admin.from('analytics_events').upsert(rows, { onConflict: 'id', ignoreDuplicates: true }).select('id')
  if (error) throw error
  const stored = data?.length ?? 0
  const storedIds = new Set((data ?? []).map(row => String(row.id)))
  if (rows.length - stored > 0) await admin.rpc('analytics_bump_stat', { p_kind: 'duplicate', p_detail: '', p_count: rows.length - stored })
  for (const row of rows) {
    if (row.name !== 'app_error' || !storedIds.has(row.id)) continue
    const props = row.props as Record<string, string | number>
    await admin.rpc('analytics_record_error', { p_fingerprint: String(props.fingerprint ?? 'unknown'), p_kind: String(props.kind ?? 'error'), p_message: String(props.message ?? ''), p_route: row.route, p_count: 1, p_at: row.ts })
  }
  return { stored, duplicates: rows.length - stored, unknown: events.length - rows.length }
}

export async function analyticsIngestHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  res.setHeader('X-Robots-Tag', 'noindex')
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); sendJson(res, 405, { error: 'method_not_allowed', message: 'POST only.' }); return }
  try {
    const body = await readJson(req, 48_000)
    const { admin } = serviceClient()
    const { data: allowed, error: rateError } = await admin.rpc('control_take_rate_slot', { actor_key: clientKeyHash(req), bucket: 'analytics-ingest', per_limit: INGEST_RATE.limit, window_seconds: INGEST_RATE.windowSeconds })
    if (rateError || allowed !== true) {
      if (!rateError) await admin.rpc('analytics_bump_stat', { p_kind: 'rate_limited', p_detail: '', p_count: 1 })
      sendJson(res, 202, { ok: true, stored: 0 })
      return
    }
    const result = await ingestBatch(admin, body)
    sendJson(res, 202, { ok: true, stored: result?.stored ?? 0 })
  } catch (error) {
    // Tolerant: before the migration is applied, or on any backend issue, drop silently.
    logAIEvent('warn', 'analytics_ingest_dropped', { code: (error as { code?: string })?.code ?? 'error' })
    sendJson(res, 202, { ok: true, stored: 0 })
  }
}
