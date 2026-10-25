/**
 * Public label for an AI model: the company plus the model family (e.g. "Google Gemini",
 * "NVIDIA Nemotron"), never the specific model ID, version, size or suffix. Students only ever
 * see this label for the Stracker AI (Default) model, never its ID, key, endpoint or owner label.
 * Order matters: the most specific patterns come first.
 */
const FAMILY_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/nemotron/i, 'NVIDIA Nemotron'],
  [/(^|[/_-])(chatgpt|gpt)/i, 'OpenAI ChatGPT'],
  [/(^|\/)o\d+(-|$)/i, 'OpenAI ChatGPT'],
  [/gemini|learnlm/i, 'Google Gemini'],
  [/gemma/i, 'Google Gemma'],
  [/claude/i, 'Anthropic Claude'],
  [/llama/i, 'Meta Llama'],
  [/mixtral/i, 'Mistral AI Mixtral'],
  [/codestral/i, 'Mistral AI Codestral'],
  [/devstral/i, 'Mistral AI Devstral'],
  [/magistral/i, 'Mistral AI Magistral'],
  [/pixtral/i, 'Mistral AI Pixtral'],
  [/ministral|mistral/i, 'Mistral AI Mistral'],
  [/deepseek/i, 'DeepSeek'],
  [/grok/i, 'xAI Grok'],
  [/qwen|qwq/i, 'Alibaba Qwen'],
  [/minimax|abab/i, 'MiniMax'],
  [/kimi/i, 'Moonshot Kimi'],
  [/chatglm|glm/i, 'Zhipu GLM'],
  [/(^|\/)command/i, 'Cohere Command'],
  [/(^|\/)aya/i, 'Cohere Aya'],
  [/(^|\/)phi-?\d/i, 'Microsoft Phi'],
  [/(^|\/)(amazon\.)?nova/i, 'Amazon Nova'],
  [/titan/i, 'Amazon Titan'],
  [/(^|\/)yi-/i, '01.AI Yi'],
  [/sonar/i, 'Perplexity Sonar'],
  [/ernie/i, 'Baidu ERNIE'],
  [/hunyuan/i, 'Tencent Hunyuan'],
  [/doubao/i, 'ByteDance Doubao'],
  [/(^|\/)seed-/i, 'ByteDance Seed'],
  [/granite/i, 'IBM Granite'],
  [/jamba/i, 'AI21 Jamba'],
  [/hermes/i, 'Nous Hermes'],
  [/olmo/i, 'Ai2 OLMo'],
  [/(^|\/)lfm/i, 'Liquid LFM'],
  [/(^|\/)reka/i, 'Reka']
]

/** Company for a vendor/org/owner name (from an ID prefix like "nvidia/" or a list's owned_by). */
const VENDOR_COMPANY: Record<string, string> = {
  nvidia: 'NVIDIA', openai: 'OpenAI', google: 'Google', 'google-deepmind': 'Google', anthropic: 'Anthropic',
  meta: 'Meta', 'meta-llama': 'Meta', facebook: 'Meta', mistralai: 'Mistral AI', mistral: 'Mistral AI',
  deepseek: 'DeepSeek', 'deepseek-ai': 'DeepSeek', xai: 'xAI', 'x-ai': 'xAI', qwen: 'Alibaba', alibaba: 'Alibaba',
  minimax: 'MiniMax', minimaxai: 'MiniMax', moonshot: 'Moonshot', moonshotai: 'Moonshot', 'z-ai': 'Zhipu', zai: 'Zhipu',
  'zai-org': 'Zhipu', thudm: 'Zhipu', zhipu: 'Zhipu', cohere: 'Cohere', microsoft: 'Microsoft', amazon: 'Amazon',
  '01-ai': '01.AI', perplexity: 'Perplexity', baidu: 'Baidu', tencent: 'Tencent', bytedance: 'ByteDance',
  'bytedance-seed': 'ByteDance', ibm: 'IBM', 'ibm-granite': 'IBM', ai21: 'AI21', ai21labs: 'AI21', nousresearch: 'Nous',
  allenai: 'Ai2', liquid: 'Liquid', reka: 'Reka', inflection: 'Inflection', stepfun: 'StepFun', 'stepfun-ai': 'StepFun'
}
const PROVIDER_COMPANY: Record<string, string> = { gemini: 'Google', openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek', qwen: 'Alibaba Qwen' }
/** Owner values that say nothing about who made the model. */
const GENERIC_OWNERS = new Set(['system', 'user', 'organization', 'org', 'library', 'custom', 'public', 'default', 'models', 'model', 'unknown', 'local', 'owner', 'vllm', 'openrouter'])
/** Leading ID words that are not a model family. */
const GENERIC_WORDS = new Set(['models', 'model', 'chat', 'text', 'instruct', 'base', 'latest', 'free', 'preview', 'beta', 'v', 'accounts', 'fireworks', 'hf', 'ft'])

export const UNKNOWN_COMPANY = 'Stracker AI'

const MAX_LABEL = 40

/** "acme-labs" → "Acme Labs"; keeps names that already carry capitals ("MiniMax"). */
function prettyName(raw: string): string {
  const words = raw.split(/[-_\s]+/).filter(Boolean)
  return words.map(word => /[A-Z]/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function vendorCompany(raw: string | null | undefined): string | null {
  const key = String(raw ?? '').trim().toLowerCase()
  if (!key || GENERIC_OWNERS.has(key) || !/^[a-z][a-z0-9 ._-]{0,30}$/i.test(key)) return null
  return VENDOR_COMPANY[key] ?? prettyName(String(raw).trim())
}

/** Broadest family word of an ID: "MiniMax-M2" → "MiniMax", "mistral-large-3.1" → "Mistral". */
function familyWord(modelName: string): string | null {
  for (const token of modelName.split(/[^A-Za-z]+/)) {
    if (token.length < 2 || GENERIC_WORDS.has(token.toLowerCase())) continue
    return /[A-Z]/.test(token) ? token : token.charAt(0).toUpperCase() + token.slice(1)
  }
  return null
}

/**
 * Company + family label for a model, or null when nothing is known. Known families map
 * individually; otherwise the label comes from the list's owner/org field or the ID's
 * "vendor/" prefix, plus the broadest family word, then the provider's company.
 */
export function modelCompany(providerId: string | null | undefined, modelId: string | null | undefined, ownedBy?: string | null): string | null {
  const id = String(modelId ?? '').trim().replace(/^models\//, '')
  for (const [pattern, label] of FAMILY_PATTERNS) if (pattern.test(id)) return label
  const parts = id.split('/').filter(Boolean)
  const name = parts.length ? parts[parts.length - 1]! : ''
  const company = (parts.length > 1 ? vendorCompany(parts[parts.length - 2]) : null) ?? vendorCompany(ownedBy) ?? PROVIDER_COMPANY[String(providerId ?? '')] ?? null
  if (PROVIDER_COMPANY[String(providerId ?? '')] && company === PROVIDER_COMPANY[String(providerId ?? '')]) return company
  const family = providerId && providerId !== 'custom' && company ? null : familyWord(name)
  let label: string | null
  if (company && family) label = company.toLowerCase().replace(/\s+/g, '').includes(family.toLowerCase()) || family.toLowerCase().includes(company.toLowerCase().replace(/\s+/g, '')) ? company : `${company} ${family}`
  else label = company ?? family
  return label ? label.slice(0, MAX_LABEL) : null
}

/** Label students see for the default model in use, or just "Stracker AI". */
export function publicCompanyName(providerId: string | null | undefined, modelId: string | null | undefined, stored?: unknown): string {
  if (typeof stored === 'string' && stored.trim()) return stored.trim().slice(0, MAX_LABEL)
  return modelCompany(providerId, modelId) ?? UNKNOWN_COMPANY
}

const KNOWN_LABELS = new Set([...FAMILY_PATTERNS.map(([, label]) => label), ...Object.values(PROVIDER_COMPANY), UNKNOWN_COMPANY])

/**
 * Model ID as returned to a student from stored history: rows answered by Stracker AI (Default)
 * (provider "stracker") only ever show the label, including rows saved before this masking.
 */
export function publicStoredModelId(providerId: unknown, modelId: unknown): string | null {
  if (modelId === null || modelId === undefined) return null
  const value = String(modelId)
  if (providerId !== 'stracker') return value
  if (KNOWN_LABELS.has(value)) return value
  return modelCompany(null, value) ?? UNKNOWN_COMPANY
}

/** Applies publicStoredModelId to one stored message/task row (and its fallback metadata). */
export function maskStoredModel<T extends Record<string, unknown>>(row: T): T {
  const next: Record<string, unknown> = { ...row }
  if ('model_id' in next) next.model_id = publicStoredModelId(next.provider_id, next.model_id)
  const metadata = next.metadata as Record<string, unknown> | null | undefined
  const from = metadata?.fallback_from as Record<string, unknown> | null | undefined
  if (from && typeof from === 'object' && 'model_id' in from) next.metadata = { ...metadata, fallback_from: { ...from, model_id: publicStoredModelId(from.provider_id, from.model_id) } }
  return next as T
}
