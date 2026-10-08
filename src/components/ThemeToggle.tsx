import { Moon, Sun } from 'lucide-react'
import { useAppearance } from '../contexts/AppearanceContext'

/**
 * Direct light/night switch for the top-right corner of the shell.
 *
 * It writes through the same `app_settings.theme` value the Settings page edits, so the two
 * can never disagree. Choosing a theme here always stores an explicit `light`/`dark`; when
 * the stored preference is `auto`, the control shows the theme the device is currently
 * resolving to and the next press pins that choice.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { isDark, theme, setTheme } = useAppearance()
  const action = isDark ? 'Switch to light mode' : 'Switch to night mode'
  const label = isDark ? 'Night mode on' : 'Light mode on'

  return <button
    type="button"
    role="switch"
    aria-checked={isDark}
    aria-label={`${label}. ${action}.`}
    title={`${label} — ${action}${theme === 'auto' ? ' (auto theme follows this device)' : ''}`}
    className={`theme-toggle ${isDark ? 'theme-toggle-dark' : 'theme-toggle-light'} ${className}`}
    onClick={() => setTheme(isDark ? 'light' : 'dark')}
  >
    <span className="theme-toggle-track" aria-hidden="true">
      <Sun size={13} className="theme-toggle-icon theme-toggle-sun" />
      <Moon size={13} className="theme-toggle-icon theme-toggle-moon" />
      <span className="theme-toggle-thumb" />
    </span>
    <span className="theme-toggle-copy">
      <strong>{isDark ? 'Night' : 'Light'}</strong>
      <small>{theme === 'auto' ? 'Auto' : 'Theme'}</small>
    </span>
  </button>
}
