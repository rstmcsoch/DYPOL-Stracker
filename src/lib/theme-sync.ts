import type { AppSettings, ThemeMode } from '../types'

const sameValue = (left: unknown, right: unknown): boolean =>
  Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right)

const MISSING_COLUMN_RE = /Could not find the '([a-z0-9_]+)' column of '[a-z0-9_]+' in the schema cache/i

/**
 * True when an `app_settings` update changes only the Light/Night display mode (`theme`)
 * (or makes no substantive change at all, ignoring `updated_at`).
 *
 * Display mode is kept device-local so toggling Light/Night never queues a cloud write
 * or surfaces a sync error. Any edit that also touches another setting (font, colour
 * palette, exam dates, targets, thresholds, reminders, etc.) returns `false` and syncs
 * to Supabase normally.
 */
export function isThemeOnlySettingsChange(before: AppSettings, after: AppSettings): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    if (key === 'theme' || key === 'updated_at') continue
    const prev = (before as unknown as Record<string, unknown>)[key]
    const next = (after as unknown as Record<string, unknown>)[key]
    if (!sameValue(prev, next)) return false
  }
  return true
}

/**
 * Keeps this device's saved Light/Night display mode when cloud `app_settings` are pulled
 * down during a refresh or conflict resolution, while still accepting every other cloud
 * setting. On a brand-new device with no local settings row yet, the cloud mode is used.
 */
export function preserveLocalTheme(cloudSettings: AppSettings, localTheme: ThemeMode | undefined): AppSettings {
  if (localTheme === 'light' || localTheme === 'dark' || localTheme === 'auto') {
    return cloudSettings.theme === localTheme ? cloudSettings : { ...cloudSettings, theme: localTheme }
  }
  return cloudSettings
}

/**
 * Extracts the missing column name from a PostgREST PGRST204 schema-cache error when the
 * browser sends a newer additive column that has not been migrated in Supabase yet.
 */
export function missingSchemaColumn(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
  const message = 'message' in error ? String((error as { message?: unknown }).message ?? '') : ''
  if (code && code !== 'PGRST204') return null
  return MISSING_COLUMN_RE.exec(message)?.[1] ?? null
}

/** Returns shallow copies of `rows` with `column` omitted so a cloud upsert can retry safely. */
export function stripColumnFromRows(rows: Record<string, unknown>[], column: string): Record<string, unknown>[] {
  return rows.map(row => {
    const copy = { ...row }
    delete copy[column]
    return copy
  })
}
