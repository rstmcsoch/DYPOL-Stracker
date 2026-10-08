import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { ApiError, readJson, sendJson } from '../_lib/http.js'
import { withAuthenticatedRequest } from '../_lib/handler.js'
import { encryptCredential, maskedCredential } from '../_lib/secrets.js'
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
  capabilities: z.record(z.string(), z.unknown()).optional()
}).strict()
const patchSchema = z.object({ id: z.uuid(), action: z.enum(['enable','disable','default']) }).strict()
const deleteSchema = z.object({ id: z.uuid() }).strict()

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await withAuthenticatedRequest(req, res, ['GET','POST','PATCH','DELETE'], async ({ userId, adminClient }) => {
    if (req.method === 'GET') {
      const { data, error } = await adminClient.from('ai_provider_configs').select('*').eq('user_id', userId).order('created_at', { ascending: true })
      if (error) throw new ApiError(503, 'provider_config_unavailable', 'AI provider settings could not be loaded. Try again.')
      sendJson(res, 200, { providers: (data ?? []).map(row => safeProviderConfig(row as ProviderConfigRow)) })
      return
    }

    const body = await readJson(req)
    if (req.method === 'POST') {
      const parsed = providerWriteSchema.safeParse(body)
      if (!parsed.success) throw new ApiError(400, 'invalid_provider_configuration', 'Check the provider, model, and connection details, then try again.')
      const input = parsed.data
      const setup = await normalizeProviderSetup(input as unknown as Record<string, unknown>)
      const { data: existingData, error: existingError } = input.id
        ? await adminClient.from('ai_provider_configs').select('*').eq('user_id', userId).eq('id', input.id).maybeSingle()
        : { data: null, error: null }
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
      const now = new Date().toISOString()
      const firstKey = apiKey ?? ''
      const row: Record<string, unknown> = {
        ...(existing ?? {}),
        user_id: userId,
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
        enabled: changed ? false : existing?.enabled ?? false,
        is_default: changed ? false : existing?.is_default ?? false,
        connection_status: changed ? 'not_tested' : existing?.connection_status ?? 'not_tested',
        last_checked_at: changed ? null : existing?.last_checked_at ?? null,
        cooldown_until: null,
        failure_count: changed ? 0 : existing?.failure_count ?? 0,
        updated_at: now
      }
      if (!row.id) row.id = crypto.randomUUID()
      if (!existing) row.created_at = now
      // `capabilities` must always be JSON, including for built-in providers.
      if (row.capabilities === undefined) row.capabilities = setup.capabilities ?? {}
      const { data: saved, error } = await adminClient.from('ai_provider_configs').upsert(row).select('*').single()
      if (error || !saved) throw new ApiError(503, 'provider_save_failed', 'The provider configuration could not be saved. No AI request was sent.')
      const safe = safeProviderConfig(saved as ProviderConfigRow)
      sendJson(res, 200, { provider: safe, saved: true, changed, keyMask: apiKey ? maskedCredential(firstKey) : safe.masked_key })
      return
    }

    if (req.method === 'PATCH') {
      const parsed = patchSchema.safeParse(body)
      if (!parsed.success) throw new ApiError(400, 'invalid_provider_action', 'That provider setting could not be changed.')
      const { data, error } = await adminClient.from('ai_provider_configs').select('*').eq('user_id', userId).eq('id', parsed.data.id).maybeSingle()
      if (error) throw new ApiError(503, 'provider_config_unavailable', 'AI provider settings could not be changed. Try again.')
      const existing = data as ProviderConfigRow | null
      if (!existing) throw new ApiError(404, 'provider_not_found', 'That provider configuration is no longer available.')
      if (parsed.data.action === 'enable' && existing.connection_status !== 'connected') {
        throw new ApiError(409, 'provider_not_tested', 'Test this provider connection successfully before enabling it.')
      }
      if (parsed.data.action === 'default' && (!existing.enabled || existing.connection_status !== 'connected')) {
        throw new ApiError(409, 'provider_not_ready', 'Test and enable this provider before making it your preferred AI.')
      }
      if (parsed.data.action === 'default') {
        const { error: clearError } = await adminClient.from('ai_provider_configs').update({ is_default: false }).eq('user_id', userId).eq('is_default', true)
        if (clearError) throw new ApiError(503, 'provider_save_failed', 'The preferred AI could not be updated. Try again.')
      }
      const patch = parsed.data.action === 'enable'
        ? { enabled: true }
        : parsed.data.action === 'disable'
          ? { enabled: false, is_default: false }
          : { enabled: true, is_default: true }
      const { data: updated, error: updateError } = await adminClient.from('ai_provider_configs').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('id', parsed.data.id).select('*').single()
      if (updateError || !updated) throw new ApiError(503, 'provider_save_failed', 'The provider setting could not be changed. Try again.')
      sendJson(res, 200, { provider: safeProviderConfig(updated as ProviderConfigRow) })
      return
    }

    const parsed = deleteSchema.safeParse(body)
    if (!parsed.success) throw new ApiError(400, 'invalid_provider', 'That provider configuration could not be removed.')
    const { error } = await adminClient.from('ai_provider_configs').delete().eq('user_id', userId).eq('id', parsed.data.id)
    if (error) throw new ApiError(503, 'provider_remove_failed', 'The provider key could not be removed. Try again.')
    sendJson(res, 200, { removed: true })
  })
}
