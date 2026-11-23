import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MasterActor } from '../types.js'
import type { ConfirmationStore } from '../confirmations.js'
import { previewOrConfirm, withoutConfirmationToken } from '../confirmation-flow.js'
import * as siteAi from '../../services/site-ai.js'

function jsonSchema(properties: Record<string, unknown>, required: string[]) {
  return { type: 'object', properties, required, additionalProperties: false } as const
}

function tool(name: string, description: string, schema: Record<string, unknown>, parse: (args: unknown) => Record<string, unknown>, execute: (actor: MasterActor, args: Record<string, unknown>) => Promise<unknown>) {
  return { name, description, inputSchema: { ...schema }, parse, execute }
}

const empty = z.object({}).strict()
const idArgs = z.object({ id: z.uuid() }).strict()
const confirmation = z.string().min(1).optional()
const providerWrite = {
  providerId: { type: 'string' },
  displayName: { type: 'string' },
  modelId: { type: 'string' },
  apiKey: { type: 'string' },
  baseUrl: { type: 'string' },
  protocol: { type: 'string', enum: ['google', 'openai-compatible', 'anthropic-compatible'] },
  organizationId: { type: 'string' },
  region: { type: 'string', enum: ['international', 'china'] },
  capabilities: { type: 'object' },
  approvalToken: { type: 'string' }
}

function withoutApiKey(args: Record<string, unknown>): Record<string, unknown> {
  const { apiKey, confirmationToken: _ignored, ...rest } = args
  void _ignored
  if (typeof apiKey === 'string' && apiKey) return { ...rest, apiKeyFingerprint: siteAi.apiKeyFingerprint(apiKey) }
  return rest
}

export function siteAiTools(admin: SupabaseClient, confirmations?: ConfirmationStore) {
  return [
    tool('get_site_ai_status', 'Show Stracker AI (Default) settings, every site provider with a masked key only, and whether credential encryption is configured. Never returns plaintext or encrypted keys. Does not read student BYOK providers.', jsonSchema({}, []), args => empty.parse(args ?? {}) as Record<string, unknown>, async () => siteAi.getSiteAiStatus(admin)),
    tool('list_site_ai_providers', 'List global Stracker AI providers, including disabled ones, with masked keys only. Student-owned BYOK providers are never queried.', jsonSchema({}, []), args => empty.parse(args ?? {}) as Record<string, unknown>, async () => siteAi.listSiteAiProviders(admin)),
    tool('add_site_ai_provider', 'Add a global Stracker AI provider. The API key is encrypted with AES-256-GCM and only a masked key is returned. Custom providers stay disabled and not default unless a valid discovery approval token is supplied.', jsonSchema({ ...providerWrite }, ['providerId', 'modelId', 'apiKey']), args => z.object({
      providerId: z.string(), displayName: z.string().optional(), modelId: z.string(), apiKey: z.string(),
      baseUrl: z.string().nullable().optional(), protocol: z.enum(['google', 'openai-compatible', 'anthropic-compatible']).optional(),
      organizationId: z.string().nullable().optional(), region: z.enum(['international', 'china']).optional(),
      capabilities: z.record(z.string(), z.unknown()).optional(), approvalToken: z.string().max(400).optional()
    }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => siteAi.saveSiteAiProvider(admin, args, 'add')),
    tool('update_site_ai_provider', 'Update a global Stracker AI provider. A new API key is encrypted at rest. Custom providers without a valid approval token stay disabled and not default. Only a masked key is returned.', jsonSchema({ id: { type: 'string', format: 'uuid' }, ...providerWrite }, ['id', 'providerId', 'modelId']), args => z.object({
      id: z.uuid(), providerId: z.string(), displayName: z.string().optional(), modelId: z.string(), apiKey: z.string().optional(),
      baseUrl: z.string().nullable().optional(), protocol: z.enum(['google', 'openai-compatible', 'anthropic-compatible']).optional(),
      organizationId: z.string().nullable().optional(), region: z.enum(['international', 'china']).optional(),
      capabilities: z.record(z.string(), z.unknown()).optional(), approvalToken: z.string().max(400).optional()
    }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => siteAi.saveSiteAiProvider(admin, args, 'update')),
    tool('replace_site_ai_api_key', 'Replace the encrypted API key for a global Stracker AI provider. Requires confirmation. The preview and result show only a masked key; the plaintext is never returned, logged or audited.', jsonSchema({ id: { type: 'string', format: 'uuid' }, apiKey: { type: 'string' }, confirmationToken: { type: 'string' } }, ['id', 'apiKey']), args => z.object({ id: z.uuid(), apiKey: z.string().min(1).max(2048), confirmationToken: confirmation }).strict().parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const existing = await siteAi.loadSiteProvider(admin, String(args.id))
      const preview = await previewOrConfirm(confirmations, actor, 'replace_site_ai_api_key', withoutApiKey(args), { type: 'site_ai_provider', id: String(args.id), version: existing.updated_at }, args.confirmationToken, async () => ({
        operation: 'replace_site_ai_api_key',
        targetType: 'site_ai_provider',
        targetId: String(args.id),
        ...siteAi.replaceKeyPreview(existing, String(args.apiKey)) as { existing: unknown; proposed: unknown },
        effects: ['The previous encrypted key is replaced.', 'The provider connection status is reset to not_tested.', 'Only a masked key is stored in the preview and audit trail.'],
        irreversible: false,
        validation: 'The plaintext API key is encrypted with AES-256-GCM and never returned in the preview, the tool result, logs or audit events.'
      }))
      if (preview) return siteAi.stripCredentialMaterial(preview)
      return siteAi.replaceSiteAiApiKey(admin, String(args.id), String(args.apiKey))
    }),
    tool('discover_site_ai_models', 'Discover models for a saved site AI provider using the existing SSRF and endpoint rules. The stored key is decrypted only in memory and is never echoed. Custom discovery may return approval tokens, which are not API keys.', jsonSchema({ id: { type: 'string', format: 'uuid' } }, ['id']), args => idArgs.parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => siteAi.discoverSiteAiModels(admin, String(args.id))),
    tool('test_site_ai_provider', 'Test the connection for a saved site AI provider. The stored key is decrypted only in memory and is never echoed. Network failures update site provider health only; student BYOK rows are not touched.', jsonSchema({ id: { type: 'string', format: 'uuid' } }, ['id']), args => idArgs.parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => siteAi.testSiteAiProvider(admin, String(args.id))),
    tool('enable_site_ai_provider', 'Enable a global Stracker AI provider. Unapproved custom providers stay disabled until they are approved or a connection test succeeds.', jsonSchema({ id: { type: 'string', format: 'uuid' } }, ['id']), args => idArgs.parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => siteAi.setSiteAiProviderEnabled(admin, String(args.id), true)),
    tool('disable_site_ai_provider', 'Disable a global Stracker AI provider and clear its default flag if it was the default.', jsonSchema({ id: { type: 'string', format: 'uuid' } }, ['id']), args => idArgs.parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => siteAi.setSiteAiProviderEnabled(admin, String(args.id), false)),
    tool('set_default_site_ai_provider', 'Make one enabled site AI provider the default. Unapproved custom providers cannot be made default.', jsonSchema({ id: { type: 'string', format: 'uuid' } }, ['id']), args => idArgs.parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => siteAi.setDefaultSiteAiProvider(admin, String(args.id))),
    tool('reorder_site_ai_providers', 'Move a site AI provider one place up or down in the fallback chain and rewrite priorities as 1..n.', jsonSchema({ id: { type: 'string', format: 'uuid' }, direction: { type: 'string', enum: ['up', 'down'] } }, ['id', 'direction']), args => z.object({ id: z.uuid(), direction: z.enum(['up', 'down']) }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => siteAi.reorderSiteAiProviders(admin, String(args.id), args.direction as 'up' | 'down')),
    tool('remove_site_ai_provider', 'Remove a global Stracker AI provider. Requires confirmation. This does not touch student BYOK providers.', jsonSchema({ id: { type: 'string', format: 'uuid' }, confirmationToken: { type: 'string' } }, ['id']), args => z.object({ id: z.uuid(), confirmationToken: confirmation }).strict().parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const existing = await siteAi.loadSiteProvider(admin, String(args.id))
      const preview = await previewOrConfirm(confirmations, actor, 'remove_site_ai_provider', withoutConfirmationToken(args), { type: 'site_ai_provider', id: String(args.id), version: existing.updated_at }, args.confirmationToken, async () => ({
        operation: 'remove_site_ai_provider',
        targetType: 'site_ai_provider',
        targetId: String(args.id),
        existing: { provider_id: existing.provider_id, display_name: existing.display_name, masked_key: `••••••••••••${existing.key_hint}` },
        proposed: { removed: true },
        effects: ['This site AI provider is removed from the global fallback chain.', 'Student-owned BYOK providers are not changed.'],
        irreversible: true,
        validation: 'Only site_ai_providers is deleted. The student table ai_provider_configs is never queried.'
      }))
      if (preview) return siteAi.stripCredentialMaterial(preview)
      return siteAi.removeSiteAiProvider(admin, String(args.id))
    }),
    tool('update_site_ai_limits', 'Update Stracker AI (Default) availability and per-student limits (1–60 requests per minute, 1–1000 per day).', jsonSchema({ enabled: { type: 'boolean' }, perUserPerMinute: { type: 'integer' }, perUserDaily: { type: 'integer' } }, []), args => z.object({
      enabled: z.boolean().optional(), perUserPerMinute: z.number().int().min(1).max(60).optional(), perUserDaily: z.number().int().min(1).max(1000).optional()
    }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => siteAi.updateSiteAiLimits(admin, args)),
    tool('get_ai_model_preferences', 'Return the effective global AI model preference lists used when ranking models.', jsonSchema({}, []), args => empty.parse(args ?? {}) as Record<string, unknown>, async () => siteAi.getAiModelPreferences(admin)),
    tool('update_ai_model_preferences', 'Update the global AI model preference lists. Providers are limited to Gemini, OpenAI, Anthropic, DeepSeek and Qwen.', jsonSchema({ preferences: { type: 'object' } }, ['preferences']), args => z.object({ preferences: z.record(z.string(), z.array(z.string()).min(1).max(12)) }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => siteAi.updateAiModelPreferences(admin, args.preferences)),
    tool('get_ai_usage', 'Aggregate Stracker AI usage since midnight Asia/Calcutta and the current count of active AI tasks. Returns available: false if the data cannot be read. It does not invent metrics.', jsonSchema({}, []), args => empty.parse(args ?? {}) as Record<string, unknown>, async () => siteAi.getAiUsage(admin)),
    tool('get_ai_provider_health', 'Return connection_status and runtime health for each site AI provider, with masked keys only.', jsonSchema({}, []), args => empty.parse(args ?? {}) as Record<string, unknown>, async () => siteAi.getAiProviderHealth(admin)),
    tool('list_ai_tasks', 'List recent AI tasks with safe status fields only. Conversation content and metadata are omitted. Model IDs are masked for display.', jsonSchema({ studentId: { type: 'string', format: 'uuid' }, status: { type: 'string' }, page: { type: 'integer' }, pageSize: { type: 'integer' } }, []), args => z.object({
      studentId: z.uuid().optional(), status: z.string().min(1).max(40).optional(), page: z.number().int().min(1).max(10_000).optional(), pageSize: z.number().int().min(1).max(100).optional()
    }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => siteAi.listAiTasks(admin, args as { studentId?: string; status?: string; page?: number; pageSize?: number })),
    tool('get_ai_task', 'Read one AI task by id, or by request id and student id. Conversation content and metadata are omitted.', jsonSchema({ id: { type: 'string', format: 'uuid' }, requestId: { type: 'string' }, studentId: { type: 'string', format: 'uuid' } }, []), args => z.object({
      id: z.uuid().optional(), requestId: z.string().min(8).max(120).optional(), studentId: z.uuid().optional()
    }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => siteAi.getAiTask(admin, args as { id?: string; requestId?: string; studentId?: string })),
    tool('cancel_ai_task', 'Record cancellation for an active AI task. The agent observes the request at its next checkpoint; this does not claim the model has already halted.', jsonSchema({ id: { type: 'string', format: 'uuid' }, requestId: { type: 'string' }, studentId: { type: 'string', format: 'uuid' } }, []), args => z.object({
      id: z.uuid().optional(), requestId: z.string().min(8).max(120).optional(), studentId: z.uuid().optional()
    }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => siteAi.cancelAiTask(admin, args as { id?: string; requestId?: string; studentId?: string }))
  ]
}
