// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyInterfaceFont, INTERFACE_FONT_OPTIONS, interfaceFontOption, normalizeInterfaceFont } from './fonts'
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

  it('keeps a readable sans in front of every fallback chain', () => {
    expect(interfaceFontOption('default').stack.startsWith("'Poppins'")).toBe(true)
    expect(interfaceFontOption('poppins').stack.startsWith("'Poppins'")).toBe(true)
    expect(interfaceFontOption('sora').stack.startsWith("'Sora'")).toBe(true)
    expect(interfaceFontOption('open-sans').stack.startsWith("'Open Sans'")).toBe(true)
  })

  it('routes the Settings picker into the unsaved draft and its preview, never into a persisting setter', () => {
    const settingsPage = readFileSync(`${process.cwd()}/src/pages/SettingsPage.tsx`, 'utf8')
    expect(settingsPage).toContain("onChange={() => patch('interface_font', option.value)}")
    expect(settingsPage).toContain('useInterfaceFontPreview(draft.interface_font)')
    expect(settingsPage).not.toContain('setInterfaceFont')
  })

  it('keeps font persistence out of AppearanceContext, which only resolves and applies the font', () => {
    const appearance = readFileSync(`${process.cwd()}/src/contexts/AppearanceContext.tsx`, 'utf8')
    expect(appearance).not.toMatch(/setInterfaceFont|pendingFont|writeQueue|\bupsert\(/)
    // Theme persists through the shared settings writer; the font field itself is never written here.
    expect(appearance).not.toMatch(/interface_font\s*:/)
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
})
