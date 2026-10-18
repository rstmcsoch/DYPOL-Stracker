/**
 * Display preference for the Control Center only (Light, Dark or follow the device).
 *
 * This is the owner's personal interface setting. It is deliberately separate from the
 * notebook's `app_settings.theme` (the student's own preference) and from the public
 * website's branding, so changing one never changes the others.
 *
 * It lives in this shared module rather than under src/control/ because it is a single,
 * non-sensitive display value and the console must not hold browser-storage access itself.
 * Only the three literal values are ever stored; no identifiers, tokens or account data.
 */

export type ControlThemePreference = 'light' | 'dark' | 'system'
export type ResolvedControlTheme = 'light' | 'dark'

export const CONTROL_THEME_STORAGE_KEY = 'stracker-control-center-theme'

/** The Control Center has always been dark; that stays the default for every owner. */
export const DEFAULT_CONTROL_THEME: ControlThemePreference = 'dark'

export const CONTROL_THEME_OPTIONS: ReadonlyArray<{ value: ControlThemePreference; label: string; description: string }> = [
  { value: 'light', label: 'Light', description: 'Light surfaces for daytime work' },
  { value: 'dark', label: 'Dark', description: 'Dark surfaces (the Control Center default)' },
  { value: 'system', label: 'System', description: 'Follow this device’s light or dark setting' }
]

export function normalizeControlTheme(value: unknown): ControlThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : DEFAULT_CONTROL_THEME
}

/** Reads the stored preference. Any storage failure or unknown value yields the default. */
export function readControlThemePreference(): ControlThemePreference {
  if (typeof window === 'undefined') return DEFAULT_CONTROL_THEME
  try {
    return normalizeControlTheme(window.localStorage.getItem(CONTROL_THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_CONTROL_THEME
  }
}

export function writeControlThemePreference(value: ControlThemePreference): void {
  try {
    window.localStorage.setItem(CONTROL_THEME_STORAGE_KEY, value)
  } catch {
    // Storage can be unavailable; the choice still applies for this page view.
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveControlTheme(preference: ControlThemePreference, prefersDark: boolean): ResolvedControlTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light'
  return preference
}
