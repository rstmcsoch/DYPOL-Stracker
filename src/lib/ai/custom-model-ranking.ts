/**
 * Ranks model IDs listed by a custom OpenAI-compatible endpoint (NVIDIA, OpenRouter, Together,
 * Groq…) by how likely each is to be a good general chat model today. Name heuristics only, plus
 * the `created` timestamp when the endpoint returns real ones. The server then tests the top
 * candidates with a tiny real chat completion, so this only decides the testing order.
 */
export interface CustomModelCandidate { id: string; created?: number | null }

/** Never chat models: embeddings, rerankers, safety/guard, reward, speech, vision-only, image/video, parsers, code completion, base checkpoints. */
const EXCLUDE = new RegExp([
  'embed', 'rerank', 'retriev', 'guard', 'safety', 'topic-control', 'moderation', 'reward',
  '\\btts\\b', '\\basr\\b', 'whisper', 'speech', 'audio', 'transcri', 'parakeet', 'canary', 'fastpitch',
  'clip\\b', 'siglip', 'kosmos', 'deplot', 'fuyu', '\\bneva\\b', '\\bvila\\b', 'paligemma',
  'diffusion', 'sdxl', '\\bflux', 'dall-?e', 'imagen', 'image-gen', 'video', 'detector', 'parse', 'ocr',
  'calibration', 'starcoder', 'codegemma', 'codellama', 'santacoder', '\\bfim\\b', '-base\\b'
].join('|'), 'i')

/** Families whose IDs are chat models even without an "-instruct" suffix. */
const CHAT_FAMILY = /(kimi|glm|deepseek-(v|r|chat)|minimax|gpt|claude|gemini|grok|\bo[1-9]\b|qwen\d|qwq|nemotron-\d|nemotron-(super|ultra|nano)|mistral-(large|medium|small)|yi-large|command|step-\d|palmyra|jamba|dbrx|sonar|hermes)/i
/** Clear chat/instruction-tuned markers. */
const CHAT_MARKER = /(instruct|chat|-it\b|-it-|reasoning|thinking|assistant)/i
/** Specialised or narrow models: usable, but not the best general study assistant. */
const SPECIALISED = /(code|coder|codestral|med\b|med-|fin-|translate|creative|chatqa|sea-lion|vision|-vl\b|-vl-|vlm|omni|cosmos|math|guard|tool-?use)/i

/** Superseded generations whose version numbers would otherwise look new (e.g. Nemotron-4 predates Nemotron 3). */
const LEGACY = /(nemotron-4-|llama-?2\b|llama2|llama-3-|llama3-|mixtral-8x|mistral-7b|gemma-\d+b\b|gemma-1|phi-[23]\b|phi-3|granite-3\.0|recurrentgemma)/i
/** Fast, smaller variants: good, but the full model of the same version goes first. */
const SPEED_VARIANT = /(flash|lite|mini|nano|bolt|lightning|turbo|instant|small|xs\b)/i

/** Family token → tier bonus and the version pattern for "newest in this family". */
const FAMILIES: { name: string; match: RegExp; tier: number }[] = [
  { name: 'kimi', match: /kimi-k?(\d+(?:\.\d+)?)/i, tier: 22 },
  { name: 'glm', match: /glm-?(\d+(?:\.\d+)?)/i, tier: 22 },
  { name: 'deepseek', match: /deepseek-[vr](\d+(?:\.\d+)?)/i, tier: 22 },
  { name: 'qwen', match: /qwen(\d+(?:\.\d+)?)/i, tier: 21 },
  { name: 'minimax', match: /minimax-m(\d+(?:\.\d+)?)/i, tier: 20 },
  { name: 'gpt', match: /gpt-(?:oss-)?(\d+(?:\.\d+)?)?/i, tier: 20 },
  { name: 'claude', match: /claude-(?:[a-z]+-)?(\d+(?:\.\d+)?)?/i, tier: 22 },
  { name: 'gemini', match: /gemini-(\d+(?:\.\d+)?)/i, tier: 22 },
  { name: 'grok', match: /grok-(\d+(?:\.\d+)?)/i, tier: 20 },
  { name: 'nemotron', match: /(?<!llama-[\d.]+-)nemotron-(\d+(?:\.\d+)?)(?![\d.]*b\b)/i, tier: 19 },
  { name: 'step', match: /step-(\d+(?:\.\d+)?)/i, tier: 16 },
  { name: 'llama', match: /llama-?(\d+(?:\.\d+)?)(?![\d.]*b\b)/i, tier: 13 },
  { name: 'gemma', match: /gemma-?(\d+(?:\.\d+)?)(?![\d.]*b\b)/i, tier: 13 },
  { name: 'mistral', match: /(?:mistral|mixtral|ministral|magistral)(?:-[a-z]+)*-?(\d+(?:\.\d+)?(?![\d.]*b\b))?/i, tier: 12 },
  { name: 'phi', match: /phi-?(\d+(?:\.\d+)?)/i, tier: 9 },
  { name: 'granite', match: /granite-(\d+(?:\.\d+)?)/i, tier: 8 },
  { name: 'command', match: /command-?[a-z]*-?(\d+)?/i, tier: 12 },
  { name: 'jamba', match: /jamba-(\d+(?:\.\d+)?)/i, tier: 8 },
  { name: 'yi', match: /\byi-/i, tier: 6 }
]

function familyOf(id: string): { name: string; tier: number; version: number | null } | null {
  for (const family of FAMILIES) {
    const match = family.match.exec(id)
    if (match) return { name: family.name, tier: family.tier, version: match[1] ? Number(match[1]) : null }
  }
  return null
}

/** Total parameters in billions: "70b", "8x22b", "120b-a12b" (MoE total), "e4b". */
export function parameterBillions(id: string): number | null {
  const lower = id.toLowerCase()
  const moe = /(\d+)x(\d+(?:\.\d+)?)b\b/.exec(lower)
  if (moe) return Number(moe[1]) * Number(moe[2])
  const sizes = [...lower.matchAll(/(?:^|[-_/.])e?(\d+(?:\.\d+)?)b\b/g)].map(match => Number(match[1]))
  return sizes.length ? Math.max(...sizes) : null
}

export function isExcludedCustomModel(id: string): boolean {
  return EXCLUDE.test(id.toLowerCase())
}

/** Higher is better. Exported for tests. */
export function scoreCustomModel(id: string, newestInFamily: Map<string, number>, createdRange?: { min: number; max: number }, created?: number | null): number {
  const lower = id.toLowerCase().replace(/^.*\//, '')
  let score = 50
  const family = familyOf(lower)
  const legacy = LEGACY.test(lower)
  if (legacy) score -= 15
  if (SPEED_VARIANT.test(lower)) score -= 3
  if (family) {
    score += family.tier
    const newest = newestInFamily.get(family.name)
    if (!legacy && family.version !== null && newest !== undefined) {
      const behind = newest - family.version
      score += behind <= 0 ? 6 : -Math.min(24, behind * 8)
    }
  }
  const chat = CHAT_MARKER.test(lower) || CHAT_FAMILY.test(lower)
  if (!chat) score -= 30 // likely a base/pretrained checkpoint
  if (SPECIALISED.test(lower)) score -= 18
  if (/(preview|experimental|\bexp\b|beta|alpha)/.test(lower)) score -= 4
  if (/v0\.\d/.test(lower)) score -= 6
  const size = parameterBillions(lower)
  if (size !== null) {
    if (size < 4) score -= 22
    else if (size < 10) score -= 8
    else if (size >= 40) score += 5
  }
  if (createdRange && created && createdRange.max > createdRange.min) {
    score += 8 * ((created - createdRange.min) / (createdRange.max - createdRange.min))
  }
  return score
}

/** Chat candidates ordered best first; excluded model types are dropped. */
export function rankCustomModels(models: (string | CustomModelCandidate)[]): string[] {
  const items = models.map(model => typeof model === 'string' ? { id: model } : model)
    .filter((item, index, all) => item.id && all.findIndex(other => other.id === item.id) === index)
    .filter(item => !isExcludedCustomModel(item.id))
  const newest = new Map<string, number>()
  for (const item of items) {
    const name = item.id.toLowerCase().replace(/^.*\//, '')
    const family = familyOf(name)
    if (family && family.version !== null && !LEGACY.test(name)) newest.set(family.name, Math.max(newest.get(family.name) ?? -Infinity, family.version))
  }
  // Only trust `created` when the endpoint returns real, varied timestamps (after 2020).
  const stamps = items.map(item => item.created).filter((value): value is number => typeof value === 'number' && value > 1_577_836_800)
  const range = stamps.length >= 2 && new Set(stamps).size > 1 ? { min: Math.min(...stamps), max: Math.max(...stamps) } : undefined
  return items
    .map(item => ({ id: item.id, score: scoreCustomModel(item.id, newest, range, item.created) }))
    .sort((a, b) => b.score - a.score || b.id.localeCompare(a.id))
    .map(item => item.id)
}

/** Probe limits: keep detection fast and within provider rate limits. */
export const CUSTOM_PROBE_WANTED = 5
export const CUSTOM_PROBE_MAX_TRIED = 10
export const CUSTOM_PROBE_BATCH = 5
export const CUSTOM_PROBE_TIMEOUT_MS = 12_000
