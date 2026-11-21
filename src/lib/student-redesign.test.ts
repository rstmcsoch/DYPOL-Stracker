import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const redesignCss = readFileSync(resolve(process.cwd(), 'src/styles/student-redesign.css'), 'utf8')
const focusLayoutCss = readFileSync(resolve(process.cwd(), 'src/styles/focus-layout.css'), 'utf8')
const stylesEntry = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

describe('Student dashboard redesign stylesheet contract', () => {
  it('loads inside the authenticated cascade strictly before ai-mobile.css', () => {
    expect(focusLayoutCss.trimStart().startsWith("@import './student-redesign.css';")).toBe(true)
    expect(stylesEntry.trim().split('\n').at(-1)).toBe("@import './styles/ai-mobile.css';")
  })

  it('scopes all redesign rules strictly to the signed-in student shell', () => {
    expect(redesignCss).toContain("html[data-app-font='active'] .app-shell")
    expect(redesignCss).not.toMatch(/^\s*\.(home-page|landing|auth-card|owner-)/m)
  })

  it('uses zero hardcoded hex or rgb colours so all 9 palettes and light/dark modes stay consistent', () => {
    const withoutComments = redesignCss.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(withoutComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(withoutComments).not.toMatch(/\brgba?\s*\(/i)
  })

  it('introduces no new font-family declarations and no sub-12px font sizes', () => {
    const withoutComments = redesignCss.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(withoutComments).not.toMatch(/font-family\s*:/i)
    expect(withoutComments).not.toMatch(/font-size\s*:\s*(?:[0-9]|1[01])(?:\.\d+)?px\b/i)
  })

  it('eliminates duplicate study-time progress bar and coordinates floating launcher clearance', () => {
    expect(redesignCss).toContain('.study-progress-card :is(.study-progress-bar, .progress-bar, .meter-track)')
    expect(redesignCss).toContain('.study-time-actions')
    expect(redesignCss).toContain('.exam-mode-banner')
    expect(redesignCss).toContain('padding-bottom: calc(176px + var(--safe-bottom, 0px))')
    expect(redesignCss).toContain('@media (hover: hover) and (pointer: fine)')
    expect(redesignCss).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
