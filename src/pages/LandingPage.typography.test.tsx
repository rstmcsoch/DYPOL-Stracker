// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { applyReadingFont, clearReadingFont, PUBLIC_FONT_STACK } from '../lib/fonts'
import LandingPage from './LandingPage'

const typographyCss = readFileSync(`${process.cwd()}/src/styles/typography.css`, 'utf8')

function renderLanding() {
  return render(<MemoryRouter initialEntries={['/']}><LandingPage /></MemoryRouter>)
}

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.appFont
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
