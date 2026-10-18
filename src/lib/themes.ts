import { COLOR_THEMES, type ColorTheme } from '../types/index.js'

/**
 * Registry for the account-scoped colour themes. A theme is a palette only:
 * the light/dark/auto display mode stays a separate setting, and every theme
 * here ships a light and a dark token palette in styles/themes.css keyed by
 * `:root[data-color='…']` / `:root[data-color='…'][data-theme='dark']`.
 *
 * Swatches shown in the Settings picker render the theme's real surface,
 * accent and subject hues for both modes so the preview is honest.
 */
export interface ColorThemeOption {
  value: ColorTheme
  label: string
  description: string
  /** [paper, accent, subject hue] for the light palette. */
  light: [string, string, string]
  /** [paper, accent, subject hue] for the dark palette. */
  dark: [string, string, string]
}

export const COLOR_THEME_OPTIONS: readonly ColorThemeOption[] = [
  {
    value: 'default',
    label: 'Default',
    description: 'The classic Stracker warm paper and chalkboard.',
    light: ['#fffdf7', '#526c9a', '#ca8547'],
    dark: ['#2b312d', '#a9bfdc', '#f0b174']
  },
  {
    value: 'sunset-blaze',
    label: 'Sunset Blaze',
    description: 'Coral, burnt orange and deep plum on calm neutrals.',
    light: ['#fffaf6', '#b4552d', '#a04a63'],
    dark: ['#2f2420', '#f0a273', '#e795ac']
  },
  {
    value: 'forest-emerald',
    label: 'Forest Emerald',
    description: 'Deep emerald and sage for long, calm sessions.',
    light: ['#fbfdfa', '#2e6b4f', '#33628a'],
    dark: ['#222b25', '#7fc49f', '#8fb7e0']
  },
  {
    value: 'sandalwood',
    label: 'Sandalwood',
    description: 'Warm sand, brown and earthy olive accents.',
    light: ['#fffcf6', '#7a5a33', '#96562a'],
    dark: ['#2b241c', '#d3a877', '#e8b478']
  },
  {
    value: 'ocean-deep',
    label: 'Ocean Deep',
    description: 'Navy, teal and controlled aqua. Quiet and premium.',
    light: ['#fbfdfe', '#1f5f8b', '#22766c'],
    dark: ['#1a2833', '#7db6dd', '#6fd0c0']
  },
  {
    value: 'sakura-blossom',
    label: 'Sakura Blossom',
    description: 'Blush, cherry pink and plum with readable ink.',
    light: ['#fffafc', '#b0446e', '#7a4a86'],
    dark: ['#30232b', '#e39ab8', '#cfa3dd']
  },
  {
    value: 'dracula-midnight',
    label: 'Dracula Midnight',
    description: 'The official Dracula palette, adapted for study.',
    light: ['#fcfbff', '#7a4fd6', '#1f6f9e'],
    dark: ['#343746', '#bd93f9', '#8be9fd']
  },
  {
    value: 'lavender-mist',
    label: 'Lavender Mist',
    description: 'Muted lavender, violet and cool indigo accents.',
    light: ['#fdfcff', '#6250a8', '#4a5aa0'],
    dark: ['#272435', '#b1a3e8', '#a3b1f0']
  },
  {
    value: 'cyberpunk-neon',
    label: 'Cyberpunk Neon',
    description: 'Deep indigo surfaces with controlled neon accents.',
    light: ['#fbfcff', '#0f6f8f', '#a03d78'],
    dark: ['#161a2a', '#45d8f0', '#ff5ea8']
  }
]

/** Resolve old/missing/invalid saved values to the Default palette. */
export function normalizeColorTheme(value: unknown): ColorTheme {
  return typeof value === 'string' && (COLOR_THEMES as readonly string[]).includes(value)
    ? value as ColorTheme
    : 'default'
}

export function colorThemeOption(theme: ColorTheme): ColorThemeOption {
  return COLOR_THEME_OPTIONS.find(option => option.value === normalizeColorTheme(theme)) ?? COLOR_THEME_OPTIONS[0]!
}
