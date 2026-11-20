import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const typography = readFileSync(resolve(process.cwd(), 'src/styles/typography.css'), 'utf8')
const authEntry = readFileSync(resolve(process.cwd(), 'src/styles/auth-entry.css'), 'utf8')

describe('responsive typography tiers (mobile, portrait tablet, desktop)', () => {
  it('preserves existing desktop identity tokens in :root', () => {
    for (const [token, value] of Object.entries({
      '--type-brand-size': '1.575rem',
      '--type-display-size': '2.025rem',
      '--type-h1-size': '1.8rem',
      '--type-h2-size': '1.38rem',
      '--type-h3-size': '1.1875rem',
      '--type-empty-size': '1.1875rem',
      '--type-metric-size': '1.8rem',
      '--type-body-size': '1rem',
      '--type-input-size': '1rem'
    })) {
      expect(typography).toContain(`${token}: ${value};`)
    }
  })

  it('defines Tier B for portrait tablets and intermediate viewports including iPad Pro portrait', () => {
    expect(typography).toContain('@media (max-width: 960px), (max-width: 1100px) and (orientation: portrait)')
    const tabletBlock = typography.slice(
      typography.indexOf('@media (max-width: 960px), (max-width: 1100px) and (orientation: portrait)'),
      typography.indexOf('@media (max-width: 640px)')
    )
    expect(tabletBlock).toContain('--type-display-size: clamp(1.75rem, 1.62rem + .24vw, 1.875rem);')
    expect(tabletBlock).toContain('--type-h1-size: clamp(1.5625rem, 1.48rem + .14vw, 1.625rem);')
    expect(tabletBlock).toContain('--type-h2-size: clamp(1.25rem, 1.19rem + .12vw, 1.3125rem);')
    expect(tabletBlock).toContain('--type-h3-size: clamp(1.125rem, 1.07rem + .1vw, 1.1875rem);')
    expect(tabletBlock).toContain('--type-h4-size: clamp(1rem, .96rem + .08vw, 1.0625rem);')
    expect(tabletBlock).toContain('--type-metric-size: clamp(1.5625rem, 1.46rem + .2vw, 1.6875rem);')
    expect(tabletBlock).toContain('--type-body-size: 1rem;')
    expect(tabletBlock).toContain('--type-input-size: 1rem;')
    expect(tabletBlock).toContain('--type-nav-size: .875rem;')
    expect(tabletBlock).toContain('--type-table-size: .875rem;')
    expect(tabletBlock).toContain('--fs-section: var(--type-h2-size);')
    expect(tabletBlock).toContain('--fs-card-title: var(--type-h3-size);')
  })

  it('defines Tier A for mobile phones (<=640px) and narrow phones (<=360px) without shrinking body below 16px', () => {
    const mobileBlock = typography.slice(
      typography.indexOf('@media (max-width: 640px)'),
      typography.indexOf('@media (max-width: 360px)')
    )
    expect(mobileBlock).toContain('--type-body-size: 1rem;')
    expect(mobileBlock).toContain('--type-input-size: 1rem;')
    expect(mobileBlock).toContain('--type-button-size: .875rem;')
    expect(mobileBlock).toContain('--type-nav-size: .84375rem;')
    expect(mobileBlock).toContain('--type-table-size: .84375rem;')

    const narrowBlock = typography.slice(
      typography.indexOf('@media (max-width: 360px)'),
      typography.indexOf('/* Stracker AI chat')
    )
    expect(narrowBlock).toContain('--type-display-size: 1.625rem;')
    expect(narrowBlock).toContain('--type-h1-size: 1.5rem;')
    expect(narrowBlock).toContain('--type-h2-size: 1.1875rem;')
    expect(narrowBlock).toContain('--type-h3-size: 1.0625rem;')
    expect(narrowBlock).toContain('--type-metric-size: 1.5rem;')
    expect(narrowBlock).toContain('--type-body-size: 1rem;')
    expect(narrowBlock).toContain('--type-input-size: 1rem;')
  })

  it('keeps inline bold emphasis at the parent font size and preserves Patrick Hand heading weight', () => {
    expect(typography).toContain('.app-shell :is(p, li, dd, td, th, .type-body, .type-secondary, .study-now-summary) :is(b, strong)')
    expect(typography).toContain('font-size: inherit;')
    expect(typography).toContain('.app-shell :is(h1, h2, h3, h4, h5, h6) :is(b, strong, em)')
  })

  it('preserves small legal disclaimers while enforcing a 16px input floor on touch/mobile/tablet auth forms', () => {
    expect(authEntry).toContain('.auth-page-public p.google-auth__legal')
    expect(authEntry).toContain('font-size: .625rem !important;')
    expect(authEntry).toContain('@media (max-width: 960px), (max-width: 1100px) and (orientation: portrait), (pointer: coarse)')
    expect(authEntry).toContain('.auth-page-public .input-with-icon input {\n    font-size: 1rem;\n  }')
  })

  it('preserves reading-font --body-scale compatibility across content roles', () => {
    expect(typography).toContain('calc(var(--type-nav-size) * var(--body-scale))')
    expect(typography).toContain('calc(var(--type-button-size) * var(--body-scale))')
    expect(typography).toContain('calc(var(--type-table-size) * var(--body-scale))')
    expect(typography).toContain('calc(var(--type-secondary-size) * var(--body-scale))')
  })
})
