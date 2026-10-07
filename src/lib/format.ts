export function fmtNumber(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(value)
}

export function fmtDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes))
  const hours = Math.floor(safe / 60)
  const mins = safe % 60
  return hours ? `${hours}h ${mins}m` : `${mins}m`
}

export function percent(value: number | null | undefined, total: number | null | undefined): number | null {
  if (value == null || total == null || !Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null
  return Math.max(0, Math.min(100, (value / total) * 100))
}

export function safeLabel(value: string | null | undefined, fallback = 'Untitled'): string {
  return value?.trim() || fallback
}
