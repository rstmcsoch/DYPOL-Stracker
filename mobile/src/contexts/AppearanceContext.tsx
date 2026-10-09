import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import type { AppSettings, ColorTheme, ReadingFont, ThemeMode } from '../shared/types'
import { normalizeColorTheme } from '../shared/lib/themes'
import { normalizeReadingFont } from '../shared/lib/fonts'
import { buildTheme, type AppTheme } from '../theme/theme'
import { useData } from './DataContext'
import { useToast } from './ToastContext'

export type ResolvedTheme = 'light' | 'dark'

interface AppearanceContextValue {
  /** Stored display-mode preference, including `auto`. */
  theme: ThemeMode
  resolvedTheme: ResolvedTheme
  isDark: boolean
  colorTheme: ColorTheme
  readingFont: ReadingFont
  setTheme: (theme: ThemeMode) => void
  setColorTheme: (colorTheme: ColorTheme) => void
  saving: boolean
  appTheme: AppTheme
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null)

/**
 * Owns the account's appearance. The display mode, colour palette, and reading font are stored in
 * the same app_settings row as on the website, so a change made on either platform follows the
 * account. Changing one never resets another, and writes are applied in order.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { data, upsert } = useData()
  const { notify } = useToast()
  const systemScheme = useColorScheme()
  const [saving, setSaving] = useState(false)

  const settings = data.settings
  const settingsRef = useRef<AppSettings>(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])
  const writeQueue = useRef<Promise<void>>(Promise.resolve())

  const theme = settings.theme
  const colorTheme = normalizeColorTheme(settings.color_theme)
  const readingFont = normalizeReadingFont(settings.interface_font)
  const resolvedTheme: ResolvedTheme = theme === 'auto' ? (systemScheme === 'dark' ? 'dark' : 'light') : theme
  const appTheme = useMemo(() => buildTheme(resolvedTheme, colorTheme, readingFont), [resolvedTheme, colorTheme, readingFont])

  const persistAppearance = useCallback((patch: { theme?: ThemeMode; color_theme?: ColorTheme }) => {
    const write = writeQueue.current.then(async () => {
      setSaving(true)
      try {
        await upsert('app_settings', { ...settingsRef.current, ...patch, updated_at: new Date().toISOString() })
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Could not save that preference. Try again.', 'error')
      } finally {
        setSaving(false)
      }
    })
    writeQueue.current = write
    return write
  }, [notify, upsert])

  const setTheme = useCallback((next: ThemeMode) => { void persistAppearance({ theme: next }) }, [persistAppearance])
  const setColorTheme = useCallback((next: ColorTheme) => { void persistAppearance({ color_theme: normalizeColorTheme(next) }) }, [persistAppearance])

  const value = useMemo<AppearanceContextValue>(() => ({
    theme, resolvedTheme, isDark: resolvedTheme === 'dark', colorTheme, readingFont, setTheme, setColorTheme, saving, appTheme
  }), [theme, resolvedTheme, colorTheme, readingFont, setTheme, setColorTheme, saving, appTheme])

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext)
  if (!context) throw new Error('useAppearance must be used inside AppearanceProvider')
  return context
}

const ThemeOverrideContext = createContext<AppTheme | null>(null)

/**
 * Scopes a theme to a subtree. The public landing page uses it for its own light and dark switch,
 * which, like the website's, never changes the account's appearance settings.
 */
export function ThemeOverride({ theme, children }: { theme: AppTheme; children: ReactNode }) {
  return <ThemeOverrideContext.Provider value={theme}>{children}</ThemeOverrideContext.Provider>
}

/** Theme tokens for the current appearance. Components call this instead of building themes themselves. */
export function useTheme(): AppTheme {
  const override = useContext(ThemeOverrideContext)
  const { appTheme } = useAppearance()
  return override ?? appTheme
}
