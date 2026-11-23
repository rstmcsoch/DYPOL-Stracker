import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { ApiError } from '../http.js'
import { SITE_PROVIDER_TABLE } from '../provider-scope.js'
import {
  normalizeProviderSetup,
  runtimeHealth,
  safeProviderConfig,
  type ProviderConfigRow,
  type ProviderSetup,
  type SafeProviderConfig
} from '../registry.js'
import { decryptCredential, encryptCredential, maskedCredential, redactPotentialSecrets } from '../secrets.js'
import { issueModelApproval, verifyModelApproval } from '../model-approval.js'
import { discoverProviderModels, type ModelDiscoveryResult } from '../models.js'
import { providerCallFromConfig, safeProviderError, testProviderConnection } from '../provider-adapters.js'
import { evaluateServerConfig } from '../server-config.js'
import { istDayStart, readSiteSettings, reorderSiteProviders, STRACKER_DAY_BUCKET, type SiteProviderRow } from '../stracker-default.js'
import { logAIEvent } from '../diagnostics.js'
import { connectionStatusFor } from '../ai-errors.js'
import { maskStoredModel } from '../model-company.js'
import { rankCustomModels } from '../../../src/lib/ai/custom-model-ranking.js'
import { getExamAiModelPreferences, updateExamAiModelPreferences } from './exam-catalogue.js'

/** Approval tokens issued by Master MCP are bound to this subject, never to a fabricated owner UUID. */
export const MASTER_AI_APPROVAL_SUBJECT = 'master_mcp'
const ACTIVE_TASK_STATUSES = ['queued', 'running', 'tool_call', 'waiting', 'fallback', 'retrying']
const TASK_COLUMNS = 'id,user_id,conversation_id,request_id,provider_id,model_id,task_type,status,progress,started_at,completed_at,updated_at'
const CREDENTIAL_KEY = /^(api[_-]?key|encrypted_api_key|encrypted|key_hint|authorization|secret|password|credential|token_hash|provider_config)$/i
const ENVELOPE = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/

export const siteAiAdapters = {
  discover: discoverProviderModels,
  testConnection: testProviderConnection,
  callFromConfig: providerCallFromConfig
}

export function apiKeyFingerprint(apiKey: string): string {
  return createHash('sha256').update(`stracker-master-mcp-key:${apiKey}`).digest('base64url')
}

/** Recursively drop credential material so tool results, previews, logs and audits never carry keys or envelopes. */
export function stripCredentialMaterial(value: unknown, depth = 0): unknown {
  if (value == null || depth > 12) return value
  if (typeof value === 'string') {
    if (ENVELOPE.test(value)) return '[redacted credential]'
    return redactPotentialSecrets(value)
  }
  if (Array.isArray(value)) return value.map(item => stripCredentialMaterial(item, depth + 1))
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (CREDENTIAL_KEY.test(key)) continue
      output[key] = stripCredentialMaterial(item, depth + 1)
    }
    return output
  }
  return value
}

export function publicSiteProvider(row: ProviderConfigRow): SafeProviderConfig {
  return stripCredentialMaterial(safeProviderConfig(row)) as SafeProviderConfig
}

function asSiteRow(row: ProviderConfigRow | Record<string, unknown>): SiteProviderRow {
  return { ...(row as ProviderConfigRow), site: true as const }
}

async function loadSiteProvider(admin: SupabaseClient, id: string): Promise<SiteProviderRow> {
  const parsed = z.uuid().safeParse(id)
  if (!parsed.success) throw new ApiError(400, 'invalid_provider', 'Choose a saved site AI provider.')
  const { data, error } = await admin.from(SITE_PROVIDER_TABLE).select('*').eq('id', parsed.data).maybeSingle()
  if (error) throw new ApiError(503, 'provider_config_unavailable', 'The site AI provider could not be loaded. Try again shortly.')
  if (!data) throw new ApiError(404, 'provider_not_found', 'That site AI provider was not found.')
  return asSiteRow(data as ProviderConfigRow)
}

async function listAllSiteProviders(admin: SupabaseClient): Promise<SiteProviderRow[]> {
  const { data, error } = await admin.from(SITE_PROVIDER_TABLE).select('*').order('priority', { ascending: true }).order('created_at', { ascending: true })
  if (error) throw new ApiError(503, 'provider_config_unavailable', 'Site AI providers could not be loaded. Try again shortly.')
  return ((data ?? []) as ProviderConfigRow[]).map(asSiteRow)
}

function setupFromRow(row: ProviderConfigRow): ProviderSetup {
  return {
    providerId: row.provider_id,
    displayName: row.display_name,
    modelId: row.model_id,
    baseUrl: row.base_url,
    protocol: row.protocol,
    organizationId: row.organization_id,
    region: row.provider_config?.region === 'china' ? 'china' : 'international',
    capabilities: row.capabilities
  }
}

function customIsApproved(providerId: string, approvalToken: string | undefined, setup: ProviderSetup, apiKey: string): boolean {
  if (providerId !== 'custom') return true
  return verifyModelApproval(approvalToken, {
    userId: MASTER_AI_APPROVAL_SUBJECT,
    baseUrl: setup.baseUrl,
    protocol: setup.protocol,
    modelId: setup.modelId,
    apiKey
  })
}

function customReady(row: ProviderConfigRow): boolean {
  return row.provider_id !== 'custom' || row.connection_status === 'connected'
}

async function nextPriority(admin: SupabaseClient): Promise<number> {
  const { data: last } = await admin.from(SITE_PROVIDER_TABLE).select('priority').order('priority', { ascending: false }).limit(1).maybeSingle()
  return (Number((last as { priority?: number } | null)?.priority) || 0) + 1
}

async function clearDefaultExcept(admin: SupabaseClient, id: string) {
  await admin.from(SITE_PROVIDER_TABLE).update({ is_default: false, updated_by: null, updated_at: new Date().toISOString() }).eq('is_default', true).neq('id', id)
}

const ALLOWED_CONNECTION_STATUS = new Set(['not_tested','connected','authentication_failed','rate_limited','provider_unavailable','model_unavailable','configuration_incomplete','unsupported'])
function allowedConnectionStatus(status: string): string {
  return ALLOWED_CONNECTION_STATUS.has(status) ? status : 'provider_unavailable'
}

export async function getSiteAiStatus(admin: SupabaseClient) {
  const [settings, providers] = await Promise.all([readSiteSettings(admin), listAllSiteProviders(admin)])
  const config = evaluateServerConfig()
  return stripCredentialMaterial({
    settings: { enabled: settings.enabled, perUserPerMinute: settings.perUserPerMinute, perUserDaily: settings.perUserDaily },
    providerCount: providers.length,
    enabledCount: providers.filter(row => row.enabled).length,
    providers: providers.map(publicSiteProvider),
    encryption: { configured: config.checks.credentialEncryption, reason: config.reason }
  })
}

export async function listSiteAiProviders(admin: SupabaseClient) {
  const providers = await listAllSiteProviders(admin)
  return stripCredentialMaterial({ providers: providers.map(publicSiteProvider), total: providers.length })
}

export async function getAiProviderHealth(admin: SupabaseClient) {
  const providers = await listAllSiteProviders(admin)
  return stripCredentialMaterial({
    providers: providers.map(row => ({
      id: row.id,
      provider_id: row.provider_id,
      display_name: row.display_name,
      model_label: publicSiteProvider(row).model_label,
      masked_key: publicSiteProvider(row).masked_key,
      enabled: row.enabled,
      is_default: row.is_default,
      connection_status: row.connection_status,
      runtime_health: runtimeHealth(row),
      last_checked_at: row.last_checked_at,
      cooldown_until: row.cooldown_until
    }))
  })
}

export async function getAiUsage(admin: SupabaseClient, now = Date.now()) {
  const since = istDayStart(now).toISOString()
  const { data, error } = await admin.from('ai_rate_events').select('user_id').eq('bucket', STRACKER_DAY_BUCKET).gte('created_at', since)
  if (error) return { available: false as const, reason: 'usage_unavailable', since, timezone: 'Asia/Calcutta' }
  const rows = data ?? []
  const { count: activeTasks, error: taskError } = await admin.from('ai_tasks').select('id', { count: 'exact', head: true }).in('status', ACTIVE_TASK_STATUSES)
  if (taskError) return { available: false as const, reason: 'usage_unavailable', since, timezone: 'Asia/Calcutta' }
  return {
    available: true as const,
    since,
    timezone: 'Asia/Calcutta',
    requestsToday: rows.length,
    uniqueUsersToday: new Set(rows.map(row => String((row as { user_id?: string }).user_id ?? ''))).size,
    activeTasks: activeTasks ?? 0
  }
}

const providerWriteSchema = z.object({
  id: z.uuid().optional(),
  providerId: z.string(),
  displayName: z.string().optional(),
  modelId: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().nullable().optional(),
  protocol: z.enum(['google', 'openai-compatible', 'anthropic-compatible']).optional(),
  organizationId: z.string().nullable().optional(),
  region: z.enum(['international', 'china']).optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  approvalToken: z.string().max(400).optional()
}).strict()

export async function saveSiteAiProvider(admin: SupabaseClient, input: unknown, mode: 'add' | 'update') {
  const parsed = providerWriteSchema.safeParse(input)
  if (!parsed.success) throw new ApiError(400, 'invalid_provider_configuration', 'Check the provider, model, and connection details, then try again.')
  const { approvalToken, ...body } = parsed.data
  if (mode === 'add' && body.id) throw new ApiError(400, 'invalid_provider_configuration', 'Do not send an existing id when adding a site AI provider.')
  if (mode === 'update' && !body.id) throw new ApiError(400, 'invalid_provider_configuration', 'Choose the site AI provider to update.')
  const existing = body.id ? await loadSiteProvider(admin, body.id) : null
  if (mode === 'update' && !existing) throw new ApiError(404, 'provider_not_found', 'That site AI provider was not found.')
  if (mode === 'add' && !body.apiKey) throw new ApiError(400, 'credential_required', 'An API key is required to add a site AI provider.')
  const setup = await normalizeProviderSetup(body as unknown as Record<string, unknown>)
  const rawKey = setup.apiKey?.trim() || (existing ? decryptCredential(existing.encrypted_api_key) : '')
  if (!rawKey) throw new ApiError(400, 'credential_required', 'An API key is required to save this site AI provider.')
  const approved = customIsApproved(setup.providerId, approvalToken, setup, rawKey)
  const keyChanged = Boolean(setup.apiKey)
  const now = new Date().toISOString()
  const row: Record<string, unknown> = {
    id: existing?.id ?? crypto.randomUUID(),
    provider_id: setup.providerId,
    display_name: setup.displayName,
    model_id: setup.modelId,
    base_url: setup.baseUrl,
    protocol: setup.protocol,
    organization_id: setup.organizationId,
    provider_config: { region: setup.region },
    capabilities: setup.capabilities ?? existing?.capabilities ?? {},
    encrypted_api_key: keyChanged || !existing ? encryptCredential(rawKey) : existing.encrypted_api_key,
    key_hint: (keyChanged || !existing ? rawKey : existing.key_hint).slice(-4),
    enabled: approved ? (existing?.enabled ?? false) : false,
    is_default: approved ? (existing?.is_default ?? false) : false,
    connection_status: approved && setup.providerId === 'custom' ? 'connected' : (keyChanged || !approved ? 'not_tested' : existing?.connection_status ?? 'not_tested'),
    last_checked_at: approved && setup.providerId === 'custom' ? now : (keyChanged || !approved ? null : existing?.last_checked_at ?? null),
    cooldown_until: null,
    failure_count: keyChanged ? 0 : existing?.failure_count ?? 0,
    updated_by: null,
    updated_at: now
  }
  if (!existing) {
    row.created_at = now
    row.priority = await nextPriority(admin)
  }
  const { data, error } = existing
    ? await admin.from(SITE_PROVIDER_TABLE).update(row).eq('id', existing.id).select('*').maybeSingle()
    : await admin.from(SITE_PROVIDER_TABLE).insert(row).select('*').maybeSingle()
  if (error || !data) throw new ApiError(503, 'provider_save_failed', 'The provider configuration could not be saved. No AI request was sent.')
  return stripCredentialMaterial({
    ok: true,
    saved: true,
    changed: keyChanged,
    approved,
    provider: publicSiteProvider(asSiteRow(data as ProviderConfigRow)),
    note: approved ? undefined : 'Custom providers stay disabled and cannot be the default until a valid discovery approval token is provided.'
  })
}

export async function replaceSiteAiApiKey(admin: SupabaseClient, id: string, apiKey: string) {
  const existing = await loadSiteProvider(admin, id)
  const trimmed = apiKey.trim()
  if (!trimmed || trimmed.length > 2048 || /[\r\n]/.test(trimmed)) throw new ApiError(400, 'invalid_api_key', 'The API key format is not valid.')
  const now = new Date().toISOString()
  const { data, error } = await admin.from(SITE_PROVIDER_TABLE).update({
    encrypted_api_key: encryptCredential(trimmed),
    key_hint: trimmed.slice(-4),
    connection_status: 'not_tested',
    last_checked_at: null,
    cooldown_until: null,
    failure_count: 0,
    updated_by: null,
    updated_at: now
  }).eq('id', existing.id).select('*').maybeSingle()
  if (error || !data) throw new ApiError(503, 'provider_save_failed', 'The API key could not be replaced. Nothing changed.')
  return stripCredentialMaterial({
    ok: true,
    provider: publicSiteProvider(asSiteRow(data as ProviderConfigRow)),
    masked_key: maskedCredential(trimmed),
    connection_status: 'not_tested'
  })
}

export function replaceKeyPreview(existing: ProviderConfigRow, apiKey: string) {
  return stripCredentialMaterial({
    existing: { masked_key: `••••••••••••${existing.key_hint}`, provider_id: existing.provider_id, model_id: existing.model_id },
    proposed: { masked_key: maskedCredential(apiKey), connection_status: 'not_tested' }
  })
}

async function discoverFromSaved(admin: SupabaseClient, id: string) {
  const row = await loadSiteProvider(admin, id)
  const setup = setupFromRow(row)
  const key = decryptCredential(row.encrypted_api_key)
  const started = Date.now()
  try {
    const result: ModelDiscoveryResult = await siteAiAdapters.discover(setup, key)
    if (setup.providerId === 'custom' && result.candidates) {
      const ranked = rankCustomModels(result.candidates)
      const verified: string[] = []
      for (const modelId of ranked.slice(0, 8)) {
        try {
          const controller = new AbortController()
          const probeRow = { ...row, model_id: modelId }
          await siteAiAdapters.testConnection(siteAiAdapters.callFromConfig(probeRow, key, '', [], [], controller.signal, () => undefined, 256))
          verified.push(modelId)
        } catch {
          // Probe failures stay local; they must not leak the key.
        }
        if (verified.length >= 5) break
      }
      const approvals: Record<string, string> = {}
      for (const modelId of verified) {
        const token = issueModelApproval({
          userId: MASTER_AI_APPROVAL_SUBJECT,
          baseUrl: setup.baseUrl,
          protocol: setup.protocol,
          modelId,
          apiKey: key
        })
        if (token) approvals[modelId] = token
      }
      const listed = (result.models ?? []).filter(model => verified.includes(model.id))
      logAIEvent('info', 'master_custom_model_probe', { provider: 'custom', listed: result.candidates.length, passed: verified.length, durationMs: Date.now() - started })
      return stripCredentialMaterial({
        discoveryAvailable: result.discoveryAvailable,
        models: listed,
        rankedModelIds: verified,
        approvals,
        probe: { listed: result.candidates.length, passed: verified.length },
        message: result.message
      })
    }
    const { candidates: _ignored, ...listed } = result
    void _ignored
    logAIEvent('info', 'master_model_discovery', { provider: setup.providerId, count: listed.models.length, durationMs: Date.now() - started })
    return stripCredentialMaterial({ ...listed })
  } catch (error) {
    const failure = safeProviderError(error, { provider: setup.providerId, model: setup.modelId })
    logAIEvent('warn', 'master_model_discovery_failed', { provider: setup.providerId, model: setup.modelId, code: failure.aiCode, durationMs: Date.now() - started })
    throw failure
  }
}

export async function discoverSiteAiModels(admin: SupabaseClient, id: string) {
  return discoverFromSaved(admin, id)
}

export async function testSiteAiProvider(admin: SupabaseClient, id: string) {
  const row = await loadSiteProvider(admin, id)
  const key = decryptCredential(row.encrypted_api_key)
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    await siteAiAdapters.testConnection(siteAiAdapters.callFromConfig(row, key, '', [], [], controller.signal, () => undefined, 512))
    const now = new Date().toISOString()
    const { count: defaults } = await admin.from(SITE_PROVIDER_TABLE).select('id', { count: 'exact', head: true }).eq('is_default', true)
    const recovering = row.connection_status !== 'connected'
    const isDefault = row.is_default || (recovering && (defaults ?? 0) === 0)
    await admin.from(SITE_PROVIDER_TABLE).update({
      connection_status: 'connected',
      enabled: recovering ? true : row.enabled,
      is_default: isDefault,
      last_checked_at: now,
      cooldown_until: null,
      failure_count: 0,
      updated_by: null,
      updated_at: now
    }).eq('id', row.id)
    if (isDefault) await clearDefaultExcept(admin, row.id)
    const updated = await loadSiteProvider(admin, row.id)
    logAIEvent('info', 'master_connection_test_succeeded', { provider: row.provider_id, model: row.model_id, durationMs: Date.now() - started })
    return stripCredentialMaterial({
      status: 'connected',
      latencyMs: Date.now() - started,
      provider: publicSiteProvider(updated),
      message: 'Connection successful. Stracker can now use this provider.'
    })
  } catch (error) {
    const failure = safeProviderError(error, { provider: row.provider_id, model: row.model_id })
    logAIEvent('warn', 'master_connection_test_failed', { provider: row.provider_id, model: row.model_id, durationMs: Date.now() - started, code: failure.aiCode })
    const now = new Date().toISOString()
    await admin.from(SITE_PROVIDER_TABLE).update({
      connection_status: allowedConnectionStatus(connectionStatusFor(failure.aiCode)),
      last_checked_at: now,
      updated_by: null,
      updated_at: now
    }).eq('id', row.id)
    throw failure
  } finally {
    clearTimeout(timer)
  }
}

export async function setSiteAiProviderEnabled(admin: SupabaseClient, id: string, enabled: boolean) {
  const row = await loadSiteProvider(admin, id)
  if (enabled && !customReady(row)) {
    throw new ApiError(400, 'approval_required', 'This custom provider cannot be enabled until it is approved or a connection test succeeds.')
  }
  const patch: Record<string, unknown> = {
    enabled,
    is_default: enabled ? row.is_default : false,
    updated_by: null,
    updated_at: new Date().toISOString()
  }
  const { data, error } = await admin.from(SITE_PROVIDER_TABLE).update(patch).eq('id', row.id).select('*').maybeSingle()
  if (error || !data) throw new ApiError(503, 'provider_save_failed', 'The provider setting could not be updated. Nothing changed.')
  return stripCredentialMaterial({ ok: true, provider: publicSiteProvider(asSiteRow(data as ProviderConfigRow)) })
}

export async function setDefaultSiteAiProvider(admin: SupabaseClient, id: string) {
  const row = await loadSiteProvider(admin, id)
  if (!customReady(row)) {
    throw new ApiError(400, 'approval_required', 'This custom provider cannot be the default until it is approved or a connection test succeeds.')
  }
  if (!row.enabled) throw new ApiError(400, 'provider_disabled', 'Enable the provider before making it the default.')
  await clearDefaultExcept(admin, row.id)
  const { data, error } = await admin.from(SITE_PROVIDER_TABLE).update({
    is_default: true, enabled: true, updated_by: null, updated_at: new Date().toISOString()
  }).eq('id', row.id).select('*').maybeSingle()
  if (error || !data) throw new ApiError(503, 'provider_save_failed', 'The default provider could not be updated. Nothing changed.')
  return stripCredentialMaterial({ ok: true, provider: publicSiteProvider(asSiteRow(data as ProviderConfigRow)) })
}

export async function reorderSiteAiProviders(admin: SupabaseClient, id: string, direction: 'up' | 'down') {
  const result = await reorderSiteProviders(admin, id, direction)
  if (result === 'not_found') throw new ApiError(404, 'provider_not_found', 'That site AI provider was not found.')
  if (result === 'failed') throw new ApiError(503, 'provider_order_failed', 'The provider order could not be saved. Reload and try again.')
  return { ok: true, ...result }
}

export async function removeSiteAiProvider(admin: SupabaseClient, id: string) {
  const row = await loadSiteProvider(admin, id)
  const { error, count } = await admin.from(SITE_PROVIDER_TABLE).delete().eq('id', row.id)
  if (error) throw new ApiError(503, 'provider_delete_failed', 'The provider could not be removed. Nothing changed.')
  if (!count && count !== undefined) throw new ApiError(404, 'provider_not_found', 'That site AI provider was not found.')
  return { ok: true, removed: true, id: row.id, provider_id: row.provider_id }
}

export async function updateSiteAiLimits(admin: SupabaseClient, input: unknown) {
  const parsed = z.object({
    enabled: z.boolean().optional(),
    perUserPerMinute: z.number().int().min(1).max(60).optional(),
    perUserDaily: z.number().int().min(1).max(1000).optional()
  }).strict().safeParse(input)
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Limits must be 1–60 requests per minute and 1–1000 per day.')
  if (!Object.keys(parsed.data).length) throw new ApiError(400, 'invalid_request', 'Send at least one limit or the enabled flag.')
  const current = await readSiteSettings(admin)
  const next = {
    enabled: parsed.data.enabled ?? current.enabled,
    per_user_per_minute: parsed.data.perUserPerMinute ?? current.perUserPerMinute,
    per_user_daily: parsed.data.perUserDaily ?? current.perUserDaily,
    updated_by: null,
    updated_at: new Date().toISOString()
  }
  const { error } = await admin.from('site_ai_settings').upsert({ id: 1, ...next }, { onConflict: 'id' })
  if (error) throw new ApiError(503, 'settings_save_failed', 'The site AI limits were not saved. Nothing changed.')
  return { ok: true, settings: { enabled: next.enabled, perUserPerMinute: next.per_user_per_minute, perUserDaily: next.per_user_daily } }
}

export const getAiModelPreferences = getExamAiModelPreferences
export const updateAiModelPreferences = updateExamAiModelPreferences

function safeTask(row: Record<string, unknown>) {
  const masked = maskStoredModel({
    id: row.id,
    user_id: row.user_id,
    conversation_id: row.conversation_id,
    request_id: row.request_id,
    provider_id: row.provider_id,
    model_id: row.model_id,
    task_type: row.task_type,
    status: row.status,
    progress: typeof row.progress === 'string' ? redactPotentialSecrets(row.progress) : '',
    started_at: row.started_at,
    completed_at: row.completed_at,
    updated_at: row.updated_at
  })
  return stripCredentialMaterial(masked)
}

export async function listAiTasks(admin: SupabaseClient, input: { studentId?: string; status?: string; page?: number; pageSize?: number }) {
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 20
  let query = admin.from('ai_tasks').select(TASK_COLUMNS, { count: 'exact' }).order('started_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1)
  if (input.studentId) query = query.eq('user_id', input.studentId)
  if (input.status) query = query.eq('status', input.status)
  const { data, error, count } = await query
  if (error) throw new ApiError(503, 'tasks_unavailable', 'AI task status could not be loaded. Try again shortly.')
  return { tasks: (data ?? []).map(row => safeTask(row as Record<string, unknown>)), total: count ?? (data ?? []).length, page, pageSize }
}

export async function getAiTask(admin: SupabaseClient, input: { id?: string; requestId?: string; studentId?: string }) {
  let query = admin.from('ai_tasks').select(TASK_COLUMNS)
  if (input.id) query = query.eq('id', input.id)
  else if (input.requestId && input.studentId) query = query.eq('request_id', input.requestId).eq('user_id', input.studentId)
  else throw new ApiError(400, 'invalid_request', 'Provide a task id, or a request id and student id.')
  const { data, error } = await query.maybeSingle()
  if (error) throw new ApiError(503, 'tasks_unavailable', 'That AI task could not be loaded. Try again shortly.')
  if (!data) throw new ApiError(404, 'not_found', 'That AI task was not found.')
  return { task: safeTask(data as Record<string, unknown>) }
}

export async function cancelAiTask(admin: SupabaseClient, input: { id?: string; requestId?: string; studentId?: string }) {
  let query = admin.from('ai_tasks').select('id,user_id,request_id,status')
  if (input.id) query = query.eq('id', input.id)
  else if (input.requestId && input.studentId) query = query.eq('request_id', input.requestId).eq('user_id', input.studentId)
  else throw new ApiError(400, 'invalid_request', 'Provide a task id, or a request id and student id.')
  const { data, error } = await query.maybeSingle()
  if (error) throw new ApiError(503, 'stop_failed', 'Stracker could not cancel that AI task. Try again.')
  if (!data) throw new ApiError(404, 'not_found', 'That AI task was not found.')
  const status = String((data as { status?: string }).status ?? '')
  if (!ACTIVE_TASK_STATUSES.includes(status)) {
    throw new ApiError(409, 'already_finished', 'That AI task is already finished, so it cannot be cancelled.')
  }
  const now = new Date().toISOString()
  const { data: updated, error: updateError } = await admin.from('ai_tasks').update({
    status: 'cancelled',
    progress: 'Cancelled by Master MCP.',
    completed_at: now,
    updated_at: now
  }).eq('id', (data as { id: string }).id).in('status', ACTIVE_TASK_STATUSES).select(TASK_COLUMNS).maybeSingle()
  if (updateError || !updated) throw new ApiError(503, 'stop_failed', 'Stracker could not cancel that AI task. Try again.')
  return stripCredentialMaterial({
    cancelled: true,
    task: safeTask(updated as Record<string, unknown>),
    observation: 'Cancellation is recorded now. The agent observes it at the next checkpoint; this does not claim the model has already halted.'
  })
}

export { loadSiteProvider }
