import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const redesignCss = readFileSync(resolve(process.cwd(), 'src/styles/student-redesign.css'), 'utf8')
const focusLayoutCss = readFileSync(resolve(process.cwd(), 'src/styles/focus-layout.css'), 'utf8')
const stylesEntry = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
const withoutComments = redesignCss.replace(/\/\*[\s\S]*?\*\//g, '')

describe('Student dashboard anti-slop craft & containment contract', () => {
  it('loads inside the authenticated cascade strictly before ai-mobile.css', () => {
    expect(focusLayoutCss.trimStart().startsWith("@import './student-redesign.css';")).toBe(true)
    expect(stylesEntry.trim().split('\n').at(-1)).toBe("@import './styles/ai-mobile.css';")
  })

  it('scopes all redesign rules strictly to the signed-in student shell', () => {
    expect(redesignCss).toContain("html[data-app-font='active'] .app-shell")
    expect(redesignCss).not.toMatch(/^\s*\.(home-page|landing|auth-card|owner-)/m)
  })

  it('uses zero hardcoded hex or rgb colours so all 9 palettes and light/dark modes stay consistent', () => {
    expect(withoutComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(withoutComments).not.toMatch(/\brgba?\s*\(/i)
  })

  it('uses only existing CSS font tokens (never hardcoded font families) and zero sub-12px font sizes', () => {
    const fontFamilies = [...withoutComments.matchAll(/font-family\s*:\s*([^;]+);/gi)].map(match => match[1]?.trim())
    for (const value of fontFamilies) {
      expect(value).toMatch(/^var\(--font-(body|heading|identity|number|label|ui)\)(\s*!important)?$/)
    }
    expect(withoutComments).not.toMatch(/font-size\s*:\s*(?:[0-9]|1[01])(?:\.\d+)?px\b/i)
  })

  it('highlights both exam countdowns side by side with matching bold geometric numerals overriding Patrick Hand', () => {
    expect(withoutComments).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));')
    expect(withoutComments).toContain('.countdown-card:has(.countdown-main) .countdown-footer')
    expect(withoutComments).toContain('display: contents;')
    expect(withoutComments).toContain('font-family: var(--font-body) !important;')
    expect(withoutComments).toContain('font-weight: 800 !important;')
    expect(withoutComments).toContain('font-variant-numeric: tabular-nums;')
  })

  it('avoids AI-slop tells: no thick side-tab borders on rounded cards and no italic headings', () => {
    expect(withoutComments).not.toMatch(/border-left\s*:\s*[3-9]px\s+solid/i)
    expect(withoutComments).toContain('font-style: normal;')
  })

  it('prevents column flex-basis header gaps and void gaps before the footer', () => {
    expect(withoutComments).not.toMatch(/\.page-header-copy\s*\{[^}]*flex:\s*1\s+1\s+\d+px/i)
    expect(withoutComments).toContain('padding-bottom: 18px;')
    expect(withoutComments).toContain('padding-bottom: calc(108px + var(--safe-bottom, 0px));')
  })

  it('prevents button label clipping and keeps mobile topbar icons borderless', () => {
    expect(withoutComments).toContain('white-space: normal;')
    expect(withoutComments).toContain('padding: 9px 16px;')
    expect(withoutComments).toContain('.mobile-top-actions .icon-button')
    expect(withoutComments).toContain('.ai-launcher .ai-launcher-label')
  })

  it('enforces strict containment and hides the redundant Daily Study Time bottom progress bar', () => {
    expect(withoutComments).toContain('overflow-x: clip;')
    expect(withoutComments).toContain('overflow-wrap: break-word;')
    expect(withoutComments).toContain('min-width: 0;')
    expect(withoutComments).toContain('max-width: 100%;')
    expect(withoutComments).toContain('.study-progress-card :is(.progress-track, .study-progress-bar, .progress-bar, .meter-track)')
    expect(withoutComments).toContain('@media (hover: hover) and (pointer: fine)')
    expect(withoutComments).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
