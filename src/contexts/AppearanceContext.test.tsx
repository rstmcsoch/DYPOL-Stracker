// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../lib/defaults'
import { readingFontOption } from '../lib/fonts'
import type { AppSettings } from '../types'

const mocks = vi.hoisted(() => ({ useData: vi.fn(), notify: vi.fn() }))

vi.mock('./DataContext', () => ({ useData: mocks.useData }))
vi.mock('./ToastContext', () => ({ useToast: () => ({ notify: mocks.notify }) }))

import { AppearanceProvider, useAppearance } from './AppearanceContext'

function AppearanceProbe() {
  const { readingFont, theme, setTheme } = useAppearance()
  return <>
    <output data-testid="active-font">{readingFont}</output>
    <output data-testid="active-theme">{theme}</output>
    <button type="button" onClick={() => setTheme('dark')}>Use dark theme</button>
  </>
}

function settingsFor(userId: string, interface_font: AppSettings['interface_font']): AppSettings {
  return { ...defaultSettings(userId), interface_font }
}

function mountAppearance(settings: AppSettings, upsert = vi.fn().mockResolvedValue(undefined)) {
  mocks.useData.mockReturnValue({ data: { settings }, upsert })
  const view = render(<AppearanceProvider><AppearanceProbe /></AppearanceProvider>)
  return { ...view, upsert }
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
  mocks.useData.mockReset()
  mocks.notify.mockReset()
})

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.appFont
  document.documentElement.style.removeProperty('--reading-font-family')
  document.documentElement.style.removeProperty('--body-scale')
})

describe('AppearanceProvider committed Reading font lifecycle', () => {
  it('applies the saved account Reading font to content tokens while leaving identity fixed', () => {
    mountAppearance(settingsFor('user-one', 'open-sans'))

    expect(screen.getByTestId('active-font').textContent).toBe('open-sans')
    expect(document.documentElement.dataset.appFont).toBe('active')
    expect(document.documentElement.style.getPropertyValue('--reading-font-family'))
      .toBe(readingFontOption('open-sans').stack)
    expect(document.documentElement.style.getPropertyValue('--body-scale')).toBe('1.00')
    // The identity token is static CSS, never written or replaced by account settings.
    expect(document.documentElement.style.getPropertyValue('--font-identity')).toBe('')
  })

  it('uses Lexend as the safe default for accounts without a valid saved value', () => {
    mountAppearance({ ...defaultSettings('user-one'), interface_font: 'default' })
    expect(screen.getByTestId('active-font').textContent).toBe('default')
    expect(document.documentElement.style.getPropertyValue('--reading-font-family'))
      .toBe(readingFontOption('default').stack)

    cleanup()
    mountAppearance({ ...defaultSettings('user-two'), interface_font: 'bad-value' as AppSettings['interface_font'] })
    expect(screen.getByTestId('active-font').textContent).toBe('default')
    expect(document.documentElement.style.getPropertyValue('--reading-font-family'))
      .toBe(readingFontOption('default').stack)
  })

  it('never persists a font as a side effect of mounting the appearance provider', () => {
    const upsert = vi.fn().mockResolvedValue(undefined)
    mountAppearance(settingsFor('user-one', 'sora'), upsert)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('clears the previous account font on logout and applies only the next account value', () => {
    const firstSession = mountAppearance(settingsFor('user-one', 'sora'))
    expect(document.documentElement.style.getPropertyValue('--reading-font-family'))
      .toBe(readingFontOption('sora').stack)

    firstSession.unmount()
    expect(document.documentElement.dataset.appFont).toBeUndefined()
    expect(document.documentElement.style.getPropertyValue('--reading-font-family')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--body-scale')).toBe('')

    mountAppearance(settingsFor('user-two', 'open-sans'))
    expect(screen.getByTestId('active-font').textContent).toBe('open-sans')
    expect(document.documentElement.style.getPropertyValue('--reading-font-family'))
      .toBe(readingFontOption('open-sans').stack)
  })

  it('keeps the header theme control independent and writes only the theme field', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined)
    mountAppearance(settingsFor('user-one', 'poppins'), upsert)

    fireEvent.click(screen.getByRole('button', { name: 'Use dark theme' }))
    await waitFor(() => expect(upsert).toHaveBeenCalledWith('app_settings', expect.objectContaining({
      user_id: 'user-one',
      theme: 'dark',
      interface_font: 'poppins'
    })))
    expect(document.documentElement.style.getPropertyValue('--reading-font-family'))
      .toBe(readingFontOption('poppins').stack)
  })
})
