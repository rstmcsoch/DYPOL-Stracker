import type { AIProviderId } from './catalog'
import { DEFAULT_MODEL_PREFERENCES } from './model-ranking'

/** Ranked default-model preferences for a provider (none for custom endpoints). */
export function modelPreferences(providerId: AIProviderId): string[] {
  return providerId === 'custom' ? [] : DEFAULT_MODEL_PREFERENCES[providerId]
}
