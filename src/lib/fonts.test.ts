// @vitest-environment jsdom
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  applyInterfaceFont,
  cacheInterfaceFont,
  clearInterfaceFontCache,
  INTERFACE_FONT_OPTIONS,
  INTERFACE_FONT_STORAGE_KEY,
  interfaceFontOption,
  normalizeInterfaceFont
} from './fonts'
import { INTERFACE_FONTS } from '../types'

describe('interface font registry', () => {
  it('exposes exactly the four supported families, each with a single default cut', () => {
    expect(INTERFACE_FONTS).toEqual(['default', 'poppins', 'sora', 'open-sans'])
    expect(INTERFACE_FONT_OPTIONS.map(option => option.value)).toEqual([...INTERFACE_FONTS])
  })

  it('keeps the CSS boot default synchronized with the canonical default stack', () => {
    const baseStyles = readFileSync(`${process.cwd()}/src/styles/base.css`, 'utf8')
    expect(baseStyles).toContain(`--app-font-family: ${interfaceFontOption('default').stack};`)
  })

  it('keeps Default on Caveat, distinct from every other bundled family', () => {
    const defaultStack = interfaceFontOption('default').stack
    expect(defaultStack).toContain("'Caveat'")
    // Caveat must be the regular handwriting font, not Caveat Brush or other substitutes
    expect(defaultStack).not.toContain('Brush')
    for (const family of ["'Poppins'", "'Sora'", "'Open Sans'"]) expect(defaultStack).not.toContain(family)
    expect(interfaceFontOption('poppins').stack.startsWith("'Poppins'")).toBe(true)
    expect(interfaceFontOption('sora').stack.startsWith("'Sora'")).toBe(true)
    expect(interfaceFontOption('open-sans').stack.startsWith("'Open Sans'")).toBe(true)
  })

  it('saves the Settings font choice through the appearance tab instead of bypassing Save', () => {
    const settingsPage = readFileSync(`${process.cwd()}/src/pages/SettingsPage.tsx`, 'utf8')
    expect(settingsPage).toContain("patch('interface_font', option.value)")
    // The radios feed the tab draft; the tab's Save action persists it and the
    // appearance context applies the committed setting — no parallel auto-save path.
    expect(settingsPage).not.toContain('setInterfaceFont')
  })

  it('keeps the index.html boot script synchronized with the canonical stacks and preloads', () => {
    const html = readFileSync(`${process.cwd()}/index.html`, 'utf8')
    expect(html).toContain(INTERFACE_FONT_STORAGE_KEY)
    for (const option of INTERFACE_FONT_OPTIONS) {
      if (option.value === 'default') continue
      expect(html).toContain(option.stack)
      expect(html).toContain(`/assets/fonts/${option.value}-latin-400-normal.woff2`)
    }
  })

  it('applies every selected family through the single document-level CSS token', () => {
    const root = document.createElement('html')

    for (const option of INTERFACE_FONT_OPTIONS) {
      applyInterfaceFont(root, option.value)
      expect(root.style.getPropertyValue('--app-font-family')).toBe(option.stack)
    }
  })

  it('falls back to the default font for legacy rows, unknown values, and injected CSS', () => {
    expect(normalizeInterfaceFont(undefined)).toBe('default')
    expect(normalizeInterfaceFont(null)).toBe('default')
    expect(normalizeInterfaceFont('')).toBe('default')
    expect(normalizeInterfaceFont('Comic Sans')).toBe('default')
    expect(normalizeInterfaceFont('Poppins')).toBe('default')
    expect(normalizeInterfaceFont("Poppins'; background: url(evil)")).toBe('default')
    expect(normalizeInterfaceFont({ family: 'Poppins' })).toBe('default')
  })

  it('accepts every supported preference unchanged', () => {
    for (const font of INTERFACE_FONTS) expect(normalizeInterfaceFont(font)).toBe(font)
  })

  it('caches the font choice for the boot script and clears the cache on demand', () => {
    localStorage.removeItem(INTERFACE_FONT_STORAGE_KEY)
    cacheInterfaceFont('sora')
    expect(localStorage.getItem(INTERFACE_FONT_STORAGE_KEY)).toBe('sora')
    clearInterfaceFontCache()
    expect(localStorage.getItem(INTERFACE_FONT_STORAGE_KEY)).toBeNull()
  })
})

describe('self-hosted font faces', () => {
  const fontsCss = readFileSync(`${process.cwd()}/src/styles/fonts.css`, 'utf8')
  const faces = [...fontsCss.matchAll(/@font-face\s*\{[^}]*\}/g)].map(match => match[0])

  it('ships every declared face as a subset file under /assets/fonts/ and nothing else', () => {
    expect(faces.length).toBeGreaterThan(0)
    const declared = []
    for (const face of faces) {
      expect(face).toContain('font-display: swap')
      expect(face).toContain('unicode-range:')
      const url = /url\('([^']+)'\)/.exec(face)?.[1]
      expect(url?.startsWith('/assets/fonts/')).toBe(true)
      expect(existsSync(`${process.cwd()}/public${url}`)).toBe(true)
      declared.push(url!.replace('/assets/fonts/', ''))
    }
    const shipped = readdirSync(`${process.cwd()}/public/assets/fonts`).sort()
    expect(declared.sort()).toEqual(shipped)
  })

  it('ships only the weights the UI renders (400 body, 600 labels, 700 headings)', () => {
    const weights = faces.map(face => /font-weight:\s*(\d+)/.exec(face)?.[1])
    expect(new Set(weights)).toEqual(new Set(['400', '600', '700']))
  })

  it('covers Greek letters, currency and maths symbols for formula-heavy notes', () => {
    const openSans = faces.filter(face => face.includes("font-family: 'Open Sans'"))
    // θ (U+03B8), λ (U+03BB), ω (U+03C9) live in the Greek and Coptic block.
    expect(openSans.some(face => face.includes('U+03A3-03FF'))).toBe(true)
    // √ (U+221A), ∫ (U+222B) and ≤ (U+2264) live in the maths operators block.
    expect(openSans.some(face => face.includes('U+2216-22FF'))).toBe(true)
    // ₹ (U+20B9) is covered by the latin-ext slice of every bundled family.
    for (const family of ["'Caveat'", "'Poppins'", "'Sora'", "'Open Sans'"]) {
      const familyFaces = faces.filter(face => face.includes(`font-family: ${family}`))
      expect(familyFaces.some(face => face.includes('U+0100-02BA'))).toBe(true)
      expect(familyFaces.some(face => face.includes('U+20AD-20C0'))).toBe(true)
    }
  })
})
