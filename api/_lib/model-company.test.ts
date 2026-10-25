import { describe, expect, it } from 'vitest'
import { maskStoredModel, modelCompany, publicCompanyName, publicStoredModelId } from './model-company.js'

describe('model company mapping', () => {
  it.each([
    ['custom', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'NVIDIA'],
    ['custom', 'nemotron-3-ultra-550b-a55b:free', 'NVIDIA'],
    ['openai', 'gpt-4.1-mini', 'OpenAI'],
    ['custom', 'openai/gpt-oss-20b', 'OpenAI'],
    ['custom', 'chatgpt-4o-latest', 'OpenAI'],
    ['openai', 'o3-mini', 'OpenAI'],
    ['gemini', 'models/gemini-3.6-flash', 'Google'],
    ['custom', 'google/gemma-3-27b-it', 'Google'],
    ['anthropic', 'claude-sonnet-4-5', 'Anthropic'],
    ['custom', 'meta-llama/llama-4-maverick', 'Meta'],
    ['custom', 'mistralai/mixtral-8x22b', 'Mistral AI'],
    ['deepseek', 'deepseek-chat', 'DeepSeek'],
    ['custom', 'x-ai/grok-4', 'xAI'],
    ['qwen', 'qwen-plus', 'Alibaba Qwen'],
    ['custom', 'z-ai/glm-5.3', 'Zhipu AI'],
    ['custom', 'moonshotai/kimi-k2', 'Moonshot AI'],
    ['custom', 'microsoft/phi-4', 'Microsoft']
  ])('%s %s → %s', (provider, model, company) => expect(modelCompany(provider, model)).toBe(company))

  it('uses owned_by or the provider when the ID says nothing, else "Stracker AI"', () => {
    expect(modelCompany('custom', 'house-model-1', 'mistralai')).toBe('Mistral AI')
    expect(modelCompany('gemini', 'house-model-1')).toBe('Google')
    expect(modelCompany('custom', 'house-model-1')).toBeNull()
    expect(publicCompanyName('custom', 'house-model-1')).toBe('Stracker AI')
    expect(publicCompanyName('custom', 'house-model-1', 'Acme Labs')).toBe('Acme Labs')
  })

  it('masks stored Stracker AI model IDs, including old rows, but not the student\'s own', () => {
    expect(publicStoredModelId('stracker', 'nvidia/nemotron-3-ultra-550b-a55b:free')).toBe('NVIDIA')
    expect(publicStoredModelId('stracker', 'Google')).toBe('Google')
    expect(publicStoredModelId('stracker', 'secret-house-model')).toBe('Stracker AI')
    expect(publicStoredModelId('openai', 'gpt-4.1-mini')).toBe('gpt-4.1-mini')
    expect(publicStoredModelId('stracker', null)).toBeNull()
    const masked = maskStoredModel({ provider_id: 'stracker', model_id: 'models/gemini-3.6-flash', metadata: { fallback_from: { provider_id: 'stracker', model_id: 'claude-x' } } })
    expect(JSON.stringify(masked)).not.toMatch(/gemini-3|claude-x/)
    expect(masked).toMatchObject({ model_id: 'Google', metadata: { fallback_from: { model_id: 'Anthropic' } } })
  })
})
