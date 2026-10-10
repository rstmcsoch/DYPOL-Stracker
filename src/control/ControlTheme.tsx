/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import {
  CONTROL_THEME_OPTIONS, CONTROL_THEME_STORAGE_KEY, normalizeControlTheme, readControlThemePreference,
  resolveControlTheme, systemPrefersDark, writeControlThemePreference,
  type ControlThemePreference, type ResolvedControlTheme
} from '../lib/control-theme'

interface ControlThemeValue {
  preference: ControlThemePreference
  resolved: ResolvedControlTheme
  setPreference: (next: ControlThemePreference) => void
}

const ControlThemeContext = createContext<ControlThemeValue | null>(null)

/** Tracks the device setting so "System" follows changes while the console is open. */
function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return prefersDark
}

/**
 * Owns the Control Center's own light/dark/system preference. The preference is read
 * synchronously on the first render, so the console never paints in the wrong mode. The
 * wrapper element carries `data-cc-theme`, which the stylesheet uses for every token; the
 * public site and the notebook never receive this attribute.
 */
export function ControlThemeRoot({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ControlThemePreference>(readControlThemePreference)
  const prefersDark = useSystemPrefersDark()
  const resolved = resolveControlTheme(preference, prefersDark)

  const setPreference = useCallback((next: ControlThemePreference) => {
    const normalized = normalizeControlTheme(next)
    writeControlThemePreference(normalized)
    setPreferenceState(normalized)
  }, [])

  // Keep several open consoles in step without a reload.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === CONTROL_THEME_STORAGE_KEY) setPreferenceState(normalizeControlTheme(event.newValue))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const value = useMemo<ControlThemeValue>(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference])

  return <ControlThemeContext.Provider value={value}>
    <div className="cc-root" data-cc-theme={resolved} data-cc-theme-preference={preference}>
      {children}
    </div>
  </ControlThemeContext.Provider>
}

export function useControlTheme(): ControlThemeValue {
  const value = useContext(ControlThemeContext)
  if (!value) throw new Error('useControlTheme must be used inside ControlThemeRoot')
  return value
}

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const

/**
 * Light / Dark / System switch for the top bar. A radio group: arrow keys move and select,
 * Tab leaves the group, and each option keeps a visible text label on wide screens and an
 * accessible name everywhere.
 */
export function ControlThemeSwitch() {
  const { preference, resolved, setPreference } = useControlTheme()

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = CONTROL_THEME_OPTIONS.length
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % count
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + count) % count
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = count - 1
    if (next === null) return
    event.preventDefault()
    const option = CONTROL_THEME_OPTIONS[next]
    if (!option) return
    setPreference(option.value)
    document.getElementById(`cc-theme-${option.value}`)?.focus()
  }

  return <div className="cc-theme-switch" role="radiogroup" aria-label="Control Center appearance">
    {CONTROL_THEME_OPTIONS.map((option, index) => {
      const Icon = ICONS[option.value]
      const checked = preference === option.value
      const detail = option.value === 'system' ? ` (currently ${resolved === 'dark' ? 'dark' : 'light'})` : ''
      return <button
        key={option.value}
        id={`cc-theme-${option.value}`}
        type="button"
        role="radio"
        aria-checked={checked}
        aria-label={`${option.label} theme${detail}`}
        title={`${option.description}${detail}`}
        tabIndex={checked ? 0 : -1}
        className={`cc-theme-switch__option${checked ? ' is-checked' : ''}`}
        onClick={() => setPreference(option.value)}
        onKeyDown={event => onKeyDown(event, index)}
      >
        <Icon size={15} aria-hidden="true" />
        <span className="cc-theme-switch__label">{option.label}</span>
      </button>
    })}
  </div>
}
