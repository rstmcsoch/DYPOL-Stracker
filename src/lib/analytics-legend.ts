export function hiddenSeriesKey(userId: string, chart = 'marks-trend') { return `stracker-analytics-hidden:${chart}:${userId}` }

/** Legend lines the student hid on a chart, remembered on this device beside the range. */
export function loadHiddenSeries(userId: string, chart = 'marks-trend'): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(hiddenSeriesKey(userId, chart)) ?? '[]')
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string').slice(0, 20) : []
  } catch { return [] }
}

export function saveHiddenSeries(userId: string, hidden: string[], chart = 'marks-trend') {
  try { localStorage.setItem(hiddenSeriesKey(userId, chart), JSON.stringify(hidden)) } catch { /* a blocked store keeps the choice for this visit only */ }
}
