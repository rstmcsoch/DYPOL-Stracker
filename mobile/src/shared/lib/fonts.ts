import { READING_FONTS, type ReadingFont } from '../types/index.js'

/**
 * Registry for account-scoped reading fonts. Identity typography is intentionally
 * excluded: Patrick Hand is a fixed design role, never an option in Settings.
 * Font files are self-hosted under /assets/fonts/ and declared in fonts.css.
 */
export interface ReadingFontOption {
  value: ReadingFont
  label: string
  description: string
  /** Locally bundled family stack; also used by the Settings font previews. */
  stack: string
  /** Optical size compensation applied to content typography only. */
  scale: number
}

const FALLBACK_STACK = "'Trebuchet MS', system-ui, sans-serif"
const PATRICK_HAND_STACK = "'Patrick Hand', 'Segoe Print', 'Bradley Hand', cursive"

export const READING_FONT_OPTIONS: readonly ReadingFontOption[] = [
  {
    value: 'default',
    label: 'Lexend',
    description: 'Lexend — a clear, readable font for your study sessions.',
    stack: `'Lexend', ${FALLBACK_STACK}`,
    scale: 1.00
  },
  {
    value: 'poppins',
    label: 'Poppins',
    description: 'Rounded letterforms with a friendly rhythm.',
    stack: `'Poppins', ${FALLBACK_STACK}`,
    scale: 0.95
  },
  {
    value: 'sora',
    label: 'Sora',
    description: 'Geometric shapes for a crisp, modern reading feel.',
    stack: `'Sora', ${FALLBACK_STACK}`,
    scale: 0.97
  },
  {
    value: 'open-sans',
    label: 'Open Sans',
    description: 'A familiar, neutral font for long study sessions and formulas.',
    stack: `'Open Sans', ${FALLBACK_STACK}`,
    scale: 1.00
  }
]

/** Public pages never consult account preferences. */
export const PUBLIC_FONT_STACK = PATRICK_HAND_STACK

/** Resolve old/missing/invalid saved values to the Lexend default. */
export function normalizeReadingFont(value: unknown): ReadingFont {
  return typeof value === 'string' && (READING_FONTS as readonly string[]).includes(value)
    ? value as ReadingFont
    : 'default'
}

export function readingFontOption(font: ReadingFont): ReadingFontOption {
  return READING_FONT_OPTIONS.find(option => option.value === normalizeReadingFont(font)) ?? READING_FONT_OPTIONS[0]!
}

/** Apply only the user-selectable content family and its optical scale. */
export function applyReadingFont(root: HTMLElement, font: ReadingFont): void {
  const option = readingFontOption(font)
  root.style.setProperty('--reading-font-family', option.stack)
  root.style.setProperty('--body-scale', option.scale.toFixed(2))
}

/** Clear transient document state on sign-out so no account preference can leak. */
export function clearReadingFont(root: HTMLElement): void {
  root.style.removeProperty('--reading-font-family')
  root.style.removeProperty('--body-scale')
}
