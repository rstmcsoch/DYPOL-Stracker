import { describe, expect, it } from 'vitest'
import { maskStoredModel, modelCompany, publicCompanyName, publicStoredModelId } from './model-company.js'

describe('model company mapping', () => {
  it.each([
    ['custom', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'NVIDIA Nemotron'],
    ['custom', 'nemotron-3-ultra-550b-a55b:free', 'NVIDIA Nemotron'],
    ['openai', 'gpt-4.1-mini', 'OpenAI ChatGPT'],
    ['custom', 'openai/gpt-oss-20b', 'OpenAI ChatGPT'],
    ['custom', 'chatgpt-4o-latest', 'OpenAI ChatGPT'],
    ['openai', 'o3-mini', 'OpenAI ChatGPT'],
    ['gemini', 'models/gemini-3.6-flash', 'Google Gemini'],
    ['custom', 'google/gemma-3-27b-it', 'Google Gemma'],
    ['anthropic', 'claude-sonnet-4-5', 'Anthropic Claude'],
    ['custom', 'meta-llama/llama-4-maverick', 'Meta Llama'],
    ['custom', 'mistralai/mixtral-8x22b', 'Mistral AI Mixtral'],
    ['deepseek', 'deepseek-chat', 'DeepSeek'],
    ['custom', 'x-ai/grok-4', 'xAI Grok'],
    ['qwen', 'qwen-plus', 'Alibaba Qwen'],
    ['custom', 'z-ai/glm-5.3', 'Zhipu GLM'],
    ['custom', 'moonshotai/kimi-k2', 'Moonshot Kimi'],
    ['custom', 'microsoft/phi-4', 'Microsoft Phi'],
    ['custom', 'mistral-large-3.1', 'Mistral AI Mistral'],
    ['custom', 'MiniMaxAI/MiniMax-M2', 'MiniMax'],
    ['custom', 'acme-labs/foo-large-3.1', 'Acme Labs Foo']
  ])('%s %s → %s', (provider, model, company) => expect(modelCompany(provider, model)).toBe(company))

  it('uses owned_by or the provider when the ID says nothing, else "Stracker AI"', () => {
    expect(modelCompany('custom', 'house-model-1', 'mistralai')).toBe('Mistral AI House')
    expect(modelCompany('custom', 'house-model-1', 'system')).toBe('House')
    expect(modelCompany('gemini', 'house-model-1')).toBe('Google')
    expect(modelCompany('custom', 'x7-1b')).toBeNull()
    expect(publicCompanyName('custom', 'x7-1b')).toBe('Stracker AI')
    for (const label of [modelCompany('custom', 'nvidia/nemotron-3-ultra-550b-a55b:free'), modelCompany('custom', 'mistral-large-3.1')]) expect(label).not.toMatch(/\d|:|free|ultra|large/)
    expect(publicCompanyName('custom', 'house-model-1', 'Acme Labs')).toBe('Acme Labs')
  })

  it('masks every stored model ID for students, including old rows and their own models', () => {
    expect(publicStoredModelId('stracker', 'nvidia/nemotron-3-ultra-550b-a55b:free')).toBe('NVIDIA Nemotron')
    expect(publicStoredModelId('stracker', 'Google Gemini')).toBe('Google Gemini')
    expect(publicStoredModelId('stracker', 'secret-house-model')).toBe('Secret')
    expect(publicStoredModelId('stracker', 'x7-1b')).toBe('Stracker AI')
    expect(publicStoredModelId('openai', 'gpt-5.6-sol')).toBe('OpenAI ChatGPT')
    expect(publicStoredModelId('custom', 'x7-1b')).toBe('AI model')
    expect(publicStoredModelId('stracker', null)).toBeNull()
    const masked = maskStoredModel({ provider_id: 'stracker', model_id: 'models/gemini-3.6-flash', metadata: { fallback_from: { provider_id: 'stracker', model_id: 'claude-x' } } })
    expect(JSON.stringify(masked)).not.toMatch(/gemini-3|claude-x/)
    expect(masked).toMatchObject({ model_id: 'Google Gemini', metadata: { fallback_from: { model_id: 'Anthropic Claude' } } })
  })
})
