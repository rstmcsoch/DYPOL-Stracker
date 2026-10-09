// @vitest-environment jsdom
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  applyReadingFont,
  clearReadingFont,
  normalizeReadingFont,
  PUBLIC_FONT_STACK,
  READING_FONT_OPTIONS,
  readingFontOption
} from './fonts'
import { READING_FONTS } from '../types'

describe('centralized typography registry', () => {
  it('exposes only the supported Reading fonts; Patrick Hand remains an identity role', () => {
    expect(READING_FONTS).toEqual(['default', 'poppins', 'sora', 'open-sans'])
    expect(READING_FONT_OPTIONS.map(option => option.value)).toEqual([...READING_FONTS])
    expect(READING_FONT_OPTIONS.map(option => option.label)).toEqual(['Lexend', 'Poppins', 'Sora', 'Open Sans'])
    expect(READING_FONT_OPTIONS[0]?.description).toBe('Lexend — a clear, readable font for your study sessions.')
    expect(PUBLIC_FONT_STACK).toContain("'Patrick Hand'")
    expect(READING_FONT_OPTIONS.every(option => !option.stack.includes('Patrick Hand') && !option.stack.includes('Caveat'))).toBe(true)
  })

  it('maps every Reading option to its locally bundled family and optical scale', () => {
    expect(readingFontOption('default')).toMatchObject({ stack: expect.stringContaining("'Lexend'"), scale: 1 })
    expect(readingFontOption('poppins')).toMatchObject({ stack: expect.stringContaining("'Poppins'"), scale: 0.95 })
    expect(readingFontOption('sora')).toMatchObject({ stack: expect.stringContaining("'Sora'"), scale: 0.97 })
    expect(readingFontOption('open-sans')).toMatchObject({ stack: expect.stringContaining("'Open Sans'"), scale: 1 })
  })

  it('uses safe Lexend defaults for missing, legacy, and invalid account values', () => {
    for (const value of [undefined, null, '', 'caveat', 'Comic Sans', 'Poppins', "Poppins'; background:url(evil)", { family: 'Sora' }]) {
      expect(normalizeReadingFont(value)).toBe('default')
    }
    for (const value of READING_FONTS) expect(normalizeReadingFont(value)).toBe(value)
  })

  it('applies and clears only the content-family and scale tokens at the document boundary', () => {
    const root = document.createElement('html')
    for (const option of READING_FONT_OPTIONS) {
      applyReadingFont(root, option.value)
      expect(root.style.getPropertyValue('--reading-font-family')).toBe(option.stack)
      expect(root.style.getPropertyValue('--body-scale')).toBe(option.scale.toFixed(2))
    }
    clearReadingFont(root)
    expect(root.style.getPropertyValue('--reading-font-family')).toBe('')
    expect(root.style.getPropertyValue('--body-scale')).toBe('')
  })
})

describe('locally bundled typography faces', () => {
  const fontsCss = readFileSync(`${process.cwd()}/src/styles/fonts.css`, 'utf8')
  const faces = [...fontsCss.matchAll(/@font-face\s*\{[^}]*\}/g)].map(match => match[0])

  it('ships exactly the font subsets declared by CSS with swap and Unicode ranges', () => {
    expect(faces.length).toBe(42)
    const declared: string[] = []
    for (const face of faces) {
      expect(face).toContain('font-display: swap')
      expect(face).toContain('unicode-range:')
      const url = /url\('([^']+)'\)/.exec(face)?.[1]
      expect(url?.startsWith('/assets/fonts/')).toBe(true)
      expect(existsSync(`${process.cwd()}/public${url}`)).toBe(true)
      declared.push(url!.replace('/assets/fonts/', ''))
    }
    expect(declared.sort()).toEqual(readdirSync(`${process.cwd()}/public/assets/fonts`).sort())
  })

  it('uses only Patrick Hand regular while bundling real content weights for each Reading option', () => {
    const patrick = faces.filter(face => face.includes("font-family: 'Patrick Hand'"))
    expect(patrick).toHaveLength(2)
    expect(patrick.every(face => /font-weight:\s*400/.test(face))).toBe(true)
    expect(patrick.some(face => /font-weight:\s*(?:500|600|700)/.test(face))).toBe(false)
    for (const family of ["'Lexend'", "'Poppins'", "'Sora'", "'Open Sans'"]) {
      const familyFaces = faces.filter(face => face.includes(`font-family: ${family}`))
      expect(familyFaces.some(face => /font-weight:\s*400/.test(face))).toBe(true)
      expect(familyFaces.some(face => /font-weight:\s*500/.test(face))).toBe(true)
      expect(familyFaces.some(face => /font-weight:\s*600/.test(face))).toBe(true)
    }
  })

  it('covers extended Latin, Greek and mathematical notation in Open Sans', () => {
    const openSans = faces.filter(face => face.includes("font-family: 'Open Sans'"))
    expect(openSans.some(face => face.includes('U+03A3-03FF'))).toBe(true)
    expect(openSans.some(face => face.includes('U+2216-22FF'))).toBe(true)
    for (const family of ["'Patrick Hand'", "'Lexend'", "'Poppins'", "'Sora'", "'Open Sans'"]) {
      const familyFaces = faces.filter(face => face.includes(`font-family: ${family}`))
      expect(familyFaces.some(face => face.includes('U+0100-02BA'))).toBe(true)
      expect(familyFaces.some(face => face.includes('U+20AD-20C0'))).toBe(true)
    }
  })

  it('keeps the public and authenticated typography layers independent of the saved preference', () => {
    const base = readFileSync(`${process.cwd()}/src/styles/base.css`, 'utf8')
    const typography = readFileSync(`${process.cwd()}/src/styles/typography.css`, 'utf8')
    const settingsPage = readFileSync(`${process.cwd()}/src/pages/SettingsPage.tsx`, 'utf8')
    const html = readFileSync(`${process.cwd()}/index.html`, 'utf8')

    expect(base).toContain("--font-identity: 'Patrick Hand'")
    expect(base).toContain("--font-default-reading: 'Lexend'")
    expect(typography).toContain('.pub-page :where(*)')
    expect(typography).toContain('font-family: var(--font-identity) !important;')
    expect(typography).toContain('.auth-page-public')
    expect(typography).toContain('.auth-page-public h1')
    expect(typography).toContain('.auth-page-public p { font-family: var(--font-default-reading)')
    expect(typography).toContain('.auth-page-public .auth-back')
    expect(typography).toContain('--body-scale: 1;')
    expect(typography).toContain('--font-default-reading')
    expect(settingsPage).toContain('title="Reading font"')
    expect(settingsPage).toContain('Changes body text, menus and buttons. Headings and the Stracker identity stay the same.')
    expect(settingsPage).not.toContain('setInterfaceFont')
    expect(html).toContain('patrick-hand-latin-400-normal.woff2')
    expect(html).toContain('lexend-latin-400-normal.woff2')
    expect(html).not.toContain('localStorage.getItem')
  })
})

describe('role typography coverage', () => {
  const typography = readFileSync(`${process.cwd()}/src/styles/typography.css`, 'utf8')
  const base = readFileSync(`${process.cwd()}/src/styles/base.css`, 'utf8')
  const ui = readFileSync(`${process.cwd()}/src/components/ui.tsx`, 'utf8')
  const shell = readFileSync(`${process.cwd()}/src/components/AppShell.tsx`, 'utf8')
    const toast = readFileSync(`${process.cwd()}/src/contexts/ToastContext.tsx`, 'utf8')
    const authScaffold = readFileSync(`${process.cwd()}/src/components/public/AuthScaffold.tsx`, 'utf8')
    const ai = readFileSync(`${process.cwd()}/src/styles/ai.css`, 'utf8')

  it('keeps fixed identity roles separate from scaled content and readable paragraph floors', () => {
    for (const [role, size] of Object.entries({ brand: '1.75rem', display: '2.25rem', h1: '2rem', h2: '1.5rem', h3: '1.25rem', empty: '1.25rem', metric: '2rem' })) {
      expect(typography).toContain(`--type-${role}-size: ${size}`)
    }
    expect(typography).toContain('font-family: var(--font-identity) !important;')
    expect(typography).toContain('font-weight: 400 !important;')
    expect(typography).toContain('font-size: max(1rem, calc(1rem * var(--body-scale))) !important;')
    expect(typography).toContain('.auth-page-public p')
    expect(typography).toContain('.pub-page p')
    expect(base).toContain('--text-primary: var(--ink);')
    expect(base).toContain(":root[data-theme='dark']")
    expect(base).toContain('--text-muted: #bdc5ba;')
    expect(typography).toContain('@media (max-width: 640px)')
  })

  it('covers forms, navigation, dialogs, portal menus, charts, AI and notifications', () => {
    expect(ui).toContain('type-button')
    expect(ui).toContain('type-input')
    expect(ui).toContain('type-caption')
    expect(ui).toContain('type-alert')
    expect(ui).toContain('className="type-h2"')
    expect(ui).toContain('className="type-body"')
    expect(ui).toContain("role=\"menu\"")
    expect(shell).toContain('type-nav')
    expect(authScaffold).toContain('className="type-display"')
    expect(authScaffold).toContain('className="type-brand"')
    expect(toast).toContain('type-alert')
    expect(typography).toContain("html[data-app-font='active'] button")
    expect(typography).toContain("html[data-app-font='active'] :is(input, select, textarea, option, optgroup)")
    expect(typography).toContain('.recharts-cartesian-axis-tick text')
    expect(typography).toContain('.app-shell .ai-message-body')
    expect(ai).toContain('font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace')
  })

  it('keeps every ordinary stylesheet text size at or above the readable floor', () => {
    // Scaled sizes must sit behind a max() floor of at least 0.75rem; the
    // authenticated app raises that floor to 0.8125rem (13px) for captions and
    // labels. Raw pixel sizes may never drop below 12px.
    const tooSmall: string[] = []
    const styleFiles = readdirSync(`${process.cwd()}/src/styles`)
      .filter(file => file.endsWith('.css') && file !== 'fonts.css')
    for (const fileName of styleFiles) {
      const css = readFileSync(`${process.cwd()}/src/styles/${fileName}`, 'utf8')
      for (const match of css.matchAll(/(?:^|[;{])\s*(font-size|font)\s*:\s*([^;{}]+)/g)) {
        const property = match[1] ?? 'font'
        const value = match[2]?.trim() ?? ''
        if (/max\(\s*\.(?:75|8125)rem/i.test(value) || /(?:ui-)?monospace/i.test(value)) continue
        const smallPixels = [...value.matchAll(/([0-9]+(?:\.[0-9]+)?)px/g)]
          .map(size => Number(size[1]))
          .filter(size => size < 12)
        if (smallPixels.length) tooSmall.push(`${fileName}: ${property}: ${value}`)
      }
    }
    expect(tooSmall).toEqual([])
  })

  it('uses the 13px caption floor across the authenticated app stylesheets', () => {
    for (const fileName of ['base.css', 'jee.css']) {
      const css = readFileSync(`${process.cwd()}/src/styles/${fileName}`, 'utf8')
      expect(css).toContain('max(.8125rem, calc(')
    }
  })
})
