import { INTERFACE_FONTS, type InterfaceFont } from '../types/index.js'

/**
 * Registry for the one application-wide interface font.
 *
 * `stack` is the canonical mapping from the persisted preference to
 * `--app-font-family`. AppearanceContext applies it once to `<html>`; every semantic
 * typography token in base.css aliases that variable, so components inherit the same
 * family instead of maintaining their own choices. Families are bundled locally in
 * main.tsx with font-display: swap and each stack ends in a system fallback.
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
  { value: 'default', label: 'Default', note: 'Balanced and familiar sans', stack: `'Poppins', 'Open Sans', ${FALLBACK_STACK}` },
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

/** Apply the selected stack at the document boundary, never on individual components. */
export function applyInterfaceFont(root: HTMLElement, font: InterfaceFont): void {
  const option = interfaceFontOption(font)
  root.style.setProperty('--app-font-family', option.stack)
}
