import { describe, expect, it } from 'vitest'
import { toGeminiSchema } from './provider-adapters.js'
import { MODEL_TOOLS } from './tools.js'
import { modelOptionsFromApi } from './registry.js'
import { keepStreamedAnswer, modelTier, providerDeadlineMs, requiresTools } from './agent.js'

const FORBIDDEN = ['additionalProperties', 'default', 'const', 'pattern', 'multipleOf', 'exclusiveMinimum', 'anyOf', '$schema']
function keys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach(item => keys(item, out))
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { out.add(key); if (key !== 'properties') keys(child, out); else Object.values(child as object).forEach(item => keys(item, out)) }
  return out
}
function enums(value: unknown, out: unknown[][] = []): unknown[][] {
  if (Array.isArray(value)) value.forEach(item => enums(item, out))
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (key === 'enum') out.push(child as unknown[]); else enums(child, out) }
  return out
}

describe('Gemini tool schemas', () => {
  it('strips JSON-Schema keywords Gemini rejects from every Stracker tool', () => {
    for (const tool of MODEL_TOOLS) {
      const converted = toGeminiSchema(tool.inputSchema)
      const found = [...keys(converted)].filter(key => FORBIDDEN.includes(key))
      expect(found, tool.name).toEqual([])
      for (const values of enums(converted)) expect(values.every(value => typeof value === 'string' && value.length > 0), tool.name).toBe(true)
    }
  })
  it('turns nullable unions into nullable fields', () => {
    expect(toGeminiSchema({ anyOf: [{ type: 'string', maxLength: 60 }, { type: 'null' }], default: null })).toEqual({ type: 'string', maxLength: 60, nullable: true })
    expect(toGeminiSchema({ anyOf: [{ type: 'string', format: 'date' }, { type: 'string', const: '' }] })).toEqual({ type: 'string', nullable: true })
  })
})

describe('model discovery', () => {
  it('reads Gemini lists (name: models/<id>, displayName) and keeps chat models only', () => {
    const models = modelOptionsFromApi('gemini', [
      { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash-Lite', supportedGenerationMethods: ['generateContent'] }
    ])
    expect(models.map(model => model.id)).toEqual(['gemini-2.5-flash', 'gemini-3.1-flash-lite'])
    expect(models[0]!.name).toBe('Gemini 2.5 Flash')
  })
})

describe('model tiers and tool intent', () => {
  it('sizes work by model tier', () => {
    expect(modelTier('gemini-3.1-flash-lite')).toBe('fast')
    expect(modelTier('gpt-4o-mini')).toBe('fast')
    expect(modelTier('gemini-2.5-flash')).toBe('standard')
    expect(modelTier('gemini-3.1-pro-preview')).toBe('rich')
    expect(modelTier('o3')).toBe('rich')
  })
  it('only attaches tools when a message needs Stracker data', () => {
    expect(requiresTools('Hello')).toBe(false)
    expect(requiresTools('What is my average?')).toBe(true)
    expect(requiresTools('What you know about me, tell my analytics')).toBe(true)
    const essay = 'sometimes i think maybe change stream but they already paid fees and bought books so no. just need some real method that works for someone like me who gets low always and confidence is gone. '.repeat(12)
    expect(essay.length).toBeGreaterThan(800)
    expect(requiresTools(essay)).toBe(false)
  })
  it('lets a live stream finish and keeps a real partial answer', () => {
    expect(providerDeadlineMs(false, false, true, 50_000, 100)).toBe(20_000)
    expect(providerDeadlineMs(false, false, true, 50_000, 3_500)).toBe(28_000)
    expect(providerDeadlineMs(true, false, true, 50_000, 3_500)).toBe(45_000)
    expect(providerDeadlineMs(false, true, true, 50_000)).toBe(45_000)
    expect(keepStreamedAnswer('Sure,')).toBe(false)
    expect(keepStreamedAnswer('A real method starts with one chapter a day, reviewed the next morning, instead of restarting the whole syllabus every week.')).toBe(true)
  })
})
