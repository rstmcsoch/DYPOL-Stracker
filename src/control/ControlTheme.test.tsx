// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CONTROL_THEME_STORAGE_KEY } from '../lib/control-theme'
import { ControlThemeRoot, ControlThemeSwitch, useControlTheme } from './ControlTheme'

function Probe() {
  const { preference, resolved } = useControlTheme()
  return <p data-testid="probe">{preference}:{resolved}</p>
}

function renderConsole() {
  return render(<ControlThemeRoot><ControlThemeSwitch /><Probe /></ControlThemeRoot>)
}

describe('Control Center theme', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => cleanup())

  it('defaults to dark, the existing console look, on the scoped root only', () => {
    const { container } = renderConsole()
    const root = container.querySelector('.cc-root')
    expect(root?.getAttribute('data-cc-theme')).toBe('dark')
    expect(root?.getAttribute('data-cc-theme-preference')).toBe('dark')
    expect(screen.getByTestId('probe').textContent).toBe('dark:dark')
  })

  it('offers Light, Dark and System as a radio group and persists the choice', () => {
    const { container } = renderConsole()
    const radios = screen.getAllByRole('radio')
    expect(radios.map(radio => radio.textContent?.trim())).toEqual(expect.arrayContaining(['Light', 'Dark', 'System']))
    fireEvent.click(screen.getByRole('radio', { name: /light/i }))
    expect(container.querySelector('.cc-root')?.getAttribute('data-cc-theme')).toBe('light')
    expect(window.localStorage.getItem(CONTROL_THEME_STORAGE_KEY)).toBe('light')
  })

  it('reads a stored preference on first render (no flash to the default)', () => {
    window.localStorage.setItem(CONTROL_THEME_STORAGE_KEY, 'light')
    const { container } = renderConsole()
    expect(container.querySelector('.cc-root')?.getAttribute('data-cc-theme')).toBe('light')
  })

  it('falls back to dark when the stored value is not recognised', () => {
    window.localStorage.setItem(CONTROL_THEME_STORAGE_KEY, 'neon')
    const { container } = renderConsole()
    expect(container.querySelector('.cc-root')?.getAttribute('data-cc-theme')).toBe('dark')
  })
})
