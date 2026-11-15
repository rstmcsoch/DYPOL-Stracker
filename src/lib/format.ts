const numberFormatters = new Map<number, Intl.NumberFormat>()

export function fmtNumber(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—'
  let formatter = numberFormatters.get(digits)
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits })
    numberFormatters.set(digits, formatter)
  }
  return formatter.format(value)
}

export function fmtDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes))
  const hours = Math.floor(safe / 60)
  const mins = safe % 60
  return hours ? `${hours}h ${mins}m` : `${mins}m`
}

export function percent(value: number | null | undefined, total: number | null | undefined): number | null {
  if (value == null || total == null || !Number.isFinite(value) || !Number.isFinite(total) || total <= 0 || value < 0 || value > total) return null
  return (value / total) * 100
}

export function safeLabel(value: string | null | undefined, fallback = 'Untitled'): string {
  return value?.trim() || fallback
}
