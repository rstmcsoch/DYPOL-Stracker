import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { ApiError, readJson, sendJson } from '../_lib/http.js'
import { scoped, withProviderScope } from '../_lib/provider-scope.js'
import { decryptCredential } from '../_lib/secrets.js'
import { testProviderConnection, providerCallFromConfig, safeProviderError } from '../_lib/provider-adapters.js'
import { updateProviderHealth } from '../_lib/agent.js'
import { type ProviderConfigRow } from '../_lib/registry.js'
import { logAIEvent, newReference } from '../_lib/diagnostics.js'
import { CONNECTION_TEST_RATE, takeRateSlot } from '../_lib/rate-limit.js'

const requestSchema = z.object({ configId: z.uuid() }).strict()
const TEST_TIMEOUT_MS = 30_000

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  // `?scope=site`: the owner tests a Stracker AI (Default) model, gated by the Control Center.
  await withProviderScope(req, res, ['POST'], async scope => {
    const { admin: adminClient, actorId: userId, table } = scope
    const reference = newReference('test')
    const parsed = requestSchema.safeParse(await readJson(req))
    if (!parsed.success) throw new ApiError(400, 'invalid_provider', 'Choose a saved provider configuration to test.')
    const { data, error } = await scoped(scope, adminClient.from(table).select('*')).eq('id', parsed.data.configId).maybeSingle()
    if (error) throw new ApiError(503, 'provider_config_unavailable', 'The saved provider connection could not be tested. Try again.')
    if (!data) throw new ApiError(404, 'provider_not_found', 'That provider configuration is no longer available.')
    await takeRateSlot(adminClient, userId, CONNECTION_TEST_RATE)
    // Site rows are marked so health updates land in the site table.
    const row = (scope.kind === 'site' ? { ...data, site: true } : data) as ProviderConfigRow
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

    const latencyMs = Date.now() - started
    logAIEvent('info', 'connection_test_succeeded', { reference, userId, provider: row.provider_id, model: row.model_id, durationMs: Date.now() - started })
    const { count: defaults, error: defaultError } = await scoped(scope, adminClient.from(table).select('id', { count: 'exact', head: true })).eq('is_default', true)
    if (defaultError) throw new ApiError(503, 'provider_save_failed', 'The connection worked, but Stracker could not update its preferred-provider setting.')
    // A provider becomes usable whenever a test succeeds after it was not working (never tested,
    // or auto-disabled by a failed test). Only a provider that was already healthy keeps the
    // user's own enable/disable choice. Previously a failed-then-fixed provider stayed disabled.
    const recovering = previousStatus !== 'connected'
    const isDefault = row.is_default || (recovering && (defaults ?? 0) === 0)
    const { error: updateError } = await scoped(scope, adminClient.from(table).update({
      connection_status: 'connected', enabled: recovering ? true : previousEnabled,
      is_default: isDefault, last_checked_at: new Date().toISOString(), cooldown_until: null, failure_count: 0
    })).eq('id', row.id)
    if (updateError) throw new ApiError(503, 'provider_save_failed', 'The connection worked, but its status could not be saved. Try again.')
    if (isDefault) {
      await scoped(scope, adminClient.from(table).update({ is_default: false })).neq('id', row.id).eq('is_default', true)
    }
    sendJson(res, 200, { status: 'connected', latencyMs, message: 'Connection successful. Stracker can now use this provider.' })
  })
}
