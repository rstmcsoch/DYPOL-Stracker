/**
 * Field-level equality for persisted settings, including objects (subject targets)
 * and arrays (revision gaps, reminder types). Key or item order must not look like
 * an unsaved edit after a load or save.
 */
export function sameSettingValue(left: unknown, right: unknown): boolean {
  return Object.is(left, right) || stableStringify(left) === stableStringify(right)
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    const items = value.every(item => typeof item === 'string' || typeof item === 'number')
      ? [...value].map(item => (typeof item === 'string' ? item : item)).sort((a, b) => a === b ? 0 : a < b ? -1 : 1)
      : value
    return `[${items.map(item => stableStringify(item)).join(',')}]`
  }
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`
}

export function rhythmTextsDirty(
  gapsText: string,
  dailyGoalText: string,
  settings: { revision_gaps: readonly number[]; daily_study_goal_minutes: number }
): boolean {
  return gapsText !== settings.revision_gaps.join(', ') || dailyGoalText !== String(settings.daily_study_goal_minutes / 60)
}
