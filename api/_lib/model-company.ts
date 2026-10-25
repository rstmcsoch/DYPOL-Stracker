/**
 * Company (vendor) behind an AI model, for showing students only who makes the Stracker AI
 * (Default) model in use, never its model ID, key, endpoint or the owner's label.
 * Order matters: the most specific patterns come first.
 */
const COMPANY_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/nemotron|nvidia|(^|\/)nv-/i, 'NVIDIA'],
  [/(^|\/)(gpt|chatgpt|o\d|openai|text-davinci|davinci|babbage|codex)/i, 'OpenAI'],
  [/gemini|gemma|palm|bison|learnlm|(^|\/)google\//i, 'Google'],
  [/claude|anthropic/i, 'Anthropic'],
  [/llama|(^|\/)meta(-llama)?\//i, 'Meta'],
  [/mistral|mixtral|codestral|ministral|pixtral|magistral|devstral/i, 'Mistral AI'],
  [/deepseek/i, 'DeepSeek'],
  [/grok|(^|\/)x-?ai\//i, 'xAI'],
  [/qwen|qwq|(^|\/)alibaba\//i, 'Alibaba Qwen'],
  [/(^|\/)(command|cohere)|aya/i, 'Cohere'],
  [/phi-?\d|(^|\/)microsoft\//i, 'Microsoft'],
  [/(^|\/)(amazon|nova)[-/]|titan/i, 'Amazon'],
  [/kimi|moonshot/i, 'Moonshot AI'],
  [/glm|zhipu|z-ai|chatglm/i, 'Zhipu AI'],
  [/minimax|abab/i, 'MiniMax'],
  [/(^|\/)yi-|01-ai/i, '01.AI'],
  [/sonar|perplexity/i, 'Perplexity'],
  [/ernie|baidu/i, 'Baidu'],
  [/hunyuan|tencent/i, 'Tencent'],
  [/doubao|bytedance|seed-/i, 'ByteDance'],
  [/granite|(^|\/)ibm/i, 'IBM'],
  [/jamba|ai21/i, 'AI21 Labs'],
  [/(^|\/)reka/i, 'Reka'],
  [/hermes|nousresearch/i, 'Nous Research'],
  [/olmo|allenai/i, 'Ai2'],
  [/(^|\/)liquid|lfm-/i, 'Liquid AI']
]
const PROVIDER_COMPANY: Record<string, string> = { gemini: 'Google', openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek', qwen: 'Alibaba Qwen' }
/** Exact `owned_by` values some OpenAI-compatible model lists return. */
const OWNER_COMPANY: Record<string, string> = { openai: 'OpenAI', system: '', google: 'Google', anthropic: 'Anthropic', meta: 'Meta', 'meta-llama': 'Meta', mistralai: 'Mistral AI', mistral: 'Mistral AI', deepseek: 'DeepSeek', 'deepseek-ai': 'DeepSeek', nvidia: 'NVIDIA', xai: 'xAI', 'x-ai': 'xAI', qwen: 'Alibaba Qwen', alibaba: 'Alibaba Qwen', cohere: 'Cohere', microsoft: 'Microsoft' }

export const UNKNOWN_COMPANY = 'Stracker AI'

/** Company for a model, from its ID, then a listing's `owned_by`, then the provider. Unknown → null. */
export function modelCompany(providerId: string | null | undefined, modelId: string | null | undefined, ownedBy?: string | null): string | null {
  const id = String(modelId ?? '').trim()
  for (const [pattern, company] of COMPANY_PATTERNS) if (pattern.test(id)) return company
  const owner = String(ownedBy ?? '').trim().toLowerCase()
  if (owner && OWNER_COMPANY[owner]) return OWNER_COMPANY[owner]!
  return PROVIDER_COMPANY[String(providerId ?? '')] ?? null
}

/** Name students see for the default model in use: the company, or just "Stracker AI". */
export function publicCompanyName(providerId: string | null | undefined, modelId: string | null | undefined, stored?: unknown): string {
  if (typeof stored === 'string' && stored.trim()) return stored.trim().slice(0, 40)
  return modelCompany(providerId, modelId) ?? UNKNOWN_COMPANY
}

const KNOWN_COMPANIES = new Set([...COMPANY_PATTERNS.map(([, company]) => company), UNKNOWN_COMPANY])

/**
 * Model ID as returned to a student from stored history: rows answered by Stracker AI (Default)
 * (provider "stracker") only ever show the company, including rows saved before this masking.
 */
export function publicStoredModelId(providerId: unknown, modelId: unknown): string | null {
  if (modelId === null || modelId === undefined) return null
  const value = String(modelId)
  if (providerId !== 'stracker') return value
  if (KNOWN_COMPANIES.has(value)) return value
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
