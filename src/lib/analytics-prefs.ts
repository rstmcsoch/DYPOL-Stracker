export const HOURS_VIEWS = ['day', 'week', 'month'] as const
export type HoursView = (typeof HOURS_VIEWS)[number]

export function hoursViewKey(userId: string) { return `stracker-analytics-hours:${userId}` }

export function loadHoursView(userId: string): HoursView {
  try {
    const raw = localStorage.getItem(hoursViewKey(userId))
    return raw && (HOURS_VIEWS as readonly string[]).includes(raw) ? raw as HoursView : 'day'
  } catch { return 'day' }
}

export function saveHoursView(userId: string, view: HoursView) {
  try { localStorage.setItem(hoursViewKey(userId), view) } catch { /* a blocked store keeps the grouping for this visit only */ }
}
