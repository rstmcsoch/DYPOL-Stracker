/**
 * Single source of truth for provider model IDs and capabilities, shared by the browser and the
 * serverless API. Only IDs listed in each provider's current official documentation belong here.
 * Retired IDs are kept in RETIRED_MODEL_IDS so they are never offered as defaults.
 *
 * Verified 2026-10-08 against: Google Gemini models page, Anthropic models overview and deprecations,
 * DeepSeek pricing and news, OpenAI models page, Alibaba Model Studio (DashScope) compatibility docs.
 * Re-verify before each release: provider model lists change frequently.
 */

export type CatalogProviderId = 'gemini' | 'openai' | 'anthropic' | 'deepseek' | 'qwen'

export interface CatalogModel {
  id: string
  name: string
  supportsTools: boolean
  supportsReasoning: boolean
  supportsStructuredOutput: boolean
  /** Reasoning-family OpenAI models require max_completion_tokens and reject non-default temperature. */
  usesMaxCompletionTokens?: boolean
}

export interface CatalogProvider {
  defaultModelId: string
  models: CatalogModel[]
}

export const MODEL_CATALOG: Record<CatalogProviderId, CatalogProvider> = {
  gemini: {
    defaultModelId: 'gemini-3.7-flash',
    models: [
      { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', supportsTools: true, supportsReasoning: true, supportsStructuredOutput: true },
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', supportsTools: true, supportsReasoning: true, supportsStructuredOutput: true },
      { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', supportsTools: true, supportsReasoning: true, supportsStructuredOutput: true },
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', supportsTools: true, supportsReasoning: true, supportsStructuredOutput: true },
      { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', supportsTools: true, supportsReasoning: false, supportsStructuredOutput: true },
      { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', supportsTools: true, supportsReasoning: false, supportsStructuredOutput: true }
    ]
  },
  openai: {
    defaultModelId: 'gpt-6-luna',
    models: [
      { id: 'gpt-6-luna', name: 'GPT-6 Luna', supportsTools: true, supportsReasoning: true, supportsStructuredOutput: true, usesMaxCompletionTokens: true },
      { id: 'gpt-6-astra', name: 'GPT-6 Astra', supportsTools: true, supportsReasoning: true, supportsStructuredOutput: true, usesMaxCompletionTokens: true },
      { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', supportsTools: true, supportsReasoning: true, supportsStructuredOutput: true, usesMaxCompletionTokens: true }
    ]
  },
  anthropic: {
    defaultModelId: 'claude-haiku-5-5',
    models: [
      { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', supportsTools: true, supportsReasoning: false, supportsStructuredOutput: false },
      { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', supportsTools: true, supportsReasoning: true, supportsStructuredOutput: false },
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', supportsTools: true, supportsReasoning: true, supportsStructuredOutput: false },
      { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', supportsTools: true, supportsReasoning: true, supportsStructuredOutput: false }
    ]
  },
  deepseek: {
    defaultModelId: 'deepseek-flash',
    models: [
      { id: 'deepseek-flash', name: 'DeepSeek Flash', supportsTools: true, supportsReasoning: true, supportsStructuredOutput: false },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', supportsTools: true, supportsReasoning: true, supportsStructuredOutput: false }
    ]
  },
  qwen: {
    // qwen3.8-max is the current example model in Alibaba Model Studio's OpenAI-compatible docs.
    defaultModelId: 'qwen3.8-max',
    models: [
      { id: 'qwen3.8-max', name: 'Qwen 3.8 Max', supportsTools: true, supportsReasoning: true, supportsStructuredOutput: false }
    ]
  }
}

/** IDs confirmed retired or scheduled for retirement. They must not be defaults or be sent to providers. */
export const RETIRED_MODEL_IDS: ReadonlySet<string> = new Set([
  'gemini-2.5-flash', 'gpt-4.1-mini', 'claude-3-5-haiku-latest', 'claude-3-5-haiku', 'claude-3-haiku', 'claude-sonnet-4-5',
  'deepseek-chat', 'deepseek-reasoner'
])

export function catalogProvider(providerId: string): CatalogProvider | null {
  return (MODEL_CATALOG as Record<string, CatalogProvider | undefined>)[providerId] ?? null
}

export function defaultModelFor(providerId: string): string {
  return catalogProvider(providerId)?.defaultModelId ?? ''
}

export function catalogModel(providerId: string, modelId: string): CatalogModel | null {
  return catalogProvider(providerId)?.models.find(model => model.id === modelId) ?? null
}
