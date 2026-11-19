import type { AppSettings, ThemeMode } from '../types'

const sameValue = (left: unknown, right: unknown): boolean =>
  Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right)

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
