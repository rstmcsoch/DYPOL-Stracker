import type { AIProviderId } from './catalog.js'
import { DEFAULT_MODEL_PREFERENCES } from './model-ranking.js'

export type AIModelProvider = Exclude<AIProviderId, 'custom'>
export const AI_MODEL_PROVIDERS: AIModelProvider[] = ['gemini', 'openai', 'anthropic', 'deepseek', 'qwen']
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/*:-]{0,199}$/

/** Keep only valid owner overrides from a stored JSON value. */
export function normalizeModelPreferenceOverrides(value: unknown): Partial<Record<AIModelProvider, string[]>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Partial<Record<AIModelProvider, string[]>> = {}
  for (const provider of AI_MODEL_PROVIDERS) {
    const raw = (value as Record<string, unknown>)[provider]
    if (!Array.isArray(raw) || raw.length > 12) continue
    const list = [...new Set(raw.map(item => typeof item === 'string' ? item.trim() : '').filter(item => MODEL_PATTERN.test(item)))]
    if (list.length && list.length === raw.length) out[provider] = list
  }
  return out
}

/** Effective ranked list per provider: owner override where valid, otherwise the built-in list. */
export function effectiveModelPreferences(value?: unknown): Record<AIModelProvider, string[]> {
  const overrides = normalizeModelPreferenceOverrides(value)
  return Object.fromEntries(AI_MODEL_PROVIDERS.map(provider => [provider, overrides[provider] ?? DEFAULT_MODEL_PREFERENCES[provider]])) as Record<AIModelProvider, string[]>
}

/** Ranked default-model preferences for a provider (none for custom endpoints). */
export function modelPreferences(providerId: AIProviderId, overrides?: unknown): string[] {
  return providerId === 'custom' ? [] : effectiveModelPreferences(overrides)[providerId as AIModelProvider]
}
