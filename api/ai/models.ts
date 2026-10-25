import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { ApiError, readJson, sendJson } from '../_lib/http.js'
import { scoped, withProviderScope } from '../_lib/provider-scope.js'
import { publicCompanyName } from '../_lib/model-company.js'
import { decryptCredential } from '../_lib/secrets.js'
import { discoverProviderModels } from '../_lib/models.js'
import { normalizeProviderSetup, type ProviderConfigRow } from '../_lib/registry.js'
import { MODEL_DISCOVERY_RATE, takeRateSlot } from '../_lib/rate-limit.js'
import { effectiveModelPreferences } from '../../src/lib/ai/model-preferences.js'
import { rankModels } from '../../src/lib/ai/model-ranking.js'
import { CUSTOM_PROBE_BATCH, CUSTOM_PROBE_MAX_TRIED, CUSTOM_PROBE_TIMEOUT_MS, CUSTOM_PROBE_WANTED, rankCustomModels } from '../../src/lib/ai/custom-model-ranking.js'
import { CONNECTION_TEST_RATE } from '../_lib/rate-limit.js'
import { providerCallFromConfig, testProviderConnection } from '../_lib/provider-adapters.js'
import { issueModelApproval } from '../_lib/model-approval.js'
import { logAIEvent } from '../_lib/diagnostics.js'
import type { ProviderSetup } from '../_lib/registry.js'

/**
 * Custom endpoints: rank the listed IDs, then send a tiny real chat completion to the best
 * candidates in parallel batches until five reply (or the capped candidate list runs out).
 */
async function probeCustomModels(setup: ProviderSetup, key: string, ranked: string[]): Promise<{ verified: { id: string; latencyMs: number }[]; tried: number }> {
  const queue = ranked.slice(0, CUSTOM_PROBE_MAX_TRIED)
  const verified: { id: string; latencyMs: number }[] = []
  let tried = 0
  while (verified.length < CUSTOM_PROBE_WANTED && tried < queue.length) {
    const batch = queue.slice(tried, tried + CUSTOM_PROBE_BATCH)
    tried += batch.length
    const results = await Promise.all(batch.map(async id => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), CUSTOM_PROBE_TIMEOUT_MS)
      const started = Date.now()
      try {
        const row = { provider_id: 'custom', model_id: id, base_url: setup.baseUrl ?? null, protocol: setup.protocol ?? 'openai-compatible', organization_id: null, provider_config: {} } as unknown as ProviderConfigRow
        await testProviderConnection(providerCallFromConfig(row, key, '', [], [], controller.signal, () => undefined, 256))
        return { id, latencyMs: Date.now() - started }
      } catch { return null }
      finally { clearTimeout(timer) }
    }))
    for (const result of results) if (result) verified.push(result)
  }
  verified.sort((a, b) => ranked.indexOf(a.id) - ranked.indexOf(b.id))
  return { verified: verified.slice(0, CUSTOM_PROBE_WANTED), tried }
}

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
  // `?scope=site`: the owner discovers models for Stracker AI (Default), gated by the Control Center.
  await withProviderScope(req, res, ['POST'], async scope => {
    const { admin: adminClient, actorId: userId, table } = scope
    const parsed = requestSchema.safeParse(await readJson(req))
    if (!parsed.success) throw new ApiError(400, 'invalid_model_request', 'Choose a provider and enter its current connection details.')
    await takeRateSlot(adminClient, userId, MODEL_DISCOVERY_RATE)
    const input = parsed.data
    let setup
    let key: string
    if (input.configId) {
      const { data, error } = await scoped(scope, adminClient.from(table).select('*')).eq('id', input.configId).maybeSingle()
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
    if (setup.providerId === 'custom' && result.candidates) {
      const { candidates, ...listed } = result
      const ranked = rankCustomModels(candidates)
      if (!ranked.length) {
        sendJson(res, 200, { ...listed, models: [], rankedModelIds: [], approvals: {}, probe: { listed: candidates.length, tried: 0, passed: 0 },
          message: candidates.length ? `The endpoint listed ${candidates.length} models, but none are chat models Stracker can use. No compatible model could be found.` : 'The endpoint returned an empty model list. No compatible model could be found.' })
        return
      }
      await takeRateSlot(adminClient, userId, CONNECTION_TEST_RATE)
      const started = Date.now()
      const { verified, tried } = await probeCustomModels(setup, key, ranked)
      logAIEvent('info', 'custom_model_probe', { userId, provider: 'custom', listed: candidates.length, tried, passed: verified.length, durationMs: Date.now() - started })
      const approvals: Record<string, string> = {}
      for (const model of verified) {
        const token = issueModelApproval({ userId, baseUrl: setup.baseUrl, protocol: setup.protocol, modelId: model.id, apiKey: key })
        if (token) approvals[model.id] = token
      }
      const byId = new Map(listed.models.map(model => [model.id, model]))
      const models = verified.map(model => byId.get(model.id) ?? { id: model.id, name: model.id, capabilities: setup.capabilities ?? {}, company: publicCompanyName('custom', model.id) })
      // Students see only the company + family label; the owner sees the exact model ID.
      const bestName = verified.length ? (scope.kind === 'site' ? verified[0]!.id : models[0]?.company ?? publicCompanyName('custom', verified[0]!.id)) : ''
      sendJson(res, 200, {
        ...listed, models, rankedModelIds: verified.map(model => model.id), approvals,
        probe: { listed: candidates.length, tried, passed: verified.length },
        message: verified.length
          ? `Found ${verified.length} working model${verified.length === 1 ? '' : 's'} (tested ${tried} of ${ranked.length} chat models). Best: ${bestName}.`
          : `No compatible model could be found: the ${tried} best-ranked chat models did not reply with this key. Check the key's model access, or enter a model ID manually.`
      })
      return
    }
    // Owner-ranked AI defaults (server-side only table; built-ins when unavailable).
    const { data: preferenceRow } = await adminClient.from('ai_model_preferences').select('preferences').eq('id', 1).maybeSingle()
    const modelPreferences = effectiveModelPreferences(preferenceRow?.preferences)
    const rankedModelIds = setup.providerId === 'custom' ? [] : rankModels(result.models.map(model => model.id), modelPreferences[setup.providerId as keyof typeof modelPreferences] ?? [])
    sendJson(res, 200, { ...result, rankedModelIds, modelPreferences })
  })
}
