const SECRET_PATTERNS = [
  /\bAIza[0-9A-Za-z_-]{20,}\b/gi,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/gi,
  /\b(?:api[_ -]?key|secret|access[_ -]?token)\s*[:=]\s*["']?[^\s"']{12,}["']?/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi
]

/** Redact common provider credential formats before data can enter chat history or telemetry. */
export function redactPotentialSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[redacted credential]'), value)
}
