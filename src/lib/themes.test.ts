import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { COLOR_THEMES, type ColorTheme } from '../types/index.js'
import { COLOR_THEME_OPTIONS, normalizeColorTheme } from './themes.js'
import { defaultSettings, normalizeSettings } from './defaults.js'
import { settingsSchema } from './settings-validation.js'

const USER = '00000000-0000-4000-8000-000000000001'

/* ------------------------------------------------------------- WCAG math */

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map(char => char + char).join('') : value
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

type Palette = Record<string, string>

function blocks(css: string, selectorPattern: RegExp): Map<string, Palette> {
  const found = new Map<string, Palette>()
  for (const match of css.matchAll(selectorPattern)) {
    const name = match[1]!
    const body = match[2]!
    const palette: Palette = {}
    for (const token of body.matchAll(/--([a-zA-Z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})/g)) {
      palette[token[1]!] = token[2]!
    }
    found.set(name, palette)
  }
  return found
}

function checkPalette(label: string, palette: Palette): string[] {
  const problems: string[] = []
  const need = (fg: string | undefined, bg: string | undefined, ratio: number, name: string) => {
    if (!fg || !bg) { problems.push(`${label}: missing ${name}`); return }
    const actual = contrast(fg, bg)
    if (actual < ratio) problems.push(`${label}: ${name} ${actual.toFixed(2)}:1 < ${ratio}:1 (${fg} on ${bg})`)
  }
  need(palette.ink, palette.paper, 7, 'ink on paper')
  need(palette.ink, palette.bg, 7, 'ink on background')
  need(palette.muted, palette.paper, 4.5, 'muted on paper')
  need(palette['text-muted'] ?? palette.muted, palette.paper, 4.5, 'text-muted on paper')
  need(palette['ink-soft'], palette.paper, 4.5, 'ink-soft on paper')
  for (const subject of ['physics', 'chemistry', 'maths']) {
    need(palette[`subject-${subject}`], palette[`subject-${subject}-bg`], 4.5, `${subject} on its tint`)
  }
  need(palette.red, palette['red-bg'], 4.5, 'red on red-bg')
  need(palette.green, palette['green-bg'], 4.5, 'green on green-bg')
  need(palette.orange, palette['orange-bg'], 4.5, 'orange on orange-bg')
  need(palette['accent-dark'], palette['accent-light'], 4.5, 'accent-dark on accent-light')
  return problems
}

describe('colour theme registry', () => {
  it('ships exactly the nine palettes in the required order', () => {
    expect([...COLOR_THEMES]).toEqual([
      'default', 'sunset-blaze', 'forest-emerald', 'sandalwood', 'ocean-deep',
      'sakura-blossom', 'dracula-midnight', 'lavender-mist', 'cyberpunk-neon'
    ])
    expect(COLOR_THEME_OPTIONS.map(option => option.value)).toEqual([...COLOR_THEMES])
    for (const option of COLOR_THEME_OPTIONS) {
      expect(option.light).toHaveLength(3)
      expect(option.dark).toHaveLength(3)
    }
  })

  it('resolves unknown or missing saved values to the Default palette', () => {
    expect(normalizeColorTheme(undefined)).toBe('default')
    expect(normalizeColorTheme('neon')).toBe('default')
    expect(normalizeColorTheme('ocean-deep')).toBe('ocean-deep')
    const legacy = normalizeSettings({ id: USER, user_id: USER } as Record<string, unknown>, USER)
    expect(legacy.color_theme).toBe('default')
    const invalid = normalizeSettings({ id: USER, color_theme: 'sparkle' } as Record<string, unknown>, USER)
    expect(invalid.color_theme).toBe('default')
    expect(defaultSettings(USER).color_theme).toBe('default')
  })

  it('validates legacy settings rows without the column and rejects bad ids', () => {
    const base = { ...defaultSettings(USER) }
    delete (base as Partial<Record<string, unknown>>).color_theme
    const parsed = settingsSchema.safeParse(base)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.color_theme).toBe('default')
    expect(settingsSchema.safeParse({ ...defaultSettings(USER), color_theme: 'nope' }).success).toBe(false)
  })
})

describe('theme palettes meet WCAG contrast in both modes', () => {
  const themesCss = readFileSync(`${process.cwd()}/src/styles/themes.css`, 'utf8')
  const baseCss = readFileSync(`${process.cwd()}/src/styles/base.css`, 'utf8')

  const lights = blocks(themesCss, /:root\[data-color='([^']+)'\]\s*(?!\[data-theme)\s*{([^}]*)}/g)
  const darks = blocks(themesCss, /:root\[data-color='([^']+)'\]\[data-theme='dark'\]\s*{([^}]*)}/g)
  const defaultLight = blocks(baseCss, /^(:root)\s*{([^]*?)}/gm)
  const defaultDark = blocks(baseCss, /(:root\[data-theme='dark'\])\s*{([^]*?)}/g)

  it('every custom theme defines light and dark core palettes', () => {
    for (const theme of COLOR_THEMES) {
      if (theme === 'default') continue
      expect(lights.has(theme), `${theme} light palette`).toBe(true)
      expect(darks.has(theme), `${theme} dark palette`).toBe(true)
    }
  })

  it('all light palettes pass text contrast', () => {
    const problems: string[] = []
    problems.push(...checkPalette('default·light', defaultLight.get(':root') ?? {}))
    for (const [name, palette] of lights) problems.push(...checkPalette(`${name}·light`, palette))
    expect(problems).toEqual([])
  })

  it('all dark palettes pass text contrast', () => {
    const problems: string[] = []
    problems.push(...checkPalette('default·dark', defaultDark.get(":root[data-theme='dark']") ?? {}))
    for (const [name, palette] of darks) problems.push(...checkPalette(`${name}·dark`, palette))
    expect(problems).toEqual([])
  })
})

describe('semantic token ownership (no accidental fixed surfaces)', () => {
  const baseCss = readFileSync(`${process.cwd()}/src/styles/base.css`, 'utf8')

  it('hero, tip, cool and subject cards consume theme tokens', () => {
    expect(baseCss).toContain('background-color: var(--surface-warm)')
    expect(baseCss).toContain('background-color: var(--surface-tip)')
    expect(baseCss).toContain('background-color: var(--surface-cool)')
    expect(baseCss).toContain('background-color: var(--subject-physics-bg)')
    expect(baseCss).toContain('background-color: var(--subject-chemistry-bg)')
    expect(baseCss).toContain('background-color: var(--subject-maths-bg)')
    // The old cream/pastel literals are gone from the app shell.
    for (const literal of ['#f1ead9', '#fbf1e1', '#fbf6e7', '#eef3f7', '#eff3f9', '#fbf2e6']) {
      expect(baseCss).not.toContain(literal)
    }
  })

  it('focus mode follows the theme tokens in both modes', () => {
    expect(baseCss).toContain('background: radial-gradient(ellipse at 50% 34%, var(--focus-bg-a) 0, var(--focus-bg-b) 48%, var(--focus-bg-c) 100%)')
    expect(baseCss).toContain('--focus-bg-a: #eef4e9')
    expect(baseCss).toContain("--focus-bg-a: #303f33")
  })

  it('floating controls keep clearance below page content', () => {
    expect(baseCss).toContain('padding: 27px 0 calc(96px + var(--safe-bottom))')
  })

  it('notifications never cover the top-right mode switch and collapse when empty', () => {
    expect(baseCss).toContain('.toast-stack { position: fixed; left: 16px; bottom: calc(16px + var(--safe-bottom))')
    expect(baseCss).toContain('.toast-stack:empty { display: none; }')
  })

  it('priority labels share the soft pill system', () => {
    expect(baseCss).toContain('.label-medium, .priority-indicator.priority-medium { color: var(--score-okay-fg); background: var(--score-okay-bg);')
  })

  it('the focus timer fills its ring instead of the small display role', () => {
    const typography = readFileSync(`${process.cwd()}/src/styles/typography.css`, 'utf8')
    expect(typography).toContain('clamp(56px, 27cqw, 108px)')
  })

  it('themes.css defines both mode blocks for every custom palette', () => {
    const themesCss = readFileSync(`${process.cwd()}/src/styles/themes.css`, 'utf8')
    for (const theme of COLOR_THEMES) {
      if (theme === 'default') continue
      expect(themesCss).toContain(`:root[data-color='${theme}'] {`)
      expect(themesCss).toContain(`:root[data-color='${theme}'][data-theme='dark'] {`)
    }
  })
})

export type { ColorTheme }
