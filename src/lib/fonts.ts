import { INTERFACE_FONTS, type InterfaceFont } from '../types/index.js'

/**
 * Interface font registry.
 *
 * Stracker ships one default cut of each supported family (see the @fontsource imports in
 * main.tsx). The `stack` mirrors the CSS custom property applied through
 * `:root[data-font='…']`, so the Settings preview and the painted UI always agree.
 * Keep this list in step with `INTERFACE_FONTS` and with `src/styles/base.css`.
 */
export interface InterfaceFontOption {
  value: InterfaceFont
  label: string
  note: string
  /** Fallback chain used when the family is still loading or cannot be fetched. */
  stack: string
}

const FALLBACK_STACK = "'Trebuchet MS', system-ui, sans-serif"

export const INTERFACE_FONT_OPTIONS: readonly InterfaceFontOption[] = [
  { value: 'default', label: 'Default', note: 'Poppins text · handwriting headings', stack: `'Poppins', 'Open Sans', ${FALLBACK_STACK}` },
  { value: 'poppins', label: 'Poppins', note: 'Rounded geometric sans', stack: `'Poppins', ${FALLBACK_STACK}` },
  { value: 'sora', label: 'Sora', note: 'Compact technical sans', stack: `'Sora', ${FALLBACK_STACK}` },
  { value: 'open-sans', label: 'Open Sans', note: 'Neutral and highly readable', stack: `'Open Sans', ${FALLBACK_STACK}` }
]

/**
 * Coerce anything that may arrive from IndexedDB, Supabase, or an older backup into a
 * supported font. Rows saved before this preference existed resolve to the default cut,
 * so no migration step or error state is required for existing accounts.
 */
export function normalizeInterfaceFont(value: unknown): InterfaceFont {
  return typeof value === 'string' && (INTERFACE_FONTS as readonly string[]).includes(value)
    ? value as InterfaceFont
    : 'default'
}

export function interfaceFontOption(font: InterfaceFont): InterfaceFontOption {
  return INTERFACE_FONT_OPTIONS.find(option => option.value === font) ?? INTERFACE_FONT_OPTIONS[0]!
}
