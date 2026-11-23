import { describe, expect, it } from 'vitest'
import { visibleFallbackSwitch } from './fallback-notice'
import { CONTINUE_ANSWER_PROMPT, isOutputTruncated } from './output-truncate'
import { outputTokenLimit, providerOutputCap } from '../../../api/_lib/agent.js'

describe('isOutputTruncated', () => {
  it('detects OpenAI, Anthropic and Gemini token-cap finish reasons', () => {
    expect(isOutputTruncated('length')).toBe(true)
    expect(isOutputTruncated('max_tokens')).toBe(true)
    expect(isOutputTruncated('MAX_TOKENS')).toBe(true)
    expect(isOutputTruncated('max_output_tokens')).toBe(true)
    expect(isOutputTruncated('stop')).toBe(false)
    expect(isOutputTruncated('end_turn')).toBe(false)
    expect(isOutputTruncated(null)).toBe(false)
  })
})

describe('visibleFallbackSwitch', () => {
  it('hides a notice when both labels are Stracker AI (Default) with the same model', () => {
    expect(visibleFallbackSwitch(
      { providerId: 'stracker', providerName: 'Stracker AI (Default)', modelId: 'Google Gemini' },
      { providerId: 'stracker', providerName: 'Stracker AI (Default)', modelId: 'Google Gemini' }
    )).toBe(false)
  })

  it('shows a notice only when the provider or model the student sees actually changes', () => {
    expect(visibleFallbackSwitch(
      { providerId: 'stracker', providerName: 'Stracker AI (Default)', modelId: 'Google Gemini' },
      { providerId: 'openai', providerName: 'My OpenAI', modelId: 'OpenAI GPT' }
    )).toBe(true)
    expect(visibleFallbackSwitch(
      { providerId: 'stracker', providerName: 'Stracker AI (Default)', modelId: 'Google Gemini' },
      { providerId: 'stracker', providerName: 'Stracker AI (Default)', modelId: 'NVIDIA Nemotron' }
    )).toBe(true)
    expect(visibleFallbackSwitch(null, { providerName: 'Stracker AI (Default)', modelId: 'Google Gemini' })).toBe(false)
  })
})

describe('output token limits', () => {
  it('raises the cap per provider and model tier, enough for a long table', () => {
    expect(providerOutputCap('google', 'gemini-2.5-flash')).toBe(8192)
    expect(providerOutputCap('openai', 'gpt-4o-mini')).toBe(4096)
    expect(outputTokenLimit('google', 'gemini-2.5-flash', 'general')).toBeGreaterThanOrEqual(4096)
    expect(outputTokenLimit('openai', 'gpt-4o', 'analytics')).toBeGreaterThanOrEqual(5120)
    expect(outputTokenLimit('google', 'gemini-2.5-pro', 'general')).toBeGreaterThanOrEqual(6144)
    expect(CONTINUE_ANSWER_PROMPT).toMatch(/continue the previous answer/i)
  })
})
