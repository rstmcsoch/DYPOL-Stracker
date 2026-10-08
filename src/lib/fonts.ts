import { INTERFACE_FONTS, type InterfaceFont } from '../types/index.js'

/**
 * Registry for the one application-wide interface font.
 *
 * `stack` is the canonical mapping from the persisted preference to
 * `--app-font-family`. AppearanceContext applies it once to `<html>`; every semantic
 * typography token in base.css aliases that variable, so components inherit the same
 * family instead of maintaining their own choices. Families are self-hosted as subset
 * WOFF2 files in src/styles/fonts.css (served from /assets/fonts/ with font-display:
 * swap) and each stack ends in a system fallback.
 */
export interface InterfaceFontOption {
  value: InterfaceFont
  label: string
  note: string
  /** Fallback chain used when the family is still loading or cannot be fetched. */
  stack: string
}

/** The Default cut renders with the platform's own UI font: no webfont download at all. */
const NATIVE_STACK = 'system-ui, sans-serif'

const FALLBACK_STACK = "'Trebuchet MS', system-ui, sans-serif"

export const INTERFACE_FONT_OPTIONS: readonly InterfaceFontOption[] = [
  { value: 'default', label: 'Default', note: "Your device's own font — nothing to download", stack: NATIVE_STACK },
  { value: 'poppins', label: 'Poppins', note: 'Rounded geometric sans', stack: `'Poppins', ${FALLBACK_STACK}` },
  { value: 'sora', label: 'Sora', note: 'Compact technical sans', stack: `'Sora', ${FALLBACK_STACK}` },
  { value: 'open-sans', label: 'Open Sans', note: 'Neutral and readable; covers Greek letters, ₹ and maths symbols', stack: `'Open Sans', ${FALLBACK_STACK}` }
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

/**
 * Device-level cache of the interface font. The boot script in index.html reads it
 * before React mounts so a returning reader never sees the default family flash;
 * AppearanceContext keeps it in sync with the resolved account preference. The cache
 * is per device (the boot script runs before sign-in) and is cleared on logout.
 */
export const INTERFACE_FONT_STORAGE_KEY = 'stracker-interface-font'

export function cacheInterfaceFont(font: InterfaceFont): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(INTERFACE_FONT_STORAGE_KEY, font)
  } catch { /* a blocked store must never break appearance */ }
}

export function clearInterfaceFontCache(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(INTERFACE_FONT_STORAGE_KEY)
  } catch { /* a blocked store must never break appearance */ }
}
