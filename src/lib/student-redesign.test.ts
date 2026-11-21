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

  it('introduces no new font-family declarations and no sub-12px font sizes', () => {
    expect(withoutComments).not.toMatch(/font-family\s*:/i)
    expect(withoutComments).not.toMatch(/font-size\s*:\s*(?:[0-9]|1[01])(?:\.\d+)?px\b/i)
  })

  it('avoids AI-slop tells: no thick side-tab borders on rounded cards and no italic headings', () => {
    expect(withoutComments).not.toMatch(/border-left\s*:\s*[3-9]px\s+solid/i)
    expect(withoutComments).toContain('font-style: normal;')
  })

  it('enforces strict containment so text, badges, inputs, and cards never overflow their elements', () => {
    expect(withoutComments).toContain('overflow-x: clip;')
    expect(withoutComments).toContain('overflow-wrap: anywhere;')
    expect(withoutComments).toContain('min-width: 0;')
    expect(withoutComments).toContain('max-width: 100%;')
    expect(withoutComments).toContain('text-overflow: ellipsis;')
  })

  it('ensures buttons look and behave like real tactile buttons with >=44px mobile touch targets', () => {
    expect(withoutComments).toContain('.button-primary')
    expect(withoutComments).toContain('.button-secondary')
    expect(withoutComments).toContain('.icon-button')
    expect(withoutComments).toContain('min-height: 44px;')
    expect(withoutComments).toContain(':active:not(:disabled)')
    expect(withoutComments).toContain(':focus-visible')
  })

  it('eliminates duplicate study-time progress bar and coordinates floating launcher clearance', () => {
    expect(withoutComments).toContain('.study-progress-card :is(.study-progress-bar, .progress-bar, .meter-track)')
    expect(withoutComments).toContain('.study-time-actions')
    expect(withoutComments).toContain('.exam-mode-banner')
    expect(withoutComments).toContain('padding-bottom: calc(180px + var(--safe-bottom, 0px))')
    expect(withoutComments).toContain('@media (hover: hover) and (pointer: fine)')
    expect(withoutComments).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
