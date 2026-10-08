import { describe, expect, it } from 'vitest'
import { AIError, connectionStatusFor, normalizeHttpProviderError, normalizeUnknownError, safeProviderText } from './ai-errors'

const body = (value: unknown) => JSON.stringify(value)

describe('provider error normalization', () => {
  it('maps Gemini invalid-key responses (HTTP 400 INVALID_ARGUMENT) to an authentication failure, not unsupported', () => {
    const error = normalizeHttpProviderError('gemini', 'gemini-3.7-flash', 400, body({
      error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }] }
    }))
    expect(error.aiCode).toBe('INVALID_CREDENTIAL')
    expect(connectionStatusFor(error.aiCode)).toBe('authentication_failed')
    expect(error.fallbackEligible).toBe(true)
    expect(error.retryable).toBe(false)
  })

  it('maps OpenAI invalid_api_key (401) and insufficient_quota (429) distinctly', () => {
    expect(normalizeHttpProviderError('openai', 'gpt-6-luna', 401, body({ error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } })).aiCode).toBe('INVALID_CREDENTIAL')
    const quota = normalizeHttpProviderError('openai', 'gpt-6-luna', 429, body({ error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } }))
    expect(quota.aiCode).toBe('INSUFFICIENT_BALANCE')
    expect(quota.retryable).toBe(false)
  })

  it('treats Gemini RESOURCE_EXHAUSTED as a retryable rate limit', () => {
    const error = normalizeHttpProviderError('gemini', 'gemini-3.7-flash', 429, body({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for requests per minute' } }))
    expect(error.aiCode).toBe('RATE_LIMITED')
    expect(error.retryable).toBe(true)
  })

  it('maps Anthropic not_found_error for a model to MODEL_NOT_FOUND and overloaded_error to provider unavailable', () => {
    expect(normalizeHttpProviderError('anthropic', 'claude-old', 404, body({ type: 'error', error: { type: 'not_found_error', message: 'model: claude-old' } })).aiCode).toBe('MODEL_NOT_FOUND')
    expect(normalizeHttpProviderError('anthropic', 'claude-haiku-5-5', 529, body({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })).aiCode).toBe('PROVIDER_UNAVAILABLE')
  })

  it('reports a tool-calling rejection as an unsupported capability and a generic bad request as request-invalid', () => {
    expect(normalizeHttpProviderError('deepseek', 'deepseek-flash', 400, body({ error: { message: 'The reasoning_content in the thinking mode must be passed back to the API.' } })).aiCode).toBe('UNSUPPORTED_CAPABILITY')
    expect(normalizeHttpProviderError('openai', 'gpt-6-luna', 400, body({ error: { message: 'Unrecognized field' } })).aiCode).toBe('REQUEST_INVALID')
  })

  it('maps 402, 404 and 5xx consistently', () => {
    expect(normalizeHttpProviderError('deepseek', 'deepseek-flash', 402, '').aiCode).toBe('INSUFFICIENT_BALANCE')
    expect(normalizeHttpProviderError('qwen', 'qwen3.8-max', 404, '').aiCode).toBe('MODEL_NOT_FOUND')
    expect(normalizeHttpProviderError('qwen', 'qwen3.8-max', 503, '').aiCode).toBe('PROVIDER_UNAVAILABLE')
    expect(normalizeHttpProviderError('qwen', 'qwen3.8-max', 504, '').aiCode).toBe('TIMEOUT')
  })

  it('never carries credential-shaped text from provider messages into the stored message', () => {
    const error = normalizeHttpProviderError('openai', 'gpt-6-luna', 400, body({ error: { message: 'Bad key sk-proj-ABCDEFGH12345678 for Bearer abc.def' } }))
    expect(error.providerMessage).not.toContain('sk-proj-ABCDEFGH12345678')
    expect(error.providerMessage).toContain('[redacted]')
    expect(JSON.stringify(error.diagnostics())).not.toContain('abc.def')
  })

  it('keeps the normalized fields that the HTTP layer and fallback logic depend on', () => {
    const error = new AIError('RATE_LIMITED', { provider: 'openai', model: 'gpt-6-luna', providerStatus: 429 })
    expect(error.status).toBe(429)
    expect(error.code).toBe('rate_limited')
    expect(error.message).toContain('OpenAI rate limit')
    expect(error.diagnostics()).toMatchObject({ code: 'RATE_LIMITED', provider: 'openai', model: 'gpt-6-luna', retryable: true, fallbackEligible: true })
  })

  it('classifies aborts as timeouts and everything else as network errors, never as generic failures', () => {
    expect(normalizeUnknownError(Object.assign(new Error('x'), { name: 'TimeoutError' }), { provider: 'gemini' }).aiCode).toBe('TIMEOUT')
    expect(normalizeUnknownError(new TypeError('fetch failed'), { provider: 'gemini' }).aiCode).toBe('NETWORK_ERROR')
  })

  it('redacts API-key-shaped text', () => {
    expect(safeProviderText('AIzaSyD-1234567890abcdef')).toBe('[redacted]')
  })
})
