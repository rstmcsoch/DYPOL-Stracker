/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { useData } from './DataContext'
import { useToast } from './ToastContext'
import { applyInterfaceFont, normalizeInterfaceFont } from '../lib/fonts'
import type { InterfaceFont, ThemeMode } from '../types'

export type ResolvedTheme = 'light' | 'dark'

interface AppearanceContextValue {
  /** Stored preference, including `auto`. */
  theme: ThemeMode
  /** What the UI is actually rendering right now. */
  resolvedTheme: ResolvedTheme
  isDark: boolean
  /** The font being rendered: an active Settings preview when one exists, otherwise the saved choice. */
  interfaceFont: InterfaceFont
  /** Header quick switch. Persists the theme immediately through the shared settings writer. */
  setTheme: (theme: ThemeMode) => void
  /** Runtime-only font preview, driven by the Settings draft. Never persists anything. */
  previewInterfaceFont: (font: InterfaceFont | null) => void
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
 * Runtime appearance state for the signed-in shell. It resolves what to render and applies it;
 * it does not own the Settings draft or decide what gets saved.
 *
 *  · `app_settings` (via DataContext) is the persisted source of truth.
 *  · A font preview is an in-memory override that the Settings draft sets while mounted.
 *  · `data-theme` drives the palette. The rendered font is applied once to `<html>` as
 *    `--app-font-family`, and every typography role and native control inherits it.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { data, updateSettings } = useData()
  const { notify } = useToast()
  const systemPrefersDark = useSystemPrefersDark()
  const [fontPreview, setFontPreview] = useState<InterfaceFont | null>(null)

  const settings = data.settings
  const theme = settings.theme
  const resolvedTheme: ResolvedTheme = theme === 'auto' ? (systemPrefersDark ? 'dark' : 'light') : theme
  const interfaceFont = fontPreview ?? normalizeInterfaceFont(settings.interface_font)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolvedTheme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR)
  }, [resolvedTheme])

  useLayoutEffect(() => {
    applyInterfaceFont(document.documentElement, interfaceFont)
  }, [interfaceFont])

  // Public and auth routes do not mount this provider. Reset in the layout phase so no account's
  // font survives logout into the next screen; login reapplies that account's saved choice.
  useLayoutEffect(() => () => {
    applyInterfaceFont(document.documentElement, 'default')
  }, [])

  const setTheme = useCallback((next: ThemeMode) => {
    // Only the theme field is part of this write; the writer merges it into the latest row.
    updateSettings(current => ({ ...current, theme: next })).catch(error => {
      notify(error instanceof Error ? error.message : 'Could not save that preference. Try again.', 'error')
    })
  }, [notify, updateSettings])

  const value = useMemo<AppearanceContextValue>(() => ({
    theme, resolvedTheme, isDark: resolvedTheme === 'dark', interfaceFont, setTheme, previewInterfaceFont: setFontPreview
  }), [theme, resolvedTheme, interfaceFont, setTheme])

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext)
  if (!context) throw new Error('useAppearance must be used inside AppearanceProvider')
  return context
}

/**
 * Previews `font` across the whole app while the calling component is mounted.
 *
 * Settings passes its unsaved Appearance draft here, so the preview follows the user's choice.
 * Unmounting clears the preview, which means leaving Settings without saving reverts to the
 * saved font. Previewing never writes; only the Settings Save action persists the choice.
 */
export function useInterfaceFontPreview(font: InterfaceFont): void {
  const { previewInterfaceFont } = useAppearance()
  useLayoutEffect(() => {
    previewInterfaceFont(font)
    return () => previewInterfaceFont(null)
  }, [font, previewInterfaceFont])
}
