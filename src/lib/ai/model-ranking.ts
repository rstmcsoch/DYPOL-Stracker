import type { AIProviderId } from './catalog'

/**
 * Ranked default-model preferences per provider. Each entry is an exact model ID or a pattern in
 * which `*` stands for a version number (e.g. `gemini-*-flash` matches gemini-3.8-flash and
 * gemini-2.5-flash, newest version first). Previews/experimental IDs only match when listed
 * explicitly. The live model list for the student's key decides what is actually available, and
 * an auto-test (with a latency limit) decides which candidate is used.
 */
export const DEFAULT_MODEL_PREFERENCES: Record<Exclude<AIProviderId, 'custom'>, string[]> = {
  gemini: ['gemini-*-flash', 'gemini-flash-latest', 'gemini-*-flash-lite', 'gemini-flash-lite-latest'],
  openai: ['gpt-*-mini', 'gpt-*o-mini', 'gpt-*', 'gpt-*o'],
  anthropic: ['claude-sonnet-*', 'claude-*-sonnet', 'claude-*-sonnet-latest', 'claude-haiku-*', 'claude-*-haiku', 'claude-*-haiku-latest'],
  deepseek: ['deepseek-chat', 'deepseek-v*'],
  qwen: ['qwen-plus', 'qwen-plus-latest', 'qwen*-plus', 'qwen-turbo', 'qwen-max']
}

/** A model whose test reply takes longer than this is skipped as the automatic default. */
export const AUTO_MODEL_MAX_LATENCY_MS = 8_000
/** At most this many candidates are auto-tested (connection tests are rate limited). */
export const AUTO_MODEL_MAX_ATTEMPTS = 4

const VERSION = '([0-9]+(?:[.-][0-9]+)*)'
function escape(text: string): string { return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&') }

function versionKey(version: string): number[] { return version.split(/[.-]/).map(Number) }
function compareDesc(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (b[index] ?? 0) - (a[index] ?? 0)
    if (diff) return diff
  }
  return 0
}

/** Live model IDs ordered by preference (unmatched models are not suggested). */
export function rankModels(liveIds: string[], preferences: string[]): string[] {
  const ranked: string[] = []
  const seen = new Set<string>()
  for (const pattern of preferences) {
    const clean = pattern.trim().toLowerCase()
    if (!clean) continue
    if (!clean.includes('*')) {
      const hit = liveIds.find(id => id.toLowerCase() === clean)
      if (hit && !seen.has(hit)) { seen.add(hit); ranked.push(hit) }
      continue
    }
    const regex = new RegExp(`^${clean.split('*').map(escape).join(VERSION)}$`)
    const matches = liveIds
      .map(id => ({ id, match: regex.exec(id.toLowerCase()) }))
      .filter((entry): entry is { id: string; match: RegExpExecArray } => Boolean(entry.match) && !seen.has(entry.id))
      .sort((a, b) => compareDesc(versionKey(a.match[1] ?? '0'), versionKey(b.match[1] ?? '0')))
    for (const { id } of matches) { seen.add(id); ranked.push(id) }
  }
  return ranked
}

export interface CandidateResult { ok: boolean; latencyMs?: number }

/**
 * Try ranked candidates in order; the first that passes its test within the latency limit wins.
 * A candidate that works but is slow is remembered and used only if nothing faster passes.
 */
export async function pickDefaultModel(candidates: string[], test: (modelId: string) => Promise<CandidateResult>, maxAttempts = AUTO_MODEL_MAX_ATTEMPTS, maxLatencyMs = AUTO_MODEL_MAX_LATENCY_MS): Promise<{ modelId: string | null; tried: Array<{ modelId: string } & CandidateResult> }> {
  const tried: Array<{ modelId: string } & CandidateResult> = []
  let slowWinner: string | null = null
  for (const modelId of candidates.slice(0, maxAttempts)) {
    let result: CandidateResult
    try { result = await test(modelId) } catch { result = { ok: false } }
    tried.push({ modelId, ...result })
    if (!result.ok) continue
    if ((result.latencyMs ?? 0) <= maxLatencyMs) return { modelId, tried }
    slowWinner ??= modelId
  }
  return { modelId: slowWinner, tried }
}
