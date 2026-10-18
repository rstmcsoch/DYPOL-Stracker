// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SiteContentProvider } from '../contexts/SiteContentContext'
import LandingPage from './LandingPage'

beforeAll(() => {
  class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
  vi.stubGlobal('IntersectionObserver', Observer)
})
afterEach(() => {
  cleanup()
  window.localStorage.removeItem('stracker-public-home-theme')
})

function renderLanding(overrides: Record<string, string>) {
  const { container } = render(<MemoryRouter><SiteContentProvider overrides={overrides}><LandingPage /></SiteContentProvider></MemoryRouter>)
  return container.querySelector('.pub-page') as HTMLElement
}

describe('owner public appearance defaults', () => {
  it('keeps the original light look with no configuration', () => {
    const page = renderLanding({})
    expect(page.dataset.publicTheme).toBe('light')
    expect(page.hasAttribute('data-owner-accent')).toBe(false)
    expect(page.getAttribute('style')).toBeNull()
  })

  it('uses the owner default until the visitor chooses', () => {
    const page = renderLanding({ 'public.appearance.default_mode': 'dark' })
    expect(page.dataset.publicTheme).toBe('dark')
  })

  it("lets the visitor's saved choice win over the owner default", () => {
    window.localStorage.setItem('stracker-public-home-theme', 'light')
    const page = renderLanding({ 'public.appearance.default_mode': 'dark' })
    expect(page.dataset.publicTheme).toBe('light')
  })

  it('toggles and remembers the visitor choice', () => {
    const page = renderLanding({ 'public.appearance.default_mode': 'dark' })
    fireEvent.click(screen.getByRole('switch', { name: /Night mode on/ }))
    expect(page.dataset.publicTheme).toBe('light')
    expect(window.localStorage.getItem('stracker-public-home-theme')).toBe('light')
  })

  it('applies an accent preset with tuned light and dark values', () => {
    const page = renderLanding({ 'public.appearance.accent': 'forest-emerald' })
    expect(page.hasAttribute('data-owner-accent')).toBe(true)
    expect(page.style.getPropertyValue('--owner-accent-light')).toBe('#2e6b4f')
    expect(page.style.getPropertyValue('--owner-accent-dark')).toBe('#7fc49f')
  })

  it('applies the owner website font and keeps the identity font by default', () => {
    expect(renderLanding({}).hasAttribute('data-owner-font')).toBe(false)
    cleanup()
    expect(renderLanding({ 'public.appearance.font': 'sora' }).dataset.ownerFont).toBe('sora')
  })

  it('ignores an unknown stored accent', () => {
    const page = renderLanding({ 'public.appearance.accent': 'hotpink' })
    expect(page.hasAttribute('data-owner-accent')).toBe(false)
  })
})
