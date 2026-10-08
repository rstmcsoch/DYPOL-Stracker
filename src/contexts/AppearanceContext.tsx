/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useData } from './DataContext'
import { useToast } from './ToastContext'
import { normalizeInterfaceFont } from '../lib/fonts'
import type { AppSettings, InterfaceFont, ThemeMode } from '../types'

export type ResolvedTheme = 'light' | 'dark'

interface AppearanceContextValue {
  /** Stored preference, including `auto`. */
  theme: ThemeMode
  /** What the UI is actually rendering right now. */
  resolvedTheme: ResolvedTheme
  isDark: boolean
  interfaceFont: InterfaceFont
  /** Persist a new theme through the existing app_settings row. */
  setTheme: (theme: ThemeMode) => void
  /** Persist a new interface font through the existing app_settings row. */
  setInterfaceFont: (font: InterfaceFont) => void
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
 * Single source of truth for the presentation preferences that live in `app_settings`.
 *
 * The DOM contract is deliberately small: `data-theme` on <html> drives the existing
 * CSS variable palette, and `data-font` swaps the interface font family. Both are applied
 * with plain attributes, so switching either one never re-renders the route tree or
 * injects styles at runtime.
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
  const interfaceFont = normalizeInterfaceFont(settings.interface_font)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolvedTheme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR)
  }, [resolvedTheme])

  useEffect(() => {
    document.documentElement.dataset.font = interfaceFont
  }, [interfaceFont])

  const persist = useCallback((patch: Partial<Pick<AppSettings, 'theme' | 'interface_font'>>) => {
    // Queue writes so rapid taps can never land out of order in IndexedDB or the sync queue.
    writeQueue.current = writeQueue.current.then(async () => {
      setSaving(true)
      try {
        await upsert('app_settings', { ...settingsRef.current, ...patch, updated_at: new Date().toISOString() })
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Could not save that preference. Try again.', 'error')
      } finally {
        setSaving(false)
      }
    })
  }, [notify, upsert])

  const setTheme = useCallback((next: ThemeMode) => persist({ theme: next }), [persist])
  const setInterfaceFont = useCallback((next: InterfaceFont) => persist({ interface_font: next }), [persist])

  const value = useMemo<AppearanceContextValue>(() => ({
    theme, resolvedTheme, isDark: resolvedTheme === 'dark', interfaceFont, setTheme, setInterfaceFont, saving
  }), [theme, resolvedTheme, interfaceFont, setTheme, setInterfaceFont, saving])

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext)
  if (!context) throw new Error('useAppearance must be used inside AppearanceProvider')
  return context
}
