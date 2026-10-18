// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../lib/defaults'
import { readingFontOption } from '../lib/fonts'
import type { AppSettings, ReadingFont } from '../types'

const mocks = vi.hoisted(() => ({ useData: vi.fn(), notify: vi.fn() }))

vi.mock('./DataContext', () => ({ useData: mocks.useData }))
vi.mock('./ToastContext', () => ({ useToast: () => ({ notify: mocks.notify }) }))

import { AppearanceProvider, useAppearance, useReadingFontPreview } from './AppearanceContext'

const stackOf = (font: ReadingFont) => readingFontOption(font).stack
const rootFont = () => document.documentElement.style.getPropertyValue('--reading-font-family')

function AppearanceProbe() {
  const { readingFont, theme, setTheme } = useAppearance()
  return <>
    <output data-testid="active-font">{readingFont}</output>
    <output data-testid="active-theme">{theme}</output>
    <button type="button" onClick={() => setTheme('dark')}>Use dark theme</button>
  </>
}

/** Stands in for the Settings Appearance draft: previews `font` while mounted. */
function DraftPreview({ font }: { font: ReadingFont }) {
  useReadingFontPreview(font)
  return null
}

function Harness({ previewing, font = 'sora' }: { previewing: boolean; font?: ReadingFont }) {
  return <AppearanceProvider>
    <AppearanceProbe />
    {previewing && <DraftPreview font={font} />}
  </AppearanceProvider>
}

function settingsFor(userId: string, interface_font: AppSettings['interface_font']): AppSettings {
  return { ...defaultSettings(userId), interface_font }
}

function mountAppearance(settings: AppSettings, updateSettings = vi.fn().mockResolvedValue(settings)) {
  mocks.useData.mockReturnValue({ data: { settings }, updateSettings })
  const view = render(<Harness previewing={false} />)
  return { ...view, updateSettings }
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
  delete document.documentElement.dataset.color
  document.documentElement.style.removeProperty('--reading-font-family')
  document.documentElement.style.removeProperty('--body-scale')
  document.documentElement.removeAttribute('data-theme')
})

describe('AppearanceProvider Reading font lifecycle', () => {
  it('applies the saved account Reading font to content tokens while leaving identity fixed', () => {
    mountAppearance(settingsFor('user-one', 'open-sans'))

    expect(screen.getByTestId('active-font').textContent).toBe('open-sans')
    expect(document.documentElement.dataset.appFont).toBe('active')
    expect(rootFont()).toBe(stackOf('open-sans'))
    expect(document.documentElement.style.getPropertyValue('--body-scale')).toBe('1.00')
    // The identity token is static CSS, never written or replaced by account settings.
    expect(document.documentElement.style.getPropertyValue('--font-identity')).toBe('')
  })

  it('uses Lexend as the safe default for accounts without a valid saved value', () => {
    mountAppearance({ ...defaultSettings('user-one'), interface_font: 'default' })
    expect(screen.getByTestId('active-font').textContent).toBe('default')
    expect(rootFont()).toBe(stackOf('default'))

    cleanup()
    mountAppearance({ ...defaultSettings('user-two'), interface_font: 'bad-value' as AppSettings['interface_font'] })
    expect(screen.getByTestId('active-font').textContent).toBe('default')
    expect(rootFont()).toBe(stackOf('default'))
  })

  it('never persists a font as a side effect of mounting the appearance provider', () => {
    const updateSettings = vi.fn().mockResolvedValue(settingsFor('user-one', 'sora'))
    mountAppearance(settingsFor('user-one', 'sora'), updateSettings)
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('clears the previous account font on logout and applies only the next account value', () => {
    const firstSession = mountAppearance(settingsFor('user-one', 'sora'))
    expect(rootFont()).toBe(stackOf('sora'))

    firstSession.unmount()
    expect(document.documentElement.dataset.appFont).toBeUndefined()
    expect(rootFont()).toBe('')
    expect(document.documentElement.style.getPropertyValue('--body-scale')).toBe('')

    mountAppearance(settingsFor('user-two', 'open-sans'))
    expect(screen.getByTestId('active-font').textContent).toBe('open-sans')
    expect(rootFont()).toBe(stackOf('open-sans'))
  })

  it('previews a draft font across the app without persisting it or calling the settings writer', () => {
    const { rerender, updateSettings } = mountAppearance(settingsFor('user-one', 'default'))
    expect(rootFont()).toBe(stackOf('default'))

    rerender(<Harness previewing />)

    expect(rootFont()).toBe(stackOf('sora'))
    expect(screen.getByTestId('active-font').textContent).toBe('sora')
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('reverts to the saved font when the preview ends, as when leaving Settings without saving', () => {
    const { rerender, updateSettings } = mountAppearance(settingsFor('user-one', 'open-sans'))
    rerender(<Harness previewing font="poppins" />)
    expect(rootFont()).toBe(stackOf('poppins'))

    rerender(<Harness previewing={false} />)

    expect(rootFont()).toBe(stackOf('open-sans'))
    expect(screen.getByTestId('active-font').textContent).toBe('open-sans')
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('keeps the draft preview above a saved font that changed underneath it', () => {
    mocks.useData.mockReturnValue({ data: { settings: settingsFor('user-one', 'open-sans') }, updateSettings: vi.fn() })
    const { rerender } = render(<Harness previewing font="sora" />)
    expect(rootFont()).toBe(stackOf('sora'))

    mocks.useData.mockReturnValue({ data: { settings: settingsFor('user-one', 'poppins') }, updateSettings: vi.fn() })
    rerender(<Harness previewing font="sora" />)

    expect(rootFont()).toBe(stackOf('sora'))
  })

  it('clears an active preview on logout, so no account font survives into the signed-out screen', () => {
    const { rerender, unmount } = mountAppearance(settingsFor('user-one', 'open-sans'))
    rerender(<Harness previewing font="sora" />)
    expect(rootFont()).toBe(stackOf('sora'))

    unmount()

    expect(document.documentElement.dataset.appFont).toBeUndefined()
    expect(rootFont()).toBe('')
  })
})

describe('AppearanceProvider theme ownership', () => {
  it('persists only the theme when the header switch is used, leaving the saved font untouched', () => {
    const { updateSettings } = mountAppearance(settingsFor('user-one', 'sora'))

    fireEvent.click(screen.getByRole('button', { name: 'Use dark theme' }))

    expect(updateSettings).toHaveBeenCalledTimes(1)
    const mutate = updateSettings.mock.calls[0]?.[0] as (current: AppSettings) => AppSettings
    const current = settingsFor('user-one', 'sora')
    expect(mutate(current)).toEqual({ ...current, theme: 'dark' })
    expect(rootFont()).toBe(stackOf('sora'))
  })
})
