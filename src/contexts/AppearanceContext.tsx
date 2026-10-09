/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useData } from './DataContext'
import { useToast } from './ToastContext'
import { applyReadingFont, clearReadingFont, normalizeReadingFont } from '../lib/fonts'
import type { AppSettings, ReadingFont, ThemeMode } from '../types'

export type ResolvedTheme = 'light' | 'dark'

interface AppearanceContextValue {
  /** Stored preference, including `auto`. */
  theme: ThemeMode
  /** What the UI is actually rendering right now. */
  resolvedTheme: ResolvedTheme
  isDark: boolean
  /** The committed, account-scoped Reading font (drafts stay inside SettingsPage). */
  readingFont: ReadingFont
  /** Persist a theme toggle through the existing app_settings row. */
  setTheme: (theme: ThemeMode) => void
  saving: boolean
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null)

const LIGHT_THEME_COLOR = '#f7f4ec'
const DARK_THEME_COLOR = '#202522'

/** Tracks the device appearance so `auto` can resolve without duplicating theme state. */
function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return prefersDark
}

/**
 * Runtime owner of the committed account appearance. Reading-font drafts are owned
 * solely by the Appearance tab in SettingsPage: this provider only applies a saved
 * value and never persists a font on selection. The public site and public auth routes
 * do not mount this provider and always use their fixed CSS typography scope.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { data, upsert } = useData()
  const { notify } = useToast()
  const systemPrefersDark = useSystemPrefersDark()
  const [saving, setSaving] = useState(false)

  const settings = data.settings
  const settingsRef = useRef<AppSettings>(settings)
  settingsRef.current = settings
  const writeQueue = useRef<Promise<void>>(Promise.resolve())

  const theme = settings.theme
  const resolvedTheme: ResolvedTheme = theme === 'auto' ? (systemPrefersDark ? 'dark' : 'light') : theme
  const readingFont = normalizeReadingFont(settings.interface_font)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolvedTheme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR)
  }, [resolvedTheme])

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.appFont = 'active'
    applyReadingFont(root, readingFont)
  }, [readingFont])

  // Never carry one account's reading preference across sign-out or into public routes.
  useLayoutEffect(() => () => {
    const root = document.documentElement
    delete root.dataset.appFont
    clearReadingFont(root)
  }, [])

  const persistTheme = useCallback((nextTheme: ThemeMode) => {
    const write = writeQueue.current.then(async () => {
      setSaving(true)
      try {
        await upsert('app_settings', {
          ...settingsRef.current,
          theme: nextTheme,
          updated_at: new Date().toISOString()
        })
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Could not save that preference. Try again.', 'error')
      } finally {
        setSaving(false)
      }
    })
    writeQueue.current = write
    return write
  }, [notify, upsert])

  const setTheme = useCallback((next: ThemeMode) => {
    void persistTheme(next)
  }, [persistTheme])

  const value = useMemo<AppearanceContextValue>(() => ({
    theme,
    resolvedTheme,
    isDark: resolvedTheme === 'dark',
    readingFont,
    setTheme,
    saving
  }), [theme, resolvedTheme, readingFont, setTheme, saving])

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext)
  if (!context) throw new Error('useAppearance must be used inside AppearanceProvider')
  return context
}
