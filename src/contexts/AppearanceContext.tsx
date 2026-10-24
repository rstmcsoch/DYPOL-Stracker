/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { useData } from './DataContext'
import { useToast } from './ToastContext'
import { applyReadingFont, clearReadingFont, normalizeReadingFont } from '../lib/fonts'
import { normalizeColorTheme } from '../lib/themes'
import type { ColorTheme, ReadingFont, ThemeMode } from '../types'

export type ResolvedTheme = 'light' | 'dark'
export interface AppearancePreview { theme: ThemeMode; color_theme: ColorTheme }

interface AppearanceContextValue {
  /** Stored display-mode preference, including `auto`. */
  theme: ThemeMode
  /** What the UI is actually rendering right now. */
  resolvedTheme: ResolvedTheme
  isDark: boolean
  /** Stored colour palette; independent of the display mode. */
  colorTheme: ColorTheme
  /** The Reading font being rendered: an active Settings preview when one exists, otherwise the saved choice. */
  readingFont: ReadingFont
  /** Header quick switch. Persists only the display mode through the shared settings writer. */
  setTheme: (theme: ThemeMode) => void
  /** Persist only the colour palette through the shared settings writer; never touches the display mode. */
  setColorTheme: (colorTheme: ColorTheme) => void
  /** Runtime-only Reading-font preview, driven by the Settings draft. Never persists anything. */
  previewReadingFont: (font: ReadingFont | null) => void
  /** Runtime-only display-mode / palette preview, driven by the Settings draft. Never persists anything. */
  previewAppearance: (preview: AppearancePreview | null) => void
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
 * Runtime appearance state for the signed-in shell. It resolves what to render and applies it;
 * it does not own the Settings draft or decide what gets saved.
 *
 *  · `app_settings` (via DataContext.updateSettings) is the persisted source of truth and the
 *    only settings writer used here: display-mode and colour-palette changes go through it.
 *  · A Reading-font preview is an in-memory override that the Settings draft sets while mounted.
 *    It never persists; unmounting Settings reverts to the saved font.
 *  · Display mode (`data-theme`) and colour palette (`data-color`) are separate attributes, and
 *    neither writer resets the other. The rendered Reading font is applied to `<html>` as
 *    `--reading-font-family` / `--body-scale`; Patrick Hand identity roles stay fixed.
 *  · The public site and public auth routes do not mount this provider and always use their
 *    fixed CSS typography scope.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { data, updateSettings } = useData()
  const { notify } = useToast()
  const systemPrefersDark = useSystemPrefersDark()
  const [fontPreview, setFontPreview] = useState<ReadingFont | null>(null)
  const [appearancePreview, setAppearancePreview] = useState<AppearancePreview | null>(null)
  const [saving, setSaving] = useState(false)

  const settings = data.settings
  // An unsaved Settings draft (if any) wins while Settings is open; otherwise the saved values.
  const theme = appearancePreview?.theme ?? settings.theme
  const colorTheme = normalizeColorTheme(appearancePreview?.color_theme ?? settings.color_theme)
  const resolvedTheme: ResolvedTheme = theme === 'auto' ? (systemPrefersDark ? 'dark' : 'light') : theme
  const readingFont = fontPreview ?? normalizeReadingFont(settings.interface_font)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolvedTheme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR)
  }, [resolvedTheme])

  useEffect(() => {
    const root = document.documentElement
    if (colorTheme === 'default') delete root.dataset.color
    else root.dataset.color = colorTheme
  }, [colorTheme])

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.appFont = 'active'
    applyReadingFont(root, readingFont)
  }, [readingFont])

  // Public and auth routes do not mount this provider. Reset in the layout phase so no account's
  // font or palette survives logout into the next screen; login reapplies that account's values.
  useLayoutEffect(() => () => {
    const root = document.documentElement
    delete root.dataset.appFont
    delete root.dataset.color
    clearReadingFont(root)
  }, [])

  const persistAppearance = useCallback((patch: { theme?: ThemeMode; color_theme?: ColorTheme }) => {
    setSaving(true)
    return updateSettings(current => ({ ...current, ...patch }))
      .catch(error => {
        notify(error instanceof Error ? error.message : 'Could not save that preference. Try again.', 'error')
      })
      .finally(() => setSaving(false))
  }, [notify, updateSettings])

  const setTheme = useCallback((next: ThemeMode) => {
    void persistAppearance({ theme: next })
  }, [persistAppearance])

  const setColorTheme = useCallback((next: ColorTheme) => {
    void persistAppearance({ color_theme: normalizeColorTheme(next) })
  }, [persistAppearance])

  const value = useMemo<AppearanceContextValue>(() => ({
    theme, resolvedTheme, isDark: resolvedTheme === 'dark', colorTheme, readingFont,
    setTheme, setColorTheme, previewReadingFont: setFontPreview, previewAppearance: setAppearancePreview, saving
  }), [theme, resolvedTheme, colorTheme, readingFont, setTheme, setColorTheme, saving])

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
export function useReadingFontPreview(font: ReadingFont): void {
  const { previewReadingFont } = useAppearance()
  useLayoutEffect(() => {
    previewReadingFont(font)
    return () => previewReadingFont(null)
  }, [font, previewReadingFont])
}

/**
 * Previews the display mode and colour palette across the whole app while the calling component
 * is mounted. Settings passes its unsaved draft; unmounting (leaving Settings) clears the preview so
 * the saved appearance returns. Previewing never writes; only the Settings Save action persists.
 */
export function useAppearancePreview(theme: ThemeMode, colorTheme: ColorTheme): void {
  const { previewAppearance } = useAppearance()
  useLayoutEffect(() => {
    previewAppearance({ theme, color_theme: colorTheme })
  }, [theme, colorTheme, previewAppearance])
  useLayoutEffect(() => () => previewAppearance(null), [previewAppearance])
}
