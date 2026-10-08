export const AI_PROVIDER_IDS = ['gemini', 'openai', 'anthropic', 'deepseek', 'qwen', 'custom'] as const
export type AIProviderId = (typeof AI_PROVIDER_IDS)[number]
export type AIProtocol = 'google' | 'openai-compatible' | 'anthropic-compatible'
export type AIConnectionStatus =
  | 'not_configured'
  | 'not_tested'
  | 'connected'
  | 'testing'
  | 'authentication_failed'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'model_unavailable'
  | 'configuration_incomplete'
  | 'unsupported'

export interface AICapabilities {
  supportsStreaming: boolean
  supportsTools: boolean
  supportsVision: boolean
  supportsStructuredOutput: boolean
  supportsReasoning: boolean
  supportsCancellation: boolean
}

export interface AIModelOption {
  id: string
  name: string
  capabilities: AICapabilities
  contextWindow?: number
}

export interface AIProviderConfig {
  id: string
  provider_id: AIProviderId
  display_name: string
  model_id: string
  base_url: string | null
  protocol: AIProtocol
  organization_id: string | null
  region?: string
  capabilities: AICapabilities
  enabled: boolean
  is_default: boolean
  connection_status: AIConnectionStatus
  masked_key: string
  last_checked_at: string | null
  cooldown_until: string | null
}

export interface AIProviderDefinition {
  id: AIProviderId
  label: string
  shortLabel: string
  protocol: AIProtocol
  defaultBaseUrl: string | null
  description: string
}

export const AI_PROVIDERS: AIProviderDefinition[] = [
  { id: 'gemini', label: 'Google Gemini', shortLabel: 'Gemini', protocol: 'google', defaultBaseUrl: null, description: 'Google AI Studio API key' },
  { id: 'openai', label: 'ChatGPT / OpenAI', shortLabel: 'OpenAI', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.openai.com/v1', description: 'OpenAI API key' },
  { id: 'anthropic', label: 'Anthropic Claude', shortLabel: 'Claude', protocol: 'anthropic-compatible', defaultBaseUrl: null, description: 'Anthropic API key' },
  { id: 'deepseek', label: 'DeepSeek', shortLabel: 'DeepSeek', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.deepseek.com', description: 'DeepSeek API key' },
  { id: 'qwen', label: 'Qwen', shortLabel: 'Qwen', protocol: 'openai-compatible', defaultBaseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', description: 'DashScope key and region' },
  { id: 'custom', label: 'Custom / Other', shortLabel: 'Custom AI', protocol: 'openai-compatible', defaultBaseUrl: null, description: 'OpenAI-compatible or Anthropic-compatible API' }
]

export const AI_STATUS_COPY: Record<AIConnectionStatus, string> = {
  not_configured: 'Not configured',
  not_tested: 'Not tested',
  connected: 'Connected',
  testing: 'Testing…',
  authentication_failed: 'Authentication failed',
  rate_limited: 'Rate limited',
  provider_unavailable: 'Provider unavailable',
  model_unavailable: 'Model unavailable',
  configuration_incomplete: 'Configuration incomplete',
  unsupported: 'Unsupported configuration'
}

export const DEFAULT_CAPABILITIES: AICapabilities = {
  supportsStreaming: true,
  supportsTools: false,
  supportsVision: false,
  supportsStructuredOutput: false,
  supportsReasoning: false,
  supportsCancellation: true
}

export function providerLabel(id: AIProviderId | string): string {
  return AI_PROVIDERS.find(provider => provider.id === id)?.shortLabel ?? 'AI Assistant'
}

export function statusTone(status: AIConnectionStatus): 'good' | 'warn' | 'bad' | 'muted' {
  if (status === 'connected') return 'good'
  if (status === 'authentication_failed' || status === 'model_unavailable' || status === 'unsupported') return 'bad'
  if (status === 'rate_limited' || status === 'provider_unavailable' || status === 'testing') return 'warn'
  return 'muted'
}
