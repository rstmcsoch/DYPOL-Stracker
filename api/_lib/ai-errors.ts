import { ApiError } from './http.js'

/**
 * Normalized AI failure categories. Provider-specific HTTP statuses, error codes and
 * messages are mapped to exactly one of these, so the database status, fallback
 * decision, HTTP response and UI message all agree.
 */
export const AI_ERROR_CODES = [
  'INVALID_CREDENTIAL',
  'MODEL_NOT_FOUND',
  'RATE_LIMITED',
  'INSUFFICIENT_BALANCE',
  'PROVIDER_UNAVAILABLE',
  'REQUEST_INVALID',
  'UNSUPPORTED_CAPABILITY',
  'TIMEOUT',
  'NETWORK_ERROR',
  'MALFORMED_RESPONSE',
  'CONFIGURATION_ERROR',
  'INTERNAL_ERROR'
] as const
export type AIErrorCode = (typeof AI_ERROR_CODES)[number]

export type ConnectionStatus =
  | 'connected'
  | 'authentication_failed'
  | 'rate_limited'
  | 'insufficient_balance'
  | 'provider_unavailable'
  | 'model_unavailable'
  | 'configuration_incomplete'
  | 'unsupported'

const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Claude',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  custom: 'Your custom provider'
}

export function providerLabel(provider: string | null | undefined): string {
  return (provider && PROVIDER_LABELS[provider]) || 'The AI provider'
}

const RETRYABLE: ReadonlySet<AIErrorCode> = new Set(['RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'TIMEOUT', 'NETWORK_ERROR', 'MALFORMED_RESPONSE'])
// Fallback may move to another configured provider/model that the user has enabled.
// Request-format errors are excluded so that a Stracker bug is not silently masked.
const FALLBACK_ELIGIBLE: ReadonlySet<AIErrorCode> = new Set([
  'INVALID_CREDENTIAL', 'MODEL_NOT_FOUND', 'RATE_LIMITED', 'INSUFFICIENT_BALANCE', 'PROVIDER_UNAVAILABLE',
  'UNSUPPORTED_CAPABILITY', 'TIMEOUT', 'NETWORK_ERROR', 'MALFORMED_RESPONSE'
])

export function connectionStatusFor(code: AIErrorCode): ConnectionStatus {
  switch (code) {
    case 'INVALID_CREDENTIAL': return 'authentication_failed'
    case 'MODEL_NOT_FOUND': return 'model_unavailable'
    case 'RATE_LIMITED': return 'rate_limited'
    case 'INSUFFICIENT_BALANCE': return 'insufficient_balance'
    case 'REQUEST_INVALID':
    case 'UNSUPPORTED_CAPABILITY': return 'unsupported'
    case 'CONFIGURATION_ERROR': return 'configuration_incomplete'
    default: return 'provider_unavailable'
  }
}

/** Cooldown applied before the same configuration may be retried automatically. */
export function cooldownSecondsFor(code: AIErrorCode): number {
  if (code === 'RATE_LIMITED') return 90
  if (code === 'PROVIDER_UNAVAILABLE' || code === 'TIMEOUT' || code === 'NETWORK_ERROR' || code === 'MALFORMED_RESPONSE') return 30
  return 0
}

function userMessageFor(code: AIErrorCode, provider: string | null, model: string | null): string {
  const name = providerLabel(provider)
  const modelText = model ? ` “${model}”` : ''
  switch (code) {
    case 'INVALID_CREDENTIAL': return `${name} rejected the saved API key. Replace the key in Settings → AI Assistant, then test the connection again.`
    case 'MODEL_NOT_FOUND': return `${name} does not recognize the model${modelText} for this account. Choose a current model ID and test again.`
    case 'RATE_LIMITED': return `${name} rate limit reached. Wait a minute and try again, or use another configured provider.`
    case 'INSUFFICIENT_BALANCE': return `${name} reports insufficient balance or quota. Add credit in your provider account, then test again.`
    case 'PROVIDER_UNAVAILABLE': return `${name} is temporarily unavailable. Try again shortly.`
    case 'REQUEST_INVALID': return `${name} rejected the request for the model${modelText}. Check the model ID and connection settings, then test again.`
    case 'UNSUPPORTED_CAPABILITY': return `The model${modelText} on ${name} does not support what Stracker asked for. Choose a model that supports tool calling and test it.`
    case 'TIMEOUT': return `${name} took too long to respond. Try again, or use another configured provider.`
    case 'NETWORK_ERROR': return `Stracker could not reach ${name}. Check the provider endpoint and try again.`
    case 'MALFORMED_RESPONSE': return `${name} returned a response Stracker could not read. Try again or switch provider.`
    case 'CONFIGURATION_ERROR': return 'The secure AI backend is not configured for this deployment yet. The administrator must finish the server setup.'
    case 'INTERNAL_ERROR': return 'Stracker AI encountered a server error.'
  }
}

export interface AIErrorDetails {
  provider?: string | null
  model?: string | null
  providerStatus?: number | null
  providerCode?: string | null
  providerMessage?: string | null
  /** Optional safe override when the message is a deliberately specific, non-secret explanation. */
  userMessage?: string
}

/** A normalized AI failure. Extends ApiError so the existing JSON/SSE error path works unchanged. */
export class AIError extends ApiError {
  readonly aiCode: AIErrorCode
  readonly provider: string | null
  readonly model: string | null
  readonly providerStatus: number | null
  readonly providerCode: string | null
  readonly providerMessage: string | null
  readonly retryable: boolean
  readonly fallbackEligible: boolean

  constructor(code: AIErrorCode, details: AIErrorDetails = {}) {
    const provider = details.provider ?? null
    const model = details.model ?? null
    const userMessage = details.userMessage ?? userMessageFor(code, provider, model)
    const status = code === 'INVALID_CREDENTIAL' ? 401
      : code === 'MODEL_NOT_FOUND' ? 422
        : code === 'RATE_LIMITED' ? 429
          : code === 'INSUFFICIENT_BALANCE' ? 402
            : code === 'REQUEST_INVALID' || code === 'UNSUPPORTED_CAPABILITY' ? 422
              : code === 'CONFIGURATION_ERROR' ? 503
                : code === 'INTERNAL_ERROR' ? 500
                  : 503
    super(status, code.toLowerCase(), userMessage)
    this.name = 'AIError'
    this.aiCode = code
    this.provider = provider
    this.model = model
    this.providerStatus = details.providerStatus ?? null
    this.providerCode = details.providerCode ?? null
    this.providerMessage = details.providerMessage ?? null
    this.retryable = RETRYABLE.has(code)
    this.fallbackEligible = FALLBACK_ELIGIBLE.has(code)
  }

  /** Safe, serializable diagnostic summary. Contains no credentials, headers, or request bodies. */
  diagnostics(): Record<string, string | number | boolean | null> {
    return {
      code: this.aiCode,
      provider: this.provider,
      model: this.model,
      providerStatus: this.providerStatus,
      providerCode: this.providerCode,
      providerMessage: this.providerMessage,
      retryable: this.retryable,
      fallbackEligible: this.fallbackEligible
    }
  }
}

export function isAIError(error: unknown): error is AIError {
  return error instanceof AIError
}

/** Remove anything credential-shaped from provider text before it is stored or logged. */
export function safeProviderText(value: unknown, max = 240): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value
    .replace(/\b(AIza|sk-|sk_)[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned ? cleaned.slice(0, max) : null
}

interface ParsedProviderError {
  message: string | null
  code: string | null
}

/** Extract message/code from the common provider error envelopes (OpenAI, Anthropic, Gemini, DeepSeek, DashScope). */
export function parseProviderErrorBody(text: string): ParsedProviderError {
  if (!text) return { message: null, code: null }
  let value: unknown
  try { value = JSON.parse(text) } catch { return { message: safeProviderText(text, 200), code: null } }
  if (!value || typeof value !== 'object') return { message: null, code: null }
  const root = value as Record<string, unknown>
  const error = (root.error && typeof root.error === 'object' ? root.error : root) as Record<string, unknown>
  const message = safeProviderText(error.message ?? root.message ?? root.msg, 200)
  const rawCode = error.code ?? error.type ?? error.status ?? root.code ?? root.type
  const code = typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode).slice(0, 120) : null
  // Gemini also reports a machine-readable reason inside details[].reason (e.g. API_KEY_INVALID).
  const details = Array.isArray(error.details) ? error.details as Array<Record<string, unknown>> : []
  const reason = details.map(item => item.reason).find((item): item is string => typeof item === 'string')
  return { message, code: reason ?? code }
}

/**
 * Map a non-2xx provider HTTP response to a normalized error. Gemini in particular returns
 * HTTP 400 INVALID_ARGUMENT for a malformed key, so the message must be inspected rather than
 * assuming "400 means the request shape was wrong".
 */
export function normalizeHttpProviderError(provider: string, model: string, status: number, bodyText: string): AIError {
  const parsed = parseProviderErrorBody(bodyText)
  const text = `${parsed.code ?? ''} ${parsed.message ?? ''}`
  const details = { provider, model, providerStatus: status, providerCode: parsed.code, providerMessage: parsed.message }
  const isKeyProblem = /api[_ -]?key|x-api-key|incorrect api key|invalid_api_key|api_key_invalid|authentication|unauthori[sz]ed|invalid token/i.test(text)
  const isBalance = /insufficient[_ -]?(balance|quota)|insufficient_quota|arrearage|balance|billing|payment required|prepay/i.test(text)
  const isModel = /model[^a-z]*(not (exist|found|available|supported)|does not exist|unknown|unsupported|invalid)|model_not_found|not_found_error.*model|models\//i.test(text)

  if (status === 401) return new AIError('INVALID_CREDENTIAL', details)
  if (status === 402) return new AIError('INSUFFICIENT_BALANCE', details)
  if (status === 403) return new AIError(isModel ? 'MODEL_NOT_FOUND' : 'INVALID_CREDENTIAL', details)
  if (status === 404) return new AIError('MODEL_NOT_FOUND', details)
  if (status === 408 || status === 504) return new AIError('TIMEOUT', details)
  if (status === 429) return new AIError(isBalance && !/rate/i.test(text) ? 'INSUFFICIENT_BALANCE' : 'RATE_LIMITED', details)
  if (status >= 500 || status === 529) return new AIError('PROVIDER_UNAVAILABLE', details)
  if (status === 400 || status === 422) {
    if (isKeyProblem) return new AIError('INVALID_CREDENTIAL', details)
    if (isBalance) return new AIError('INSUFFICIENT_BALANCE', details)
    if (isModel) return new AIError('MODEL_NOT_FOUND', details)
    if (/tool|function|reasoning|thinking|tool_choice|response_format|structured/i.test(text)) return new AIError('UNSUPPORTED_CAPABILITY', details)
    return new AIError('REQUEST_INVALID', details)
  }
  return new AIError('PROVIDER_UNAVAILABLE', details)
}

/** Convert anything thrown during a provider call into a normalized error without losing the cause class. */
export function normalizeUnknownError(error: unknown, context: { provider?: string | null; model?: string | null } = {}): AIError {
  if (error instanceof AIError) return error
  const provider = context.provider ?? null
  const model = context.model ?? null
  if (error instanceof ApiError) {
    // Server-side configuration problems keep their safe messages.
    if (error.code === 'credential_unreadable' || error.code === 'credential_store_unavailable') return new AIError('CONFIGURATION_ERROR', { provider, model, userMessage: error.message, providerCode: error.code })
    return new AIError('REQUEST_INVALID', { provider, model, providerCode: error.code, userMessage: error.message })
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) return new AIError('TIMEOUT', { provider, model })
  if (error instanceof Error && /malformed|unreadable|empty answer|did not return/i.test(error.message)) return new AIError('MALFORMED_RESPONSE', { provider, model })
  return new AIError('NETWORK_ERROR', { provider, model })
}
