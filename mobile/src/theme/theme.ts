import type { TextStyle, ViewStyle } from 'react-native'
import type { ColorThemeId } from './design-tokens.generated'
import { DESIGN_TOKENS } from './design-tokens.generated'
import type { ReadingFont } from '../shared/types'
import { READING_FONT_OPTIONS } from '../shared/lib/fonts'
import { IDENTITY_FONT, READING_FAMILIES } from './fonts'

export type ThemeAppearance = 'light' | 'dark'

/**
 * Semantic colours used by the components. Each value is read from the generated website tokens for
 * the active display mode and palette, so every screen matches the website for all nine themes.
 */
const COLOR_TOKENS = {
  bg: 'bg',
  paper: 'paper',
  paperSoft: 'paper-soft',
  paperMuted: 'paper-muted',
  ink: 'ink',
  inkSoft: 'ink-soft',
  muted: 'muted',
  line: 'line',
  lineStrong: 'line-strong',
  accent: 'accent',
  accentDark: 'accent-dark',
  accentLight: 'accent-light',
  textMuted: 'text-muted',
  textAccent: 'text-accent',
  subjectPhysics: 'subject-physics',
  subjectChemistry: 'subject-chemistry',
  subjectMaths: 'subject-maths',
  subjectPhysicsBg: 'subject-physics-bg',
  subjectChemistryBg: 'subject-chemistry-bg',
  subjectMathsBg: 'subject-maths-bg',
  red: 'red',
  redBg: 'red-bg',
  green: 'green',
  greenBg: 'green-bg',
  orange: 'orange',
  orangeBg: 'orange-bg',
  blueBg: 'blue-bg',
  yellowBg: 'yellow-bg',
  chartGrid: 'chart-grid',
  ringTrack: 'ring-track',
  focusAccent: 'focus-accent',
  tintWarm: 'tint-warm',
  tintCool: 'tint-cool',
  tintTip: 'tint-tip',
  surfaceWarm: 'surface-warm',
  surfaceWarmBorder: 'surface-warm-border',
  surfaceWarmInk: 'surface-warm-ink',
  surfaceWarmStrong: 'surface-warm-strong',
  surfaceWarmMuted: 'surface-warm-muted',
  surfaceCool: 'surface-cool',
  surfaceCoolBorder: 'surface-cool-border',
  surfaceCoolInk: 'surface-cool-ink',
  surfaceCoolMuted: 'surface-cool-muted',
  surfaceCoolAccent: 'surface-cool-accent',
  surfaceCoolAccentBg: 'surface-cool-accent-bg',
  surfaceTip: 'surface-tip',
  surfaceTipBorder: 'surface-tip-border',
  surfaceTipInk: 'surface-tip-ink',
  surfaceTipMuted: 'surface-tip-muted',
  surfaceTipAccent: 'surface-tip-accent',
  surfaceTipAccentBg: 'surface-tip-accent-bg',
  scoreWeakFg: 'score-weak-fg',
  scoreWeakBg: 'score-weak-bg',
  scoreOkayFg: 'score-okay-fg',
  scoreOkayBg: 'score-okay-bg',
  scoreStrongFg: 'score-strong-fg',
  scoreStrongBg: 'score-strong-bg',
  fabBg: 'fab-bg',
  fabBorder: 'fab-border',
  fabInk: 'fab-ink',
  buttonPrimaryBg: 'button-primary-bg',
  buttonPrimaryBorder: 'button-primary-border',
  buttonPrimaryInk: 'button-primary-ink',
  buttonPrimaryShadow: 'button-primary-shadow',
  buttonPrimaryHover: 'button-primary-hover',
  buttonDangerBg: 'button-danger-bg',
  buttonDangerBorder: 'button-danger-border',
  buttonDangerInk: 'button-danger-ink',
  buttonDangerShadow: 'button-danger-shadow',
  buttonDangerHover: 'button-danger-hover',
  heatNone: 'heat-none',
  heatLow: 'heat-low',
  heatMedium: 'heat-medium',
  heatHigh: 'heat-high',
  heatGoal: 'heat-goal',
  heatBorder: 'heat-border',
  focusBgA: 'focus-bg-a',
  focusBgB: 'focus-bg-b',
  focusBgC: 'focus-bg-c',
  focusInk: 'focus-ink',
  focusSoft: 'focus-soft',
  focusMuted: 'focus-muted',
  focusFaint: 'focus-faint',
  focusLine: 'focus-line',
  focusPanel: 'focus-panel',
  focusPanelLine: 'focus-panel-line',
  focusControlBg: 'focus-control-bg',
  focusControlBorder: 'focus-control-border',
  focusControlInk: 'focus-control-ink',
  focusControlMuted: 'focus-control-muted',
  focusSelectedBg: 'focus-selected-bg',
  focusSelectedBorder: 'focus-selected-border',
  focusSelectedInk: 'focus-selected-ink',
  focusCaption: 'focus-caption',
  focusOrbit: 'focus-orbit',
  focusStar: 'focus-star',
  shadowColor: 'shadow'
} as const

export type Palette = { [K in keyof typeof COLOR_TOKENS]: string }

export interface AppTheme {
  appearance: ThemeAppearance
  colorTheme: ColorThemeId
  reading: ReadingFont
  isDark: boolean
  colors: Palette
  fonts: {
    identity: string
    body: string
    bodyMedium: string
    bodySemibold: string
    bodyBold: string
    /** Optical size compensation for reading text (1 for Lexend, 0.95 for Poppins, …). */
    bodyScale: number
  }
  radius: { card: number; button: number; input: number; pill: number }
  shadow: { card: ViewStyle; float: ViewStyle }
  type: {
    brand: TextStyle
    display: TextStyle
    h1: TextStyle
    h2: TextStyle
    h3: TextStyle
    metric: TextStyle
    body: TextStyle
    caption: TextStyle
    overline: TextStyle
    label: TextStyle
    button: TextStyle
    badge: TextStyle
  }
}

export function resolvePalette(appearance: ThemeAppearance, colorTheme: ColorThemeId): Palette {
  const tokens = DESIGN_TOKENS[appearance][colorTheme]
  const palette = {} as Record<keyof typeof COLOR_TOKENS, string>
  for (const [key, token] of Object.entries(COLOR_TOKENS) as [keyof typeof COLOR_TOKENS, string][]) {
    palette[key] = tokens[token as keyof typeof tokens]
  }
  return palette as Palette
}

export function buildTheme(appearance: ThemeAppearance, colorTheme: ColorThemeId, reading: ReadingFont): AppTheme {
  const colors = resolvePalette(appearance, colorTheme)
  const family = READING_FAMILIES[reading]
  const scale = READING_FONT_OPTIONS.find(option => option.value === reading)?.scale ?? 1
  const isDark = appearance === 'dark'
  const bodySize = (size: number) => Math.round(size * scale * 10) / 10
  return {
    appearance,
    colorTheme,
    reading,
    isDark,
    colors,
    fonts: {
      identity: IDENTITY_FONT,
      body: family.regular,
      bodyMedium: family.medium,
      bodySemibold: family.semibold,
      bodyBold: family.bold,
      bodyScale: scale
    },
    radius: { card: 15, button: 10, input: 10, pill: 999 },
    shadow: {
      card: {
        shadowColor: isDark ? '#000000' : '#493f2b',
        shadowOffset: { width: 0, height: isDark ? 9 : 8 },
        shadowOpacity: isDark ? 0.22 : 0.1,
        shadowRadius: isDark ? 16 : 14,
        elevation: isDark ? 4 : 3
      },
      float: {
        shadowColor: isDark ? '#000000' : '#29332d',
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: isDark ? 0.4 : 0.22,
        shadowRadius: 22,
        elevation: 8
      }
    },
    type: {
      brand: { fontFamily: IDENTITY_FONT, fontSize: 28, lineHeight: 28 },
      display: { fontFamily: IDENTITY_FONT, fontSize: 36, lineHeight: 38 },
      h1: { fontFamily: IDENTITY_FONT, fontSize: 34, lineHeight: 36, letterSpacing: -0.5 },
      h2: { fontFamily: IDENTITY_FONT, fontSize: 24, lineHeight: 27 },
      h3: { fontFamily: IDENTITY_FONT, fontSize: 20, lineHeight: 23 },
      metric: { fontFamily: IDENTITY_FONT, fontSize: 32, lineHeight: 34 },
      body: { fontFamily: family.regular, fontSize: bodySize(16), lineHeight: bodySize(16) * 1.45 },
      caption: { fontFamily: family.regular, fontSize: bodySize(14), lineHeight: bodySize(14) * 1.35 },
      overline: { fontFamily: family.bold, fontSize: 13, lineHeight: 18, letterSpacing: 1.35, textTransform: 'uppercase' },
      label: { fontFamily: family.semibold, fontSize: bodySize(13.5), lineHeight: bodySize(13.5) * 1.25 },
      button: { fontFamily: family.semibold, fontSize: bodySize(15), lineHeight: 18 },
      badge: { fontFamily: family.semibold, fontSize: 12, lineHeight: 15 }
    }
  }
}

/** Subject → (text colour, soft background), matching the website's subject badges. */
export function subjectColors(theme: AppTheme, subject: string | null | undefined): { fg: string; bg: string } {
  switch (subject) {
    case 'Physics': return { fg: theme.colors.subjectPhysics, bg: theme.colors.subjectPhysicsBg }
    case 'Chemistry': return { fg: theme.colors.subjectChemistry, bg: theme.colors.subjectChemistryBg }
    case 'Maths': return { fg: theme.colors.subjectMaths, bg: theme.colors.subjectMathsBg }
    default: return { fg: theme.colors.inkSoft, bg: theme.colors.paperMuted }
  }
}
