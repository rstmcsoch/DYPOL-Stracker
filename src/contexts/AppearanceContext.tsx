/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useData } from './DataContext'
import { useToast } from './ToastContext'
import { applyInterfaceFont, normalizeInterfaceFont } from '../lib/fonts'
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
 * Single runtime source of truth for appearance settings persisted in `app_settings`.
 *
 * `data-theme` drives the palette. The active font is applied once to `<html>` as
 * `--app-font-family`; all component typography roles and form controls inherit that
 * token. Font selection is optimistic so its visual change is synchronous with the
 * Settings action while the same value is saved to IndexedDB/cloud in the background.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { data, upsert } = useData()
  const { notify } = useToast()
  const systemPrefersDark = useSystemPrefersDark()
  const [saving, setSaving] = useState(false)
  const [pendingFont, setPendingFont] = useState<InterfaceFont | null>(null)

  const settings = data.settings
  const settingsRef = useRef<AppSettings>(settings)
  settingsRef.current = settings
  const writeQueue = useRef<Promise<void>>(Promise.resolve())

  const theme = settings.theme
  const resolvedTheme: ResolvedTheme = theme === 'auto' ? (systemPrefersDark ? 'dark' : 'light') : theme
  const interfaceFont = pendingFont ?? normalizeInterfaceFont(settings.interface_font)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolvedTheme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR)
  }, [resolvedTheme])

  useLayoutEffect(() => {
    applyInterfaceFont(document.documentElement, interfaceFont)
  }, [interfaceFont])

  // A committed settings row becomes the persisted source of truth. If its write fails
  // before reaching IndexedDB, release the optimistic value and restore the saved font.
  useEffect(() => {
    if (pendingFont !== null && pendingFont === normalizeInterfaceFont(settings.interface_font)) {
      setPendingFont(null)
    }
  }, [pendingFont, settings.interface_font])

  // Public/auth routes do not mount this provider. Avoid carrying one account's font
  // across logout into the next signed-out screen; login reapplies the account setting.
  useEffect(() => () => {
    applyInterfaceFont(document.documentElement, 'default')
  }, [])

  const persist = useCallback((patch: Partial<Pick<AppSettings, 'theme' | 'interface_font'>>) => {
    // Queue writes so rapid taps can never land out of order in IndexedDB or the sync queue.
    const write = writeQueue.current.then(async () => {
      setSaving(true)
      try {
        await upsert('app_settings', { ...settingsRef.current, ...patch, updated_at: new Date().toISOString() })
        return true
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Could not save that preference. Try again.', 'error')
        return false
      } finally {
        setSaving(false)
      }
    })
    writeQueue.current = write.then(() => undefined)
    return write
  }, [notify, upsert])

  const setTheme = useCallback((next: ThemeMode) => {
    void persist({ theme: next })
  }, [persist])
  const setInterfaceFont = useCallback((next: InterfaceFont) => {
    const font = normalizeInterfaceFont(next)
    setPendingFont(font)
    void persist({ interface_font: font }).then(saved => {
      if (!saved) setPendingFont(current => current === font ? null : current)
    })
  }, [persist])

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
