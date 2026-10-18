import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const shell = readFileSync(`${process.cwd()}/src/components/AppShell.tsx`, 'utf8')
const responsive = readFileSync(`${process.cwd()}/src/styles/responsive.css`, 'utf8')
const app = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8')

describe('mobile shell (Phase 1)', () => {
  it('bottom bar is Home, Tests, Analytics, Profile — and nothing else', () => {
    const bar = shell.slice(shell.indexOf('const mobileBar'), shell.indexOf('const allNav'))
    for (const label of ["'Home'", "'Tests'", "'Analytics'", "'Profile'"]) expect(bar).toContain(label)
    expect(bar).not.toContain('More')
    expect(shell).not.toContain('mobileMore')
    expect(app).toContain('path="profile"')
  })

  it('the drawer excludes Settings and is driven by the animated two-line button', () => {
    expect(shell).toContain('mobile-menu-lines')
    expect(shell).toContain("item.to !== '/settings'")
    expect(shell).toContain('mobile-drawer-backdrop')
    expect(shell).not.toContain('More to explore')
  })

  it('bars are floating, theme-safe and scoped to the mobile breakpoint', () => {
    const block = responsive.slice(responsive.indexOf('mobile shell (Phase 1)'))
    expect(block).toContain('@media (max-width: 960px)')
    expect(block).toContain('background: var(--paper)')
    expect(block).toContain('box-shadow: var(--shadow-float)')
    expect(block).toContain('border-radius: 22px')
    expect(block).toContain('var(--safe-bottom)')
    expect(block).toContain('clamp(')
    expect(block).toContain('translateX(-42px)')
    expect(block).toContain('.mobile-menu-lines.is-open i:first-child { transform: translateY(4px) rotate(45deg); }')
  })
})

describe('mobile cleanup (Phase 2)', () => {
  it('hides the duplicated topline cluster and every keyboard hint on phones', () => {
    const block = responsive.slice(responsive.indexOf('mobile cleanup (Phase 2)'))
    expect(block).toContain('.topline { display: none; }')
    expect(block).toContain('.app-shell kbd { display: none; }')
  })

  it('stacks the AI button above the lightning button above the floating bar', () => {
    const ai = readFileSync(`${process.cwd()}/src/styles/ai.css`, 'utf8')
    expect(ai).toContain('.ai-launcher-wrap { right:16px; bottom:calc(164px + var(--safe-bottom)); }')
    expect(ai).not.toContain('right:70px; bottom:calc(78px')
    const phase1 = responsive.slice(responsive.indexOf('mobile shell (Phase 1)'))
    expect(phase1).toContain('.quick-action-area { bottom: calc(96px + var(--safe-bottom)); }')
  })
})

describe('mobile profile (Phase 3)', () => {
  it('Profile hides the two-line menu button and links the gear to Settings', () => {
    expect(shell).toContain("location.pathname !== '/profile' && <button type=\"button\" className=\"mobile-menu-btn\"")
    const profile = readFileSync(`${process.cwd()}/src/pages/ProfilePage.tsx`, 'utf8')
    expect(profile).toContain('to="/settings"')
    expect(profile).toContain('aria-label="Open settings"')
    expect(profile).toContain('<ExamSelectionSection />')
    expect(profile).toContain('computeStreaks')
  })

  it('Settings stays out of the mobile drawer (route reachable via Profile gear)', () => {
    expect(shell).toContain("group.items.filter(item => item.to !== '/settings')")
    expect(app).toContain('path="settings"')
  })
})
