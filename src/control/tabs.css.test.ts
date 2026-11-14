import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/control/control.css', 'utf8')

describe('section tab styles', () => {
  it('give the current tab an accent bar, soft accent background and full ink (light and dark use the same tokens)', () => {
    expect(css).toMatch(/\.cc-tabs__link\.is-active, \.cc-tabs__link\[aria-current="page"\] \{[^}]*color: var\(--cc-text\)[^}]*background: var\(--cc-accent-soft\)/)
    expect(css).toMatch(/\.cc-tabs__link\[aria-current="page"\]::after \{ background: var\(--cc-accent\)/)
    expect(css).toContain('.cc-tabs__link:hover')
    expect(css).toContain('.cc-tabs__link:focus-visible')
    // Tabs never shrink into each other on narrow screens; the bar scrolls instead.
    expect(css).toMatch(/\.cc-tabs__link \{ position: relative; flex: none;/)
    expect(css).toMatch(/\.cc-tabs \{[^}]*overflow-x: auto/)
  })

  it('makes the sidebar logo 20% and the "Control Centre" title 30% larger', () => {
    expect(css).toContain('.cc-sidebar__brand .cc-brand img { width: 43px; height: 43px; }')
    expect(css).toContain('.cc-sidebar__brand .cc-brand--compact img { width: 34px; height: 34px; }')
    expect(css).toMatch(/\.cc-sidebar__brand \.cc-brand strong \{ font-size: 18\.2px;/)
  })
})
