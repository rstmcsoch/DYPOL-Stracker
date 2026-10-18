import type { AppSettings } from '../../types/index.js'
import { normalizeColorTheme } from '../themes.js'
import type { SiteValues } from './content.js'

/**
 * Owner defaults for a brand-new student's display mode and colour theme
 * (user.appearance.*). Only used when an account has no settings row yet, so a
 * student's own choice is never overwritten. Unknown values keep the built-in default.
 */
export function applyOwnerThemeDefaults(settings: AppSettings, values: SiteValues): AppSettings {
  const mode = values['user.appearance.default_mode']
  const theme = mode === 'light' || mode === 'dark' || mode === 'auto' ? mode : settings.theme
  const color = values['user.appearance.default_color']
  return { ...settings, theme, color_theme: color ? normalizeColorTheme(color) : settings.color_theme }
}
