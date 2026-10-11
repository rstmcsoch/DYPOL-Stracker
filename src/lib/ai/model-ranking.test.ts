import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL_PREFERENCES, pickDefaultModel, rankModels } from './model-ranking'

const GEMINI_LIVE = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-flash-latest', 'gemma-4-31b-it']

describe('rankModels', () => {
  it('puts the newest stable Gemini flash first and never suggests previews or pro', () => {
    const ranked = rankModels(GEMINI_LIVE, DEFAULT_MODEL_PREFERENCES.gemini)
    expect(ranked.slice(0, 5)).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'])
    expect(ranked).not.toContain('gemini-3-flash-preview')
    expect(ranked).not.toContain('gemini-2.5-pro')
    expect(ranked.indexOf('gemini-flash-latest')).toBeLessThan(ranked.indexOf('gemini-3.1-flash-lite'))
  })
  it('ranks other providers by their lists', () => {
    expect(rankModels(['gpt-4o', 'gpt-4.1-mini', 'gpt-5-mini', 'o3'], DEFAULT_MODEL_PREFERENCES.openai)[0]).toBe('gpt-5-mini')
    expect(rankModels(['claude-3-5-haiku-latest', 'claude-sonnet-4-5'], DEFAULT_MODEL_PREFERENCES.anthropic)[0]).toBe('claude-sonnet-4-5')
    expect(rankModels(['deepseek-reasoner', 'deepseek-chat'], DEFAULT_MODEL_PREFERENCES.deepseek)).toEqual(['deepseek-chat'])
    expect(rankModels(['qwen-max', 'qwen-plus'], DEFAULT_MODEL_PREFERENCES.qwen)).toEqual(['qwen-plus', 'qwen-max'])
  })
})

describe('pickDefaultModel', () => {
  it('skips failing and slow models, falling back down the list', async () => {
    const results: Record<string, { ok: boolean; latencyMs?: number }> = {
      'gemini-3.8-flash': { ok: false },
      'gemini-3.7-flash': { ok: true, latencyMs: 21_000 },
      'gemini-3.6-flash': { ok: true, latencyMs: 900 }
    }
    const pick = await pickDefaultModel(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-2.5-flash'], async id => results[id] ?? { ok: true, latencyMs: 500 })
    expect(pick.modelId).toBe('gemini-3.6-flash')
    expect(pick.tried.map(entry => entry.modelId)).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'])
  })
  it('uses a slow but working model only when nothing faster passes, and treats errors as failures', async () => {
    const pick = await pickDefaultModel(['a', 'b', 'c'], async id => { if (id === 'a') throw new Error('x'); return id === 'b' ? { ok: true, latencyMs: 9_000 } : { ok: false } })
    expect(pick.modelId).toBe('b')
  })
  it('stops after the attempt limit', async () => {
    let calls = 0
    const pick = await pickDefaultModel(['a', 'b', 'c', 'd', 'e'], async () => { calls += 1; return { ok: false } })
    expect(calls).toBe(4); expect(pick.modelId).toBeNull()
  })
})
