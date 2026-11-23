/**
 * Provider finish reasons that mean the answer hit the output token cap and was cut off.
 * OpenAI uses `length`, Anthropic `max_tokens`, Gemini `MAX_TOKENS`.
 */
export function isOutputTruncated(reason: unknown): boolean {
  if (typeof reason !== 'string' || !reason.trim()) return false
  const normalized = reason.toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalized === 'length' || normalized === 'maxtokens' || normalized === 'maxoutputtokens'
}

/** Sent when the student taps Continue after a truncated answer. */
export const CONTINUE_ANSWER_PROMPT = 'Continue the previous answer from where it stopped. Do not repeat what you already wrote.'
