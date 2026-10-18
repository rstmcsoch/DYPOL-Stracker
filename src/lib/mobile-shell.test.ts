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
    expect(responsive).toContain('.quick-action-area { z-index: 65; }')
    // The pair itself is untouched: same component, same four actions.
    for (const action of ['Plan a task', 'Add a test', 'Log practice', 'Focus session']) expect(shell).toContain(action)
    expect(shell).toContain('quick-action-fab')
  })
})
