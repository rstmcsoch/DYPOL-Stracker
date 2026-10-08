import { describe, expect, it } from 'vitest'
import { MODEL_CATALOG, RETIRED_MODEL_IDS, catalogModel, defaultModelFor } from './model-catalog'

describe('AI model catalog', () => {
  it('uses a listed, non-retired default for every provider', () => {
    for (const [provider, entry] of Object.entries(MODEL_CATALOG)) {
      expect(entry.models.map(model => model.id)).toContain(entry.defaultModelId)
      expect(RETIRED_MODEL_IDS.has(entry.defaultModelId), provider).toBe(false)
      expect(defaultModelFor(provider)).toBe(entry.defaultModelId)
    }
  })

  it('contains no retired model IDs', () => {
    const ids = Object.values(MODEL_CATALOG).flatMap(entry => entry.models.map(model => model.id))
    expect(ids.filter(id => RETIRED_MODEL_IDS.has(id))).toEqual([])
  })

  it('marks GPT-6 reasoning models as using max_completion_tokens', () => {
    expect(catalogModel('openai', 'gpt-6-luna')?.usesMaxCompletionTokens).toBe(true)
  })

  it('returns no default for custom providers', () => {
    expect(defaultModelFor('custom')).toBe('')
  })
})
