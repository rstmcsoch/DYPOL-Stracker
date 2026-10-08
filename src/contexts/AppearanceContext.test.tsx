// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../lib/defaults'
import { INTERFACE_FONT_OPTIONS } from '../lib/fonts'
import type { AppSettings } from '../types'

const mocks = vi.hoisted(() => ({ useData: vi.fn(), notify: vi.fn() }))

vi.mock('./DataContext', () => ({ useData: mocks.useData }))
vi.mock('./ToastContext', () => ({ useToast: () => ({ notify: mocks.notify }) }))

import { AppearanceProvider, useAppearance } from './AppearanceContext'

function AppearanceProbe() {
  const { interfaceFont, setInterfaceFont } = useAppearance()
  return <>
    <output data-testid="active-font">{interfaceFont}</output>
    <button type="button" onClick={() => setInterfaceFont('sora')}>Use Sora</button>
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
  document.documentElement.style.removeProperty('--app-font-family')
})

describe('AppearanceProvider interface font lifecycle', () => {
  it('restores the saved account font to the document root when the app session mounts', () => {
    mountAppearance(settingsFor('user-one', 'open-sans'))

    expect(screen.getByTestId('active-font').textContent).toBe('open-sans')
    expect(document.documentElement.style.getPropertyValue('--app-font-family'))
      .toBe(INTERFACE_FONT_OPTIONS.find(option => option.value === 'open-sans')?.stack)
  })

  it('applies a new choice immediately and persists it through the account settings row', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined)
    mountAppearance(settingsFor('user-one', 'default'), upsert)

    fireEvent.click(screen.getByRole('button', { name: 'Use Sora' }))

    expect(document.documentElement.style.getPropertyValue('--app-font-family'))
      .toBe(INTERFACE_FONT_OPTIONS.find(option => option.value === 'sora')?.stack)
    await waitFor(() => expect(upsert).toHaveBeenCalledWith('app_settings', expect.objectContaining({
      user_id: 'user-one',
      interface_font: 'sora'
    })))
  })

  it('clears one account font on logout and restores the next account font on login', () => {
    const firstSession = mountAppearance(settingsFor('user-one', 'sora'))
    expect(document.documentElement.style.getPropertyValue('--app-font-family'))
      .toBe(INTERFACE_FONT_OPTIONS.find(option => option.value === 'sora')?.stack)

    firstSession.unmount()
    expect(document.documentElement.style.getPropertyValue('--app-font-family'))
      .toBe(INTERFACE_FONT_OPTIONS.find(option => option.value === 'default')?.stack)

    mountAppearance(settingsFor('user-two', 'open-sans'))
    expect(document.documentElement.style.getPropertyValue('--app-font-family'))
      .toBe(INTERFACE_FONT_OPTIONS.find(option => option.value === 'open-sans')?.stack)
  })
})
