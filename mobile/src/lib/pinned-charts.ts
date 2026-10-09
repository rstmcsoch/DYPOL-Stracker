import { secureSessionStorage } from './secure-storage'

/** The charts a user can pin to Favourites. Ids match the website's chart identifiers. */
export const CHART_IDS = ['performance', 'mistakes', 'study-hours', 'heatmap', 'syllabus', 'target'] as const
export type ChartId = (typeof CHART_IDS)[number]
export const PIN_LIMIT = 3

/** SecureStore keys may only contain letters, digits, dots, hyphens, and underscores. */
function storageKey(userId: string): string {
  return `stracker-pinned-charts.${userId.replace(/[^A-Za-z0-9_-]/g, '')}`
}

/**
 * Pinned charts are a device-level preference. They live in the Keystore-backed secure store rather
 * than plain storage, so the preference shares the same protection as the session.
 */
export async function loadPinnedCharts(userId: string): Promise<ChartId[]> {
  try {
    const raw = await secureSessionStorage.getItem(storageKey(userId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is ChartId => (CHART_IDS as readonly string[]).includes(String(id))).slice(0, PIN_LIMIT)
  } catch {
    return []
  }
}

export async function savePinnedCharts(userId: string, pinned: ChartId[]): Promise<void> {
  try {
    await secureSessionStorage.setItem(storageKey(userId), JSON.stringify(pinned.slice(0, PIN_LIMIT)))
  } catch {
    // A failed write leaves pinning working for this session only; the next launch restores the last saved state.
  }
}
