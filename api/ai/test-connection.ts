import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { ApiError, readJson, sendJson } from '../_lib/http.js'
import { withAuthenticatedRequest } from '../_lib/handler.js'
import { decryptCredential } from '../_lib/secrets.js'
import { testProviderConnection, providerCallFromConfig, safeProviderError } from '../_lib/provider-adapters.js'
import { updateProviderHealth } from '../_lib/agent.js'
import { type ProviderConfigRow } from '../_lib/registry.js'
import { logAIEvent, newReference } from '../_lib/diagnostics.js'

const requestSchema = z.object({ configId: z.uuid() }).strict()
const TEST_TIMEOUT_MS = 30_000

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await withAuthenticatedRequest(req, res, ['POST'], async ({ userId, adminClient }) => {
    const reference = newReference('test')
    const parsed = requestSchema.safeParse(await readJson(req))
    if (!parsed.success) throw new ApiError(400, 'invalid_provider', 'Choose a saved provider configuration to test.')
    const { data, error } = await adminClient.from('ai_provider_configs').select('*').eq('user_id', userId).eq('id', parsed.data.configId).maybeSingle()
    if (error) throw new ApiError(503, 'provider_config_unavailable', 'The saved provider connection could not be tested. Try again.')
    if (!data) throw new ApiError(404, 'provider_not_found', 'That provider configuration is no longer available.')
    const row = data as ProviderConfigRow
    const previousStatus = row.connection_status
    const previousEnabled = row.enabled
    const started = Date.now()

    // Only the provider round-trip is classified as a provider failure. Storage errors below are
    // reported as storage errors and never reach the provider-error normalizer.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('Provider connection timed out', 'TimeoutError')), TEST_TIMEOUT_MS)
    try {
      const key = decryptCredential(row.encrypted_api_key)
      await testProviderConnection(providerCallFromConfig(row, key, '', [], [], controller.signal, () => undefined, 512))
    } catch (error) {
      const failure = safeProviderError(error, { provider: row.provider_id, model: row.model_id })
      logAIEvent('warn', 'connection_test_failed', { reference, userId, provider: row.provider_id, model: row.model_id, durationMs: Date.now() - started, ...failure.diagnostics() })
      await updateProviderHealth(adminClient, userId, row, failure)
      throw failure
    } finally {
      clearTimeout(timer)
    }

    logAIEvent('info', 'connection_test_succeeded', { reference, userId, provider: row.provider_id, model: row.model_id, durationMs: Date.now() - started })
    const { count: defaults, error: defaultError } = await adminClient.from('ai_provider_configs').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_default', true)
    if (defaultError) throw new ApiError(503, 'provider_save_failed', 'The connection worked, but Stracker could not update its preferred-provider setting.')
    const isDefault = row.is_default || (previousStatus === 'not_tested' && (defaults ?? 0) === 0)
    const { error: updateError } = await adminClient.from('ai_provider_configs').update({
      connection_status: 'connected', enabled: previousStatus === 'not_tested' ? true : previousEnabled,
      is_default: isDefault, last_checked_at: new Date().toISOString(), cooldown_until: null, failure_count: 0
    }).eq('user_id', userId).eq('id', row.id)
    if (updateError) throw new ApiError(503, 'provider_save_failed', 'The connection worked, but its status could not be saved. Try again.')
    if (isDefault) {
      await adminClient.from('ai_provider_configs').update({ is_default: false }).eq('user_id', userId).neq('id', row.id).eq('is_default', true)
    }
    sendJson(res, 200, { status: 'connected', message: 'Connection successful. Stracker can now use this provider.' })
  })
}
