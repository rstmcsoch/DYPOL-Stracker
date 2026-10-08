// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../lib/defaults'
import { INTERFACE_FONT_OPTIONS } from '../lib/fonts'
import type { AppSettings, InterfaceFont } from '../types'

const mocks = vi.hoisted(() => ({ useData: vi.fn(), notify: vi.fn() }))

vi.mock('./DataContext', () => ({ useData: mocks.useData }))
vi.mock('./ToastContext', () => ({ useToast: () => ({ notify: mocks.notify }) }))

import { AppearanceProvider, useAppearance, useInterfaceFontPreview } from './AppearanceContext'

const stackOf = (font: InterfaceFont) => INTERFACE_FONT_OPTIONS.find(option => option.value === font)?.stack
const rootFont = () => document.documentElement.style.getPropertyValue('--app-font-family')

function AppearanceProbe() {
  const { interfaceFont, theme, setTheme } = useAppearance()
  return <>
    <output data-testid="active-font">{interfaceFont}</output>
    <output data-testid="active-theme">{theme}</output>
    <button type="button" onClick={() => setTheme('dark')}>Header theme switch</button>
  </>
}

/** Stands in for the Settings Appearance draft: previews `font` while mounted. */
function DraftPreview({ font }: { font: InterfaceFont }) {
  useInterfaceFontPreview(font)
  return null
}

function Harness({ previewing, font = 'sora' }: { previewing: boolean; font?: InterfaceFont }) {
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
  document.documentElement.style.removeProperty('--app-font-family')
  document.documentElement.removeAttribute('data-theme')
})

describe('AppearanceProvider font application', () => {
  it('restores the saved account font to the document root when the app session mounts', () => {
    mountAppearance(settingsFor('user-one', 'open-sans'))

    expect(screen.getByTestId('active-font').textContent).toBe('open-sans')
    expect(rootFont()).toBe(stackOf('open-sans'))
  })

  it('clears one account font on logout and restores the next account font on login', () => {
    const firstSession = mountAppearance(settingsFor('user-one', 'sora'))
    expect(rootFont()).toBe(stackOf('sora'))

    firstSession.unmount()
    expect(rootFont()).toBe(stackOf('default'))

    mountAppearance(settingsFor('user-two', 'open-sans'))
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

  it('clears an active preview on logout, so the next signed-out screen uses the default font', () => {
    const { rerender, unmount } = mountAppearance(settingsFor('user-one', 'open-sans'))
    rerender(<Harness previewing font="sora" />)
    expect(rootFont()).toBe(stackOf('sora'))

    unmount()

    expect(rootFont()).toBe(stackOf('default'))
  })
})

describe('AppearanceProvider theme ownership', () => {
  it('persists only the theme when the header switch is used, leaving the saved font untouched', () => {
    const { updateSettings } = mountAppearance(settingsFor('user-one', 'sora'))

    fireEvent.click(screen.getByRole('button', { name: 'Header theme switch' }))

    expect(updateSettings).toHaveBeenCalledTimes(1)
    const mutate = updateSettings.mock.calls[0]?.[0] as (current: AppSettings) => AppSettings
    const current = settingsFor('user-one', 'sora')
    expect(mutate(current)).toEqual({ ...current, theme: 'dark' })
  })
})
