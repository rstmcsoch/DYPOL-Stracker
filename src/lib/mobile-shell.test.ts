import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const shell = readFileSync(`${process.cwd()}/src/components/AppShell.tsx`, 'utf8')
const responsive = readFileSync(`${process.cwd()}/src/styles/responsive.css`, 'utf8')
const app = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8')

describe('mobile shell (Phase 1)', () => {
  it('bottom bar is the four portrait destinations in order — Home, Tests, Planner, Profile (Focus stays in the drawer)', () => {
    // Keep the mobile bottom bar strictly 4 single-row tabs so it never wraps into the FAB stack.
    const bar = shell.slice(shell.indexOf('const mobileBar'), shell.indexOf('const allNav'))
    const expectedOrder = ["'Home'", "'Tests'", "'Planner'", "'Profile'"]
    let prevIndex = -1
    for (const label of expectedOrder) {
      const idx = bar.indexOf(label)
      expect(idx).toBeGreaterThan(prevIndex)
      prevIndex = idx
    }
    expect(bar).not.toContain("'Focus'")
    expect(bar).not.toContain("to: '/focus'")
    expect(shell).toContain("to: '/focus'")
    expect(bar).not.toContain("'Analytics'")
    expect(shell).toContain("to: '/analytics'")
    expect(bar).not.toContain('More')
    expect(shell).not.toContain('mobileMore')
    expect(shell).toContain("item.to === '/planner' ? item.label : navLabelFor(item.to, item.label, siteValues)")
    expect(responsive).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
    expect(responsive).toContain('grid-auto-flow: column')
    expect(app).toContain('path="profile"')
  })

  it('the drawer excludes Settings and is driven by the animated two-line button', () => {
    expect(shell).toContain('mobile-menu-lines')
    expect(shell).toContain("item.to !== '/settings'")
    expect(shell).toContain('mobile-drawer-backdrop')
    expect(shell).not.toContain('More to explore')
  })

  it('top bar: S mark only (no wordmark), exam fills the middle, actions sit in fixed slots', () => {
    const bar = shell.slice(shell.indexOf('<header className="mobile-topbar">'), shell.indexOf('</header>'))
    expect(bar).toContain('<Brand compact markOnly />')
    expect(shell).toContain('aria-label="Stracker home"')
    expect(shell).toContain('{!markOnly && <span className="brand-type')
    expect(responsive).toContain('grid-template-columns: auto minmax(0, 1fr) auto')
    expect(responsive).toContain('min-width: max-content')
    expect(responsive).not.toContain('.mobile-top-actions { min-width: 0; }')
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
    // One shared position source (layout.css vars): the lightning FAB sits above the
    // floating bar and Ask Stracker sits directly above the lightning button.
    const layout = readFileSync(`${process.cwd()}/src/styles/layout.css`, 'utf8')
    expect(layout).toContain('--fab-bottom: calc(96px + var(--safe-bottom))')
    expect(layout).toContain('.ai-launcher-wrap { right: var(--fab-right); bottom: calc(var(--fab-bottom) + var(--fab-size) + var(--fab-gap));')
    expect(layout).toContain(':root { --fab-right: 27px; --fab-bottom: 28px; --fab-size: 58px; --fab-gap: 12px; }')
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
    expect(shell).toContain("item.to !== '/settings' && !mobileBar.some(bar => bar.to === item.to)")
    expect(app).toContain('path="settings"')
  })
})

describe('mobile follow-ups', () => {
  const settings = readFileSync(`${process.cwd()}/src/pages/SettingsPage.tsx`, 'utf8')
  const profile = readFileSync(`${process.cwd()}/src/pages/ProfilePage.tsx`, 'utf8')
  const layout = readFileSync(`${process.cwd()}/src/styles/layout.css`, 'utf8')
  const registry = readFileSync(`${process.cwd()}/src/lib/site-content/registry.ts`, 'utf8')

  it('drawer never repeats a bottom-bar destination, Settings, or Export & backup', () => {
    expect(shell).toContain("!mobileBar.some(bar => bar.to === item.to)")
    expect(shell).not.toContain("to: '/backup'")
    expect(shell).not.toContain('Sign out')
  })

  it('Profile is read-only for identity; name editing lives in Settings', () => {
    expect(profile).not.toContain('<input')
    expect(profile).not.toContain('<select')
    expect(settings).toContain('label="Display name"')
    expect(settings).toContain('display_name: saved.owner_name')
  })

  it('the tab and section are renamed Tests (route unchanged)', () => {
    expect(shell).toContain("label: 'Tests'")
    expect(shell).not.toContain('Tests & mocks')
    expect(registry).toContain("label: 'Tests'")
    expect(app).toContain('path="tests"')
  })

  it('Settings carries Export & backup and a bottom sign-out; the FAB stack is restored via the shared vars', () => {
    expect(settings).toContain('title="Export & backup"')
    expect(settings).toContain('settings-signout')
    expect(responsive).toContain('.profile-page .notebook-card { padding: 18px 16px; }')
    expect(responsive).toContain('.topline-right > * { flex: none; }')
    expect(layout).toContain('--fab-bottom: calc(96px + var(--safe-bottom))')
    expect(layout).toContain('.ai-launcher-wrap { right: var(--fab-right); bottom: calc(var(--fab-bottom) + var(--fab-size) + var(--fab-gap));')
  })
})

describe('sync pill placement + mobile FAB (follow-up)', () => {
  const layout = readFileSync(`${process.cwd()}/src/styles/layout.css`, 'utf8')

  it('sync lives in the sidebar header and the drawer header, not the bars', () => {
    expect(shell).toContain('sidebar-brand-row')
    expect(shell).toContain('drawer-sync')
    expect(shell).not.toContain('mobile-sync')
    const topline = shell.slice(shell.indexOf('className="topline"'), shell.indexOf('className="topline-right"') + 400)
    expect(topline).not.toContain('sync-pill')
    expect((shell.match(/syncPill/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('sidebar sync control is icon-only: no visible text, but an aria-label and pending badge', () => {
    const responsiveCss = readFileSync(`${process.cwd()}/src/styles/responsive.css`, 'utf8')
    const pill = shell.slice(shell.indexOf('const syncPill'), shell.indexOf('return <>'))
    // No visible status text node — 'Synced' / '3 pending' etc. must not render as text.
    expect(pill).not.toContain('<span>{statusLabel}</span>')
    expect(pill).not.toContain('>{statusLabel}<')
    expect(pill).toContain('sync-pill-icon-only')
    expect(pill).toContain('<StatusIcon')
    // Status + refresh action stay announced for assistive tech and tooltips.
    expect(pill).toContain('aria-label={`Sync status: ${statusLabel} — tap to refresh`}')
    expect(pill).toContain('title={syncError ?? statusLabel}')
    expect(pill).toContain('onClick={() => void refresh()}')
    // A pending count, when present, still shows — as a badge on the icon, not as text.
    expect(pill).toContain('{pendingCount > 0 && <small>{pendingCount}</small>}')
    // Both header instances (desktop sidebar + mobile drawer) get the fixed round size
    // so the drawer header cannot clip it.
    expect(responsiveCss).toContain('.sidebar-sync .sync-pill,')
    expect(responsiveCss).toContain('.drawer-sync .sync-pill { width: 40px; min-width: 40px; height: 40px; min-height: 40px;')
    expect(responsiveCss).toContain('.sync-pill-icon-only small { position: absolute;')
  })

  it('short-height tiers cannot drop the lightning button under the mobile bar', () => {
    expect(layout).toContain('@media (min-width: 961px) and (max-height: 760px)')
    expect(layout).not.toContain('@media (max-height: 760px) { :root { --fab-right: 20px; --fab-bottom: 20px; } }')
    // One z-index scale: the lightning button (62) always floats above the phone bottom bar (60)
    // and the Ask Stracker launcher (56), at every width.
    const base = readFileSync(`${process.cwd()}/src/styles/base.css`, 'utf8')
    const z = (css: string, selector: string) => Number(css.match(new RegExp(`${selector.replace('.', '\\.')} \\{[^}]*z-index: ?(\\d+)`))?.[1])
    expect(z(base, '.quick-action-area')).toBe(62)
    expect(z(base, '.quick-action-area')).toBeGreaterThan(z(base, '.mobile-nav'))
    expect(responsive).not.toMatch(/\.quick-action-area \{ z-index/)
    // The pair itself is untouched: same component, same four actions.
    for (const action of ['Plan a task', 'Add a test', 'Log practice', 'Focus session']) expect(shell).toContain(action)
    expect(shell).toContain('quick-action-fab')
  })
})

describe('Stracker AI floating window on phones', () => {
  const css = readFileSync(`${process.cwd()}/src/styles/ai-mobile.css`, 'utf8')
  const entry = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8')
  it('is phone-only, loads last and leaves the large workspace alone', () => {
    expect(css).toContain('@media (max-width: 520px)')
    expect(entry.trim().split('\n').at(-1)).toBe("@import './styles/ai-mobile.css';")
    expect(css).not.toMatch(/ai-large-workspace|ai-workspace-backdrop/)
  })
  it('keeps the message box at 16px (no iOS zoom), 40px+ taps and rounder corners', () => {
    expect(css).toMatch(/\.ai-composer textarea \{[^}]*font-size: 16px !important/)
    expect(css).toMatch(/\.ai-send-button \{ width: 45px; height: 45px;/)
    expect(css).toMatch(/\.ai-window-tools \.icon-button \{[^}]*height: 45px/)
    expect(css).toContain('border-radius: 18px 20px 16px 19px')
    // Sits above the lightning button, never over it.
    expect(css).toContain('bottom: calc(var(--fab-bottom) + var(--fab-size) + 12px)')
  })
})

describe('theme-matched responsive controls & mobile Home hero', () => {
  const homeLook = readFileSync(`${process.cwd()}/src/styles/app-home-look.css`, 'utf8')

  it('styles Planner week controls and date jump as wrapping theme pills that do not clip on narrow screens', () => {
    expect(homeLook).toContain('.week-card-head')
    expect(homeLook).toContain('.week-arrows button')
    expect(homeLook).toContain('.week-arrows .planner-jump-date')
    expect(homeLook).toContain('border: 1.5px solid var(--app-edge)')
    expect(homeLook).toContain('box-shadow: 2px 2px 0 var(--app-hard)')
    expect(homeLook).toContain('white-space: nowrap')
    expect(homeLook).toContain('flex: 1 1 156px')
    expect(homeLook).toContain('.streak-rest-button')
    expect(homeLook).toContain(':is(.streak-goal-empty, .streak-goal-foot) .text-link')
  })

  it('redesigns the Home hero into stacked sculpted bento cards strictly at max-width: 960px', () => {
    const mobileHeroBlock = homeLook.slice(homeLook.indexOf('@media (max-width: 960px)'))
    expect(mobileHeroBlock).toContain('.hero-row')
    expect(mobileHeroBlock).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(mobileHeroBlock).toContain('.countdown-card')
    expect(mobileHeroBlock).toContain('.countdown-badge')
    expect(mobileHeroBlock).toContain('.countdown-footer')
    expect(mobileHeroBlock).toContain('.streak-card')
    expect(mobileHeroBlock).toContain('.streak-bottom')
    expect(mobileHeroBlock).toContain('.streak-goal')
  })
})
