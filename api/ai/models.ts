import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../_lib/http'
import { ApiError, readJson, sendJson } from '../_lib/http'
import { withAuthenticatedRequest } from '../_lib/handler'
import { decryptCredential } from '../_lib/secrets'
import { discoverProviderModels } from '../_lib/models'
import { normalizeProviderSetup, type ProviderConfigRow } from '../_lib/registry'

const requestSchema = z.object({
  configId: z.uuid().optional(),
  providerId: z.string().optional(),
  apiKey: z.string().optional(),
  modelId: z.string().optional(),
  displayName: z.string().optional(),
  baseUrl: z.string().nullable().optional(),
  protocol: z.enum(['google','openai-compatible','anthropic-compatible']).optional(),
  organizationId: z.string().nullable().optional(),
  region: z.enum(['international','china']).optional(),
  capabilities: z.record(z.string(), z.unknown()).optional()
}).strict()

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await withAuthenticatedRequest(req, res, ['POST'], async ({ userId, adminClient }) => {
    const parsed = requestSchema.safeParse(await readJson(req))
    if (!parsed.success) throw new ApiError(400, 'invalid_model_request', 'Choose a provider and enter its current connection details.')
    const input = parsed.data
    let setup
    let key: string
    if (input.configId) {
      const { data, error } = await adminClient.from('ai_provider_configs').select('*').eq('user_id', userId).eq('id', input.configId).maybeSingle()
      if (error) throw new ApiError(503, 'provider_config_unavailable', 'Saved provider details could not be loaded. Try again.')
      if (!data) throw new ApiError(404, 'provider_not_found', 'That provider configuration is no longer available.')
      const row = data as ProviderConfigRow
      setup = {
        providerId: row.provider_id,
        displayName: row.display_name,
        modelId: row.model_id,
        baseUrl: row.base_url,
        protocol: row.protocol,
        organizationId: row.organization_id,
        region: row.provider_config?.region === 'china' ? 'china' as const : 'international' as const,
        capabilities: row.capabilities
      }
      key = decryptCredential(row.encrypted_api_key)
    } else {
      if (!input.providerId) throw new ApiError(400, 'invalid_provider', 'Choose a supported AI provider.')
      setup = await normalizeProviderSetup({ ...input, modelId: input.modelId || 'model-discovery' })
      if (!setup.apiKey) throw new ApiError(400, 'credential_required', 'Enter the provider API key to load its available models.')
      key = setup.apiKey
    }
    const result = await discoverProviderModels(setup, key)
    sendJson(res, 200, result)
  })
}
