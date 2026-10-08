import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../_lib/http'
import { ApiError, readJson, sendJson } from '../_lib/http'
import { withAuthenticatedRequest } from '../_lib/handler'
import { decryptCredential } from '../_lib/secrets'
import { testProviderConnection, providerCallFromConfig, safeProviderError } from '../_lib/provider-adapters'
import { type ProviderConfigRow } from '../_lib/registry'

const requestSchema = z.object({ configId: z.uuid() }).strict()

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await withAuthenticatedRequest(req, res, ['POST'], async ({ userId, adminClient }) => {
    const parsed = requestSchema.safeParse(await readJson(req))
    if (!parsed.success) throw new ApiError(400, 'invalid_provider', 'Choose a saved provider configuration to test.')
    const { data, error } = await adminClient.from('ai_provider_configs').select('*').eq('user_id', userId).eq('id', parsed.data.configId).maybeSingle()
    if (error) throw new ApiError(503, 'provider_config_unavailable', 'The saved provider connection could not be tested. Try again.')
    if (!data) throw new ApiError(404, 'provider_not_found', 'That provider configuration is no longer available.')
    const row = data as ProviderConfigRow
    const previousStatus = row.connection_status
    const previousEnabled = row.enabled
    const key = decryptCredential(row.encrypted_api_key)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('Provider connection timed out', 'TimeoutError')), 18_000)
    try {
      await testProviderConnection(providerCallFromConfig(row, key, '', [], [], controller.signal, () => undefined, 24))
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
    } catch (error) {
      const failure = safeProviderError(error)
      if (failure.health === 'timeout' || failure.health === 'provider_unavailable' || failure.health === 'rate_limited' || failure.health === 'authentication_failed' || failure.health === 'model_unavailable' || failure.health === 'unsupported') {
        const cooldownSeconds = failure.health === 'rate_limited' ? 90 : failure.health === 'provider_unavailable' || failure.health === 'timeout' ? 30 : null
        const enabled = failure.health === 'authentication_failed' || failure.health === 'model_unavailable' || failure.health === 'unsupported' ? false : previousEnabled
        await adminClient.from('ai_provider_configs').update({
          connection_status: failure.health === 'timeout' ? 'provider_unavailable' : failure.health,
          enabled, is_default: enabled ? row.is_default : false,
          last_checked_at: new Date().toISOString(),
          cooldown_until: cooldownSeconds ? new Date(Date.now() + cooldownSeconds * 1000).toISOString() : null,
          failure_count: Math.min(1000, row.failure_count + 1)
        }).eq('user_id', userId).eq('id', row.id)
      }
      if (failure.health === 'authentication_failed') throw new ApiError(401, 'authentication_failed', 'The provider rejected this API key. Check it in AI Assistant settings.')
      if (failure.health === 'model_unavailable') throw new ApiError(422, 'model_unavailable', 'That model is unavailable for this provider account. Choose a currently listed model and test again.')
      if (failure.health === 'rate_limited') throw new ApiError(429, 'rate_limited', 'Your provider rate limit was reached. Wait a moment and try again.')
      if (failure.health === 'unsupported') throw new ApiError(422, 'unsupported', 'This model or endpoint does not support the requested API configuration.')
      throw new ApiError(503, 'provider_unavailable', 'The provider did not respond. Check its status and try the connection test again.')
    } finally { clearTimeout(timer) }
  })
}
