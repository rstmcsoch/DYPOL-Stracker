// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../lib/defaults'
import type { AppSettings } from '../types'

const mocks = vi.hoisted(() => ({ useData: vi.fn(), notify: vi.fn() }))

vi.mock('./DataContext', () => ({ useData: mocks.useData }))
vi.mock('./ToastContext', () => ({ useToast: () => ({ notify: mocks.notify }) }))

import { AppearanceProvider, useAppearance } from './AppearanceContext'

function Probe() {
  const { colorTheme, theme, setColorTheme, setTheme } = useAppearance()
  return <>
    <output data-testid="color-theme">{colorTheme}</output>
    <output data-testid="mode">{theme}</output>
    <button type="button" onClick={() => setColorTheme('ocean-deep')}>Pick ocean</button>
    <button type="button" onClick={() => setTheme('dark')}>Night on</button>
  </>
}

function mount(settings: AppSettings, updateSettings = vi.fn().mockImplementation((mutate: (current: AppSettings) => AppSettings) => Promise.resolve(mutate(settings)))) {
  mocks.useData.mockReturnValue({ data: { settings }, updateSettings })
  return { ...render(<AppearanceProvider><Probe /></AppearanceProvider>), updateSettings }
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
})

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.color
  delete document.documentElement.dataset.theme
})

describe('colour theme persistence', () => {
  it('applies the saved palette to the document root', () => {
    mount({ ...defaultSettings('u1'), color_theme: 'sakura-blossom' })
    expect(document.documentElement.dataset.color).toBe('sakura-blossom')
    expect(screen.getByTestId('color-theme').textContent).toBe('sakura-blossom')
  })

  it('leaves no data-color attribute for the Default palette', () => {
    mount(defaultSettings('u1'))
    expect(document.documentElement.dataset.color).toBeUndefined()
  })

  it('falls back to Default for unknown stored palettes', () => {
    mount({ ...defaultSettings('u1'), color_theme: 'rainbow' as AppSettings['color_theme'] })
    expect(screen.getByTestId('color-theme').textContent).toBe('default')
    expect(document.documentElement.dataset.color).toBeUndefined()
  })

  it('persists palette changes through the shared settings writer', async () => {
    const settings = defaultSettings('u1')
    const updateSettings = vi.fn().mockImplementation((mutate: (current: AppSettings) => AppSettings) => Promise.resolve(mutate(settings)))
    mount(settings, updateSettings)
    fireEvent.click(screen.getByText('Pick ocean'))
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1))
    const mutate = updateSettings.mock.calls[0]?.[0] as (current: AppSettings) => AppSettings
    expect(mutate(settings)).toEqual(expect.objectContaining({ color_theme: 'ocean-deep', theme: 'light' }))
  })

  it('the top-right style mode switch never resets the chosen palette', async () => {
    const settings = { ...defaultSettings('u1'), color_theme: 'forest-emerald' as AppSettings['color_theme'] }
    const updateSettings = vi.fn().mockImplementation((mutate: (current: AppSettings) => AppSettings) => Promise.resolve(mutate(settings)))
    mount(settings, updateSettings)
    fireEvent.click(screen.getByText('Night on'))
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1))
    const mutate = updateSettings.mock.calls[0]?.[0] as (current: AppSettings) => AppSettings
    const saved = mutate(settings)
    expect(saved.theme).toBe('dark')
    expect(saved.color_theme).toBe('forest-emerald')
  })
})
