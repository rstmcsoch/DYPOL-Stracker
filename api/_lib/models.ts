import type { ProviderSetup } from './registry.js'
import { endpointFor, modelOptionsFromApi, providerBaseUrl, validateCustomBaseUrl } from './registry.js'
import { ApiError } from './http.js'
import { AIError, normalizeHttpProviderError } from './ai-errors.js'
import { fetchCustomProvider } from './secure-fetch.js'
import { stripControlChars } from '../../src/lib/control-chars.js'
import type { AIModelOption } from './registry.js'

export interface ModelDiscoveryResult {
  models: AIModelOption[]
  discoveryAvailable: boolean
  message?: string
}

function modelHeaders(setup: ProviderSetup, apiKey: string): Record<string, string> {
  if (setup.protocol === 'google') return { 'x-goog-api-key': apiKey }
  if (setup.protocol === 'anthropic-compatible') return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` }
  if (setup.organizationId) {
    const organization = stripControlChars(setup.organizationId).trim()
    if (organization) headers['OpenAI-Organization'] = organization
  }
  return headers
}

async function getModels(providerId: string, url:string,headers:Record<string,string>,signal:AbortSignal,custom=false):Promise<Record<string,unknown>> {
  let response:Response
  try { response = custom ? await fetchCustomProvider(url,{headers,signal}) : await fetch(url,{headers,signal,redirect:'error'}) }
  catch {
    if (signal.aborted) throw new AIError('TIMEOUT', { provider: providerId })
    throw new AIError('NETWORK_ERROR', { provider: providerId })
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    if (response.status === 404 || response.status === 405) throw new ApiError(422, 'model_discovery_unavailable', 'This provider does not offer model discovery here. Enter a model ID from its current API documentation and test it.')
    throw normalizeHttpProviderError(providerId, 'model-list', response.status, body)
  }
  try {
    const body: unknown = await response.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid response')
    return body as Record<string, unknown>
  } catch {
    throw new AIError('MALFORMED_RESPONSE', { provider: providerId, providerMessage: 'unreadable model list' })
  }
}

export async function discoverProviderModels(setup: ProviderSetup, apiKey: string): Promise<ModelDiscoveryResult> {
  if (setup.providerId === 'custom' && setup.protocol === 'anthropic-compatible') {
    return { models: [], discoveryAvailable: false, message: 'This API format does not provide model discovery. Enter a model ID from your provider and test the connection.' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    let url: string
    if (setup.providerId === 'gemini') {
      url = 'https://generativelanguage.googleapis.com/v1beta/models'
    } else if (setup.providerId === 'anthropic') {
      url = 'https://api.anthropic.com/v1/models?limit=100'
    } else {
      const base = setup.providerId === 'custom'
        ? await validateCustomBaseUrl(setup.baseUrl ?? '')
        : providerBaseUrl({ providerId: setup.providerId, baseUrl: setup.baseUrl, region: setup.region })
      url = endpointFor(base, 'models')
    }
    const body = await getModels(setup.providerId,url,modelHeaders(setup,apiKey),controller.signal,setup.providerId === 'custom')
    const collection = Array.isArray(body.models) ? body.models : Array.isArray(body.data) ? body.data : []
    const models = modelOptionsFromApi(setup.providerId, collection)
    if (!models.length && setup.providerId !== 'custom') {
      return { models, discoveryAvailable: false, message: 'No compatible text models were returned. Check the provider account and enter a model ID from its current API documentation.' }
    }
    return { models, discoveryAvailable: true }
  } finally { clearTimeout(timer) }
}
