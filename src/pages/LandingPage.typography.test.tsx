// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { applyReadingFont, clearReadingFont, PUBLIC_FONT_STACK } from '../lib/fonts'
import LandingPage from './LandingPage'

const typographyCss = readFileSync(`${process.cwd()}/src/styles/typography.css`, 'utf8')
const publicCss = readFileSync(`${process.cwd()}/src/styles/public.css`, 'utf8')

function renderLanding() {
  return render(<MemoryRouter initialEntries={['/']}><LandingPage /></MemoryRouter>)
}

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.appFont
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.color
  window.localStorage.removeItem('stracker-public-home-theme')
  clearReadingFont(document.documentElement)
})

describe('public homepage typography isolation', () => {
  it('keeps all homepage UI inside the fixed Patrick Hand scope with a non-default account preference present', () => {
    document.documentElement.dataset.appFont = 'active'
    applyReadingFont(document.documentElement, 'sora')
    const { container } = renderLanding()
    const page = container.querySelector('.pub-page')

    expect(page).not.toBeNull()
    expect(screen.getByRole('heading', { name: /Your JEE preparation, organized in/ })).toBeTruthy()
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0)
    expect(page?.querySelector('footer')).not.toBeNull()
    expect(typographyCss).toContain('.pub-page :where(*)')
    expect(typographyCss).toContain("html[data-app-font='active'] .pub-page :where(*)")
    expect(typographyCss).toContain('font-family: var(--font-identity) !important;')
    expect(typographyCss).toContain('font-weight: 400 !important;')
    expect(PUBLIC_FONT_STACK).toContain("'Patrick Hand'")
    expect(PUBLIC_FONT_STACK).not.toContain('Caveat')
  })

  it('keeps the homepage in its public typography scope after the account preference is cleared on logout', () => {
    applyReadingFont(document.documentElement, 'open-sans')
    const first = renderLanding()
    expect(first.container.querySelector('.pub-page')).not.toBeNull()
    first.unmount()

    delete document.documentElement.dataset.appFont
    clearReadingFont(document.documentElement)
    const afterLogout = renderLanding()
    expect(afterLogout.container.querySelector('.pub-page')).not.toBeNull()
    expect(PUBLIC_FONT_STACK).toBe("'Patrick Hand', 'Segoe Print', 'Bradley Hand', cursive")
  })
})

describe('homepage feature disclosure', () => {
  it('keeps the full feature set discoverable through an accessible toggle', () => {
    const { container } = renderLanding()
    const toggle = screen.getByRole('button', { name: 'See all eight Stracker features' })

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-controls')).toBe('feature-list')
    expect(container.querySelectorAll('.feature-entry')).toHaveLength(8)

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toContain('Show fewer features')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('See all features')
  })
})

describe('homepage-only theme and footer wordmark', () => {
  it('renders the oversized Sora wordmark after the existing footer content with an isolated crop', () => {
    document.documentElement.dataset.appFont = 'active'
    applyReadingFont(document.documentElement, 'sora')
    const { container } = renderLanding()
    const page = container.querySelector('.pub-page')
    const wordmark = screen.getByText('STRACKER')

    expect(wordmark.parentElement?.classList.contains('pub-footer-wordmark-window')).toBe(true)
    expect(wordmark.closest('footer')?.lastElementChild).toBe(wordmark.parentElement)
    expect(publicCss).toContain("font-family: 'Sora', sans-serif !important;")
    expect(publicCss).toContain('--pub-wordmark-size: clamp(2rem, 18.2vw, 24rem);')
    expect(publicCss).toContain('font-weight: 700 !important;')
    expect(publicCss).toContain('line-height: .84 !important;')
    expect(publicCss).toContain('height: calc(var(--pub-wordmark-size) * .615)')
    expect(publicCss).toContain('letter-spacing: -.075em;')
    expect(page?.getAttribute('data-public-theme')).toBe('light')
  })

  it('switches only the homepage theme and stores it under a separate public preference', () => {
    document.documentElement.dataset.theme = 'dark'
    document.documentElement.dataset.color = 'sunset-blaze'
    const { container } = renderLanding()
    const page = container.querySelector('.pub-page')

    expect(page?.getAttribute('data-public-theme')).toBe('light')
    fireEvent.click(screen.getByRole('switch', { name: /Light mode on/ }))
    expect(page?.getAttribute('data-public-theme')).toBe('dark')
    expect(screen.getByRole('switch', { name: /Night mode on/ }).getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.color).toBe('sunset-blaze')
    expect(window.localStorage.getItem('stracker-public-home-theme')).toBe('dark')

    fireEvent.click(screen.getByRole('switch', { name: /Night mode on/ }))
    expect(page?.getAttribute('data-public-theme')).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('keeps desktop action order and the existing mobile menu interaction', () => {
    const { container } = renderLanding()
    const navigation = container.querySelector('.pub-nav')
    const toggle = container.querySelector('.pub-theme-toggle')
    const actions = container.querySelector('.pub-header-actions')
    const menuTrigger = screen.getByRole('button', { name: 'Open menu' })

    expect(navigation?.nextElementSibling).toBe(toggle)
    expect(toggle?.nextElementSibling).toBe(actions)
    expect([...actions!.querySelectorAll('a')].map(link => link.textContent)).toEqual(['Log In', 'Sign Up'])
    expect(toggle!.compareDocumentPosition(menuTrigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(publicCss).toContain('.pub-theme-toggle.theme-toggle-dark .theme-toggle-thumb { transform: translateX(20px); }')
    expect(publicCss).toContain('padding-inline: max(14px, env(safe-area-inset-left, 0px)) max(14px, env(safe-area-inset-right, 0px));')

    fireEvent.click(menuTrigger)
    expect(container.querySelector('#stracker-public-menu')).not.toBeNull()
    fireEvent.click(container.querySelector('.pub-menu-link')!)
    expect(container.querySelector('#stracker-public-menu')).toBeNull()
  })
})
