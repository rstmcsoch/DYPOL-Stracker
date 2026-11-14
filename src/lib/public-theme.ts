import { useEffect, useState, type CSSProperties } from 'react'
import type { PublicTheme } from '../components/public/PublicHeader'
import { COLOR_THEME_OPTIONS } from './themes'

/**
 * Public-site theme shared by the homepage and the public information pages (Privacy, Terms,
 * About, Contact), so the visitor's light/night choice, the owner's accent and the owner's
 * font carry across every public page.
 */
export const PUBLIC_THEME_STORAGE_KEY = 'stracker-public-home-theme'

/** The visitor's own saved choice, or null when they never used the toggle. */
function readStoredPublicTheme(): PublicTheme | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(PUBLIC_THEME_STORAGE_KEY)
    return stored === 'dark' || stored === 'light' ? stored : null
  } catch {
    return null
  }
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Owner default (public.appearance.default_mode) applies only until the visitor chooses. */
export function usePublicTheme(defaultMode: string): [PublicTheme, () => void] {
  const [stored, setStored] = useState<PublicTheme | null>(readStoredPublicTheme)
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark)
  useEffect(() => {
    if (defaultMode !== 'system' || typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [defaultMode])
  const fallback: PublicTheme = defaultMode === 'dark' || (defaultMode === 'system' && systemDark) ? 'dark' : 'light'
  const theme = stored ?? fallback
  const toggle = () => {
    const next: PublicTheme = theme === 'dark' ? 'light' : 'dark'
    try {
      window.localStorage.setItem(PUBLIC_THEME_STORAGE_KEY, next)
    } catch {
      // The in-memory toggle still works when storage is unavailable.
    }
    setStored(next)
  }
  return [theme, toggle]
}

/** Inline custom properties for a non-default accent preset; undefined keeps the stylesheet values. */
export function accentStyle(accent: string): CSSProperties | undefined {
  if (accent === 'default') return undefined
  const option = COLOR_THEME_OPTIONS.find(item => item.value === accent)
  if (!option) return undefined
  return { '--owner-accent-light': option.light[1], '--owner-accent-dark': option.dark[1] } as CSSProperties
}

