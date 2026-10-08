import { describe, expect, it } from 'vitest'
import { INTERFACE_FONT_OPTIONS, interfaceFontOption, normalizeInterfaceFont } from './fonts'
import { INTERFACE_FONTS } from '../types'

describe('interface font registry', () => {
  it('exposes exactly the four supported families, each with a single default cut', () => {
    expect(INTERFACE_FONTS).toEqual(['default', 'poppins', 'sora', 'open-sans'])
    expect(INTERFACE_FONT_OPTIONS.map(option => option.value)).toEqual([...INTERFACE_FONTS])
  })

  it('keeps the Stracker default cut in front of every fallback chain', () => {
    expect(interfaceFontOption('default').stack.startsWith("'Patrick Hand'")).toBe(true)
    expect(interfaceFontOption('poppins').stack.startsWith("'Poppins'")).toBe(true)
    expect(interfaceFontOption('sora').stack.startsWith("'Sora'")).toBe(true)
    expect(interfaceFontOption('open-sans').stack.startsWith("'Open Sans'")).toBe(true)
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
