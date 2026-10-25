import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { ApiError, readJson, sendJson } from '../_lib/http.js'
import { scoped, scopeColumns, withProviderScope, type ProviderScope } from '../_lib/provider-scope.js'
import { derivePreference, publicStrackerStatus, readSiteProviders, readSiteSettings, readStoredPreference, strackerUsedToday, writePreference, normalizeSiteSettings } from '../_lib/stracker-default.js'
import { decryptCredential, encryptCredential, maskedCredential } from '../_lib/secrets.js'
import { verifyModelApproval } from '../_lib/model-approval.js'
import { normalizeProviderSetup, safeProviderConfig, type ProviderConfigRow } from '../_lib/registry.js'

const providerWriteSchema = z.object({
  id: z.uuid().optional(),
  providerId: z.string(),
  displayName: z.string().optional(),
  modelId: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().nullable().optional(),
  protocol: z.enum(['google','openai-compatible','anthropic-compatible']).optional(),
  organizationId: z.string().nullable().optional(),
  region: z.enum(['international','china']).optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  /** Custom providers: signed proof from discovery that this exact model passed a chat test. */
  approvalToken: z.string().max(400).optional()
}).strict()
const patchSchema = z.union([
  z.object({ id: z.uuid(), action: z.enum(['enable','disable','default']) }).strict(),
  /** Students only: make Stracker AI (Default) their preferred AI. */
  z.object({ action: z.literal('prefer_stracker') }).strict()
])
/** Owner only (site scope): availability and per-student limits of Stracker AI (Default). */
const settingsSchema = z.object({ settings: z.object({
  enabled: z.boolean(),
  perUserPerMinute: z.number().int().min(1).max(60),
  perUserDaily: z.number().int().min(1).max(1000)
}).strict() }).strict()
const deleteSchema = z.object({ id: z.uuid() }).strict()

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await withProviderScope(req, res, ['GET','POST','PATCH','DELETE','PUT'], scope => handleProviders(req, res, scope))
}

/**
 * One implementation for both scopes, so the owner's Stracker AI (Default) setup behaves
 * exactly like a student's own providers. Every query goes through `scoped()`.
 */
async function handleProviders(req: ApiRequest, res: ApiResponse, scope: ProviderScope): Promise<void> {
    const { admin: adminClient, actorId: userId, table } = scope
    if (req.method === 'GET') {
      const { data, error } = await scoped(scope, adminClient.from(table).select('*')).order('created_at', { ascending: true })
      if (error) throw new ApiError(503, 'provider_config_unavailable', 'AI provider settings could not be loaded. Try again.')
      const rows = (data ?? []) as ProviderConfigRow[]
      const providers = rows.map(row => safeProviderConfig(row))
      if (scope.kind === 'site') {
        sendJson(res, 200, { providers, settings: await readSiteSettings(adminClient) })
        return
      }
      const [settings, siteRows, stored, usedToday] = await Promise.all([
        readSiteSettings(adminClient), readSiteProviders(adminClient), readStoredPreference(adminClient, userId), strackerUsedToday(adminClient, userId)
      ])
      const preference = derivePreference(stored, rows)
      sendJson(res, 200, { providers, preference, stracker: publicStrackerStatus({ settings, rows: siteRows, preference, usedToday }) })
      return
    }

    if (req.method === 'PUT') {
      if (scope.kind !== 'site') throw new ApiError(405, 'method_not_allowed', 'That AI request method is not supported.')
      const parsed = settingsSchema.safeParse(await readJson(req))
      if (!parsed.success) throw new ApiError(400, 'invalid_settings', 'Use 1–60 requests per minute and 1–1000 per day.')
      const { enabled, perUserPerMinute, perUserDaily } = parsed.data.settings
      const { data, error } = await adminClient.from('site_ai_settings').upsert({ id: 1, enabled, per_user_per_minute: perUserPerMinute, per_user_daily: perUserDaily, updated_by: userId, updated_at: new Date().toISOString() }).select('enabled,per_user_per_minute,per_user_daily').single()
      await scope.audit?.('site_ai.settings', 'settings', error ? 'failed' : 'success', { enabled, per_minute: perUserPerMinute, per_day: perUserDaily })
      if (error || !data) throw new ApiError(503, 'settings_save_failed', 'Stracker AI settings were not saved. Nothing changed.')
      sendJson(res, 200, { settings: normalizeSiteSettings(data as Record<string, unknown>) })
      return
    }

    const body = await readJson(req)
    if (req.method === 'POST') {
      const parsed = providerWriteSchema.safeParse(body)
      if (!parsed.success) throw new ApiError(400, 'invalid_provider_configuration', 'Check the provider, model, and connection details, then try again.')
      const { approvalToken, ...input } = parsed.data
      // Endpoint validation (DNS checks for custom URLs) and the existing-row read are independent: run them together.
      const [setup, { data: existingData, error: existingError }] = await Promise.all([
        normalizeProviderSetup(input as unknown as Record<string, unknown>),
        input.id
          ? scoped(scope, adminClient.from(table).select('*')).eq('id', input.id).maybeSingle()
          : Promise.resolve({ data: null, error: null })
      ])
      if (existingError) throw new ApiError(503, 'provider_config_unavailable', 'AI provider settings could not be checked. Try again.')
      const existing = existingData as ProviderConfigRow | null
      if (input.id && !existing) throw new ApiError(404, 'provider_not_found', 'That provider configuration is no longer available.')
      if (existing && existing.provider_id !== setup.providerId && !setup.apiKey) {
        throw new ApiError(400, 'credential_required', 'Enter a new API key when changing the provider.')
      }
      const apiKey = setup.apiKey
      if (!apiKey && !existing) throw new ApiError(400, 'credential_required', 'Enter the provider API key before saving.')

      const capabilitiesChanged = setup.providerId === 'custom' && JSON.stringify(existing?.capabilities ?? {}) !== JSON.stringify(setup.capabilities ?? {})
      const changed = !existing || Boolean(apiKey) || existing.provider_id !== setup.providerId || existing.model_id !== setup.modelId ||
        existing.base_url !== setup.baseUrl || existing.protocol !== setup.protocol || existing.organization_id !== setup.organizationId || capabilitiesChanged
      // Custom provider whose model passed the discovery chat test with this endpoint and key:
      // detection and testing were the same step, so save it as connected (built-ins unchanged).
      let approved = false
      if (setup.providerId === 'custom' && approvalToken) {
        let storedKey = apiKey
        if (!storedKey && existing) { try { storedKey = decryptCredential(existing.encrypted_api_key) } catch { storedKey = undefined } }
        approved = Boolean(storedKey) && verifyModelApproval(approvalToken, { userId, baseUrl: setup.baseUrl, protocol: setup.protocol, modelId: setup.modelId, apiKey: storedKey! })
      }
      let makeDefault = false
      if (approved && !(existing?.is_default)) {
        const { count } = await scoped(scope, adminClient.from(table).select('id', { count: 'exact', head: true })).eq('is_default', true)
        makeDefault = (count ?? 0) === 0
      }
      const now = new Date().toISOString()
      const firstKey = apiKey ?? ''
      const row: Record<string, unknown> = {
        ...(existing ?? {}),
        ...scopeColumns(scope),
        provider_id: setup.providerId,
        display_name: setup.displayName,
        encrypted_api_key: apiKey ? encryptCredential(apiKey) : existing!.encrypted_api_key,
        key_hint: apiKey ? apiKey.slice(-4) : existing!.key_hint,
        model_id: setup.modelId,
        base_url: setup.baseUrl,
        protocol: setup.protocol,
        organization_id: setup.organizationId,
        provider_config: setup.providerId === 'qwen' ? { region: setup.region } : {},
        capabilities: setup.providerId === 'custom'
          ? setup.capabilities
          : undefined,
        enabled: approved ? true : changed ? false : existing?.enabled ?? false,
        is_default: approved ? Boolean(existing?.is_default) || makeDefault : changed ? false : existing?.is_default ?? false,
        connection_status: approved ? 'connected' : changed ? 'not_tested' : existing?.connection_status ?? 'not_tested',
        last_checked_at: approved ? now : changed ? null : existing?.last_checked_at ?? null,
        cooldown_until: null,
        failure_count: changed ? 0 : existing?.failure_count ?? 0,
        updated_at: now
      }
      if (!row.id) row.id = crypto.randomUUID()
      if (!existing) row.created_at = now
      // `capabilities` must always be JSON, including for built-in providers.
      if (row.capabilities === undefined) row.capabilities = setup.capabilities ?? {}
      const { data: saved, error } = await adminClient.from(table).upsert(row).select('*').single()
      await scope.audit?.('site_ai.provider_save', String(row.id), error || !saved ? 'failed' : 'success', { provider: setup.providerId, model: setup.modelId, key_changed: Boolean(apiKey) })
      if (error || !saved) throw new ApiError(503, 'provider_save_failed', 'The provider configuration could not be saved. No AI request was sent.')
      const safe = safeProviderConfig(saved as ProviderConfigRow)
      sendJson(res, 200, { provider: safe, saved: true, changed, approved, keyMask: apiKey ? maskedCredential(firstKey) : safe.masked_key })
      return
    }

    if (req.method === 'PATCH') {
      const parsed = patchSchema.safeParse(body)
      if (!parsed.success) throw new ApiError(400, 'invalid_provider_action', 'That provider setting could not be changed.')
      const action = parsed.data
      if (action.action === 'prefer_stracker') {
        if (scope.kind !== 'user') throw new ApiError(400, 'invalid_provider_action', 'That provider setting could not be changed.')
        if (!await writePreference(adminClient, userId, 'stracker')) throw new ApiError(503, 'provider_save_failed', 'The preferred AI could not be updated. Try again.')
        sendJson(res, 200, { preference: 'stracker' })
        return
      }
      const { data, error } = await scoped(scope, adminClient.from(table).select('*')).eq('id', action.id).maybeSingle()
      if (error) throw new ApiError(503, 'provider_config_unavailable', 'AI provider settings could not be changed. Try again.')
      const existing = data as ProviderConfigRow | null
      if (!existing) throw new ApiError(404, 'provider_not_found', 'That provider configuration is no longer available.')
      if (action.action === 'enable' && existing.connection_status !== 'connected') {
        throw new ApiError(409, 'provider_not_tested', 'Test this provider connection successfully before enabling it.')
      }
      if (action.action === 'default' && (!existing.enabled || existing.connection_status !== 'connected')) {
        throw new ApiError(409, 'provider_not_ready', 'Test and enable this provider before making it your preferred AI.')
      }
      if (action.action === 'default') {
        const { error: clearError } = await scoped(scope, adminClient.from(table).update({ is_default: false })).eq('is_default', true)
        if (clearError) throw new ApiError(503, 'provider_save_failed', 'The preferred AI could not be updated. Try again.')
      }
      const patch = action.action === 'enable'
        ? { enabled: true }
        : action.action === 'disable'
          ? { enabled: false, is_default: false }
          : { enabled: true, is_default: true }
      const { data: updated, error: updateError } = await scoped(scope, adminClient.from(table).update({ ...patch, ...(scope.kind === 'site' ? { updated_by: userId } : {}), updated_at: new Date().toISOString() })).eq('id', action.id).select('*').single()
      await scope.audit?.('site_ai.provider_update', action.id, updateError || !updated ? 'failed' : 'success', { action: action.action })
      if (updateError || !updated) throw new ApiError(503, 'provider_save_failed', 'The provider setting could not be changed. Try again.')
      // Choosing one of their own providers as preferred also means "prefer my own over Stracker AI".
      if (scope.kind === 'user' && action.action === 'default') await writePreference(adminClient, userId, 'own')
      sendJson(res, 200, { provider: safeProviderConfig(updated as ProviderConfigRow), ...(scope.kind === 'user' && action.action === 'default' ? { preference: 'own' } : {}) })
      return
    }

    const parsed = deleteSchema.safeParse(body)
    if (!parsed.success) throw new ApiError(400, 'invalid_provider', 'That provider configuration could not be removed.')
    const { data: deleted, error } = await scoped(scope, adminClient.from(table).delete()).eq('id', parsed.data.id).select('id')
    await scope.audit?.('site_ai.provider_remove', parsed.data.id, error ? 'failed' : 'success')
    if (error) throw new ApiError(503, 'provider_remove_failed', 'The provider key could not be removed. Try again.')
    // Honest result: `removed` is true only when a row owned by this user was actually deleted.
    // A foreign or unknown id returns `removed: false` (indistinguishable — no existence oracle),
    // so this stays enumeration-safe while never claiming success for a no-op (SA-2610-12).
    sendJson(res, 200, { removed: (deleted?.length ?? 0) > 0 })
}
