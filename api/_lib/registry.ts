import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { AI_PROVIDER_IDS, type AIProviderId, type AIProtocol, type AICapabilities, type AIModelOption } from '../../src/lib/ai/catalog.js'
import { ApiError } from './http.js'

export type { AIProviderId, AIProtocol, AICapabilities, AIModelOption }
export interface ProviderSetup {
  providerId: AIProviderId
  displayName: string
  modelId: string
  apiKey?: string
  baseUrl?: string | null
  protocol?: AIProtocol
  organizationId?: string | null
  region?: 'international' | 'china'
  capabilities?: Partial<AICapabilities>
}

export interface ProviderConfigRow {
  id: string
  user_id: string
  provider_id: AIProviderId
  display_name: string
  encrypted_api_key: string
  key_hint: string
  model_id: string
  base_url: string | null
  protocol: AIProtocol
  organization_id: string | null
  provider_config: { region?: string }
  capabilities: AICapabilities
  enabled: boolean
  is_default: boolean
  connection_status: string
  last_checked_at: string | null
  cooldown_until: string | null
  failure_count: number
  created_at: string
  updated_at: string
}

export const PROVIDER_DEFAULTS: Record<Exclude<AIProviderId, 'custom'>, { label: string; protocol: AIProtocol; baseUrl: string | null }> = {
  gemini: { label: 'Gemini', protocol: 'google', baseUrl: null },
  openai: { label: 'OpenAI', protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { label: 'Claude', protocol: 'anthropic-compatible', baseUrl: 'https://api.anthropic.com/v1' },
  deepseek: { label: 'DeepSeek', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com' },
  qwen: { label: 'Qwen', protocol: 'openai-compatible', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' }
}

const QWEN_BASES = {
  international: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  china: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
} as const

export function providerId(value: unknown): AIProviderId {
  if (typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value)) return value as AIProviderId
  throw new ApiError(400, 'invalid_provider', 'Choose a supported AI provider.')
}

export function inferCapabilities(provider: AIProviderId, modelId: string, protocol: AIProtocol, declared?: Partial<AICapabilities>, discoveryMethods?: string[]): AICapabilities {
  const name = modelId.toLowerCase()
  const generative = !/(embedding|embed|audio|transcri|moderation|image-generation|imagen|tts|whisper|realtime)/i.test(name)
  const discoverySaysGenerate = !discoveryMethods || discoveryMethods.includes('generateContent')
  const protocolMatches = provider === 'gemini' ? protocol === 'google' : provider === 'anthropic' ? protocol === 'anthropic-compatible' : protocol === 'openai-compatible'
  const recognizedTools = protocolMatches && (provider === 'gemini'
    ? generative && discoverySaysGenerate
    : provider === 'anthropic'
      ? generative
      : provider === 'openai'
        ? generative && /^(gpt-|chatgpt-|o[1-9]|o[1-9]-)/.test(name)
        : provider === 'deepseek'
          ? generative && /^deepseek-(chat|reasoner|v\d)/.test(name)
          : provider === 'qwen'
            ? generative && /^qwen(?:-|\d)/.test(name)
            : Boolean(declared?.supportsTools))
  const builtInReasoning = /reason|reasoner|thinking|opus|o[1-9]|gpt-5/.test(name)
  if (provider === 'custom') {
    return {
      supportsStreaming: declared?.supportsStreaming ?? true,
      supportsTools: Boolean(declared?.supportsTools),
      supportsVision: Boolean(declared?.supportsVision),
      supportsStructuredOutput: Boolean(declared?.supportsStructuredOutput),
      supportsReasoning: Boolean(declared?.supportsReasoning),
      supportsCancellation: declared?.supportsCancellation ?? true
    }
  }
  return {
    supportsStreaming: generative,
    supportsTools: recognizedTools && generative,
    // The current Stracker chat accepts text only. Keep vision disabled until a secure,
    // validated image-input path exists, rather than claiming unimplemented support.
    supportsVision: false,
    supportsStructuredOutput: recognizedTools && (provider === 'openai' || provider === 'gemini'),
    supportsReasoning: builtInReasoning,
    supportsCancellation: true
  }
}

function ipv6Groups(address:string):number[]|null {
  let value = address.toLowerCase().split('%')[0] ?? address.toLowerCase()
  const dotted = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(value)
  if (dotted) {
    const octets = dotted[1]!.split('.').map(Number)
    if (octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null
    const words = [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!]
    value = `${value.slice(0,-dotted[1]!.length)}${words.map(word => word.toString(16)).join(':')}`
  }
  if (value.includes('::')) {
    const [leftRaw,rightRaw] = value.split('::')
    if (rightRaw === undefined) return null
    const left = leftRaw ? leftRaw.split(':') : []
    const right = rightRaw ? rightRaw.split(':') : []
    const zeroCount = 8 - left.length - right.length
    if (zeroCount < 1) return null
    value = [...left,...Array.from({length:zeroCount},()=>'0'),...right].join(':')
  }
  const groups = value.split(':')
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null
  return groups.map(group => Number.parseInt(group,16))
}

function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase().split('%')[0] ?? address.toLowerCase()
  if (value.startsWith('::ffff:')) return isPrivateAddress(value.slice(7))
  if (value.includes(':')) {
    const groups = ipv6Groups(value)
    if (!groups) return true
    const [first,second] = groups as [number,number,...number[]]
    // Only globally-routable unicast space is accepted. This also excludes
    // loopback, link-local, ULA, multicast, IPv4-compatible and NAT64 ranges.
    if (first < 0x2000 || first > 0x3fff) return true
    if (first === 0x2001 && second <= 0x01ff) return true // protocol assignments, Teredo, ORCHID, benchmarking
    if (first === 0x2001 && second === 0x0db8) return true // documentation
    if (first === 0x2002) return true // 6to4 may tunnel to an embedded private IPv4 address
    if (first === 0x3fff && second <= 0x0fff) return true // documentation
    return false
  }
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a,b,c] = parts as [number,number,number,number]
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && (b === 0 || b === 2)) || (a === 192 && b === 88 && c === 99) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113)
}

export async function resolveCustomBaseUrl(value: string): Promise<{ url:string; address:LookupAddress }> {
  let url: URL
  try { url = new URL(value) } catch { throw new ApiError(400, 'invalid_endpoint', 'Enter a valid HTTPS base URL for this provider.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443')) {
    throw new ApiError(400, 'invalid_endpoint', 'Custom provider URLs must use HTTPS on the standard port and cannot include credentials, query strings, or fragments.')
  }
  const host = url.hostname.toLowerCase().replace(/\.$/,'')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === 'metadata.google.internal') {
    throw new ApiError(400, 'invalid_endpoint', 'That endpoint is not a public provider URL.')
  }
  if (/^\d+(?:\.\d+){3}$/.test(host) && isPrivateAddress(host)) throw new ApiError(400, 'invalid_endpoint', 'Private network addresses cannot be used as AI provider endpoints.')
  try {
    const addresses = await lookup(host, { all:true,verbatim:true })
    if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
      throw new ApiError(400, 'invalid_endpoint', 'That endpoint resolves to a private or non-public network address and cannot be used.')
    }
    url.hostname = host
    url.pathname = url.pathname.replace(/\/+$/,'')
    return { url:url.toString().replace(/\/$/,''),address:addresses[0]! }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, 'invalid_endpoint', 'The custom provider host could not be verified as a public address.')
  }
}

export async function validateCustomBaseUrl(value: string): Promise<string> {
  return (await resolveCustomBaseUrl(value)).url
}

export async function normalizeProviderSetup(input: Record<string, unknown>): Promise<ProviderSetup> {
  const id = providerId(input.providerId)
  const modelId = typeof input.modelId === 'string' ? input.modelId.trim() : ''
  if (!modelId || modelId.length > 200 || /[\r\n]/.test(modelId)) throw new ApiError(400, 'invalid_model', 'Choose a valid model ID from the provider model list.')
  const displayNameInput = typeof input.displayName === 'string' ? input.displayName.trim() : ''
  const region = input.region === 'china' ? 'china' : 'international'
  let protocol: AIProtocol
  let baseUrl: string | null
  let displayName: string
  let capabilities: Partial<AICapabilities> = {}
  if (id === 'custom') {
    protocol = input.protocol === 'anthropic-compatible' ? 'anthropic-compatible' : 'openai-compatible'
    if (typeof input.baseUrl !== 'string') throw new ApiError(400, 'configuration_incomplete', 'A custom provider needs a base URL.')
    baseUrl = await validateCustomBaseUrl(input.baseUrl.trim())
    displayName = displayNameInput || 'Custom provider'
    if (displayName.length > 80) throw new ApiError(400, 'invalid_provider_name', 'Provider names can be at most 80 characters.')
    const supplied = input.capabilities && typeof input.capabilities === 'object' ? input.capabilities as Record<string, unknown> : {}
    capabilities = {
      supportsStreaming: supplied.supportsStreaming === true,
      supportsTools: supplied.supportsTools === true,
      supportsVision: supplied.supportsVision === true,
      supportsStructuredOutput: supplied.supportsStructuredOutput === true,
      supportsReasoning: supplied.supportsReasoning === true,
      supportsCancellation: supplied.supportsCancellation === true
    }
  } else {
    const defaults = PROVIDER_DEFAULTS[id]
    protocol = defaults.protocol
    baseUrl = id === 'qwen' ? QWEN_BASES[region] : defaults.baseUrl
    displayName = defaults.label
    if (id === 'qwen') capabilities = { supportsTools: true, supportsStreaming: true, supportsCancellation: true }
  }
  const apiKey = typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : undefined
  if (apiKey && (apiKey.length > 2048 || /[\r\n]/.test(apiKey))) throw new ApiError(400, 'invalid_api_key', 'The API key format is not valid.')
  const organizationId = typeof input.organizationId === 'string' && input.organizationId.trim()
    ? input.organizationId.trim().slice(0, 160) : null
  return { providerId: id, displayName, modelId, apiKey, baseUrl, protocol, organizationId, region, capabilities }
}

export function endpointFor(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  return `${base}/${path.replace(/^\/+/, '')}`
}

export function providerBaseUrl(config: Pick<ProviderSetup, 'providerId' | 'baseUrl' | 'region'>): string {
  if (config.providerId === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta'
  if (config.providerId === 'anthropic') return config.baseUrl || 'https://api.anthropic.com/v1'
  if (!config.baseUrl) throw new ApiError(400, 'configuration_incomplete', 'The provider endpoint is missing.')
  return config.baseUrl
}

interface ProviderSetupWithRegion extends ProviderSetup { region?: 'international' | 'china' }
export function modelOptionsFromApi(provider: AIProviderId, values: unknown[]): AIModelOption[] {
  const unique = new Map<string, AIModelOption>()
  for (const value of values) {
    const item = value as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id.replace(/^models\//, '') : ''
    if (!id || id.length > 200 || unique.has(id)) continue
    if (provider === 'openai' && !/^(gpt-|chatgpt-|o[1-9])/.test(id.toLowerCase())) continue
    if (provider === 'deepseek' && !/^deepseek-/i.test(id)) continue
    if (provider === 'qwen' && !/^qwen(?:-|\d)/i.test(id)) continue
    if (provider === 'gemini' && !/^(gemini-|gemma-)/i.test(id)) continue
    if (provider === 'custom' && /(embedding|embed|audio|transcri|moderation|whisper|tts)/i.test(id)) continue
    const methods = Array.isArray(item.supportedGenerationMethods) ? item.supportedGenerationMethods.filter((entry): entry is string => typeof entry === 'string') : undefined
    const caps = inferCapabilities(provider, id, provider === 'custom' ? 'openai-compatible' : PROVIDER_DEFAULTS[provider as Exclude<AIProviderId, 'custom'>].protocol, undefined, methods)
    const display = typeof item.name === 'string' ? item.name : typeof item.display_name === 'string' ? item.display_name : id
    unique.set(id, { id, name: display, capabilities: caps, contextWindow: typeof item.contextWindow === 'number' ? item.contextWindow : undefined })
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 80)
}

export type SafeProviderConfig = Omit<ProviderConfigRow, 'encrypted_api_key' | 'key_hint' | 'provider_config' | 'failure_count'> & {
  masked_key: string
  region?: string
}

export function safeProviderConfig(row: ProviderConfigRow): SafeProviderConfig {
  const safe: Record<string,unknown> = { ...row }
  delete safe.encrypted_api_key
  delete safe.key_hint
  delete safe.provider_config
  delete safe.failure_count
  return { ...safe, masked_key: `••••••••••••${row.key_hint}`, region: row.provider_config?.region } as SafeProviderConfig
}

export function runtimeHealth(row: ProviderConfigRow): 'ready' | 'cooldown' | 'disabled' {
  if (!row.enabled) return 'disabled'
  if (row.connection_status === 'authentication_failed' || row.connection_status === 'model_unavailable' || row.connection_status === 'configuration_incomplete' || row.connection_status === 'unsupported' || row.connection_status === 'not_tested') return 'disabled'
  if (row.cooldown_until && new Date(row.cooldown_until).getTime() > Date.now()) return 'cooldown'
  return row.connection_status === 'connected' || row.connection_status === 'rate_limited' || row.connection_status === 'provider_unavailable' ? 'ready' : 'disabled'
}

export type { ProviderSetupWithRegion }
