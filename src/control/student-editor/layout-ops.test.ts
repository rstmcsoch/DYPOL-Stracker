import { describe, expect, it } from 'vitest'
import { checkStudentLayout } from '../../lib/student-layout/validate'
import { EMPTY_LAYOUT, compactLayout, moveBy, orderOf, setProp, setStyle, setText, toggleHidden, clearStyles } from './layout-ops'

describe('student layout edits', () => {
  it('edits declared labels and drops values equal to the shipped default', () => {
    const doc = setText(EMPTY_LAYOUT, 'home.streak', 'kicker', 'MY RHYTHM')!
    expect(doc.components?.['home.streak']?.text).toEqual({ kicker: 'MY RHYTHM' })
    expect(setText(doc, 'home.streak', 'kicker', 'STUDY STREAK')!.components).toBeUndefined()
  })

  it('never writes data-bound values', () => {
    expect(setText(EMPTY_LAYOUT, 'home.streak', 'current', '99')).toBeNull()
    expect(setText(EMPTY_LAYOUT, 'home.header', 'name', 'Someone')).toBeNull()
    expect(setText(EMPTY_LAYOUT, 'home.countdown', 'daysLeft', '3')).toBeNull()
    expect(setProp(EMPTY_LAYOUT, 'home.syllabus', 'percent', 80)).toBeNull()
  })

  it('refuses to hide required parts and toggles optional ones', () => {
    expect(toggleHidden(EMPTY_LAYOUT, 'home.today-plan')).toBeNull()
    expect(toggleHidden(EMPTY_LAYOUT, 'home.countdown')).toBeNull()
    const hidden = toggleHidden(EMPTY_LAYOUT, 'home.tip')!
    expect(hidden.components?.['home.tip']?.hidden).toBe(true)
    expect(toggleHidden(hidden, 'home.tip')!.components).toBeUndefined()
  })

  it('reorders within the container and skips fixed parts', () => {
    const moved = moveBy(EMPTY_LAYOUT, 'home.revisions', -1)!
    expect(orderOf(moved, 'home.aside')).toEqual(['home.revisions', 'home.study-time', 'home.tip'])
    expect(moveBy(moved, 'home.revisions', -1)).toBeNull()
    expect(moveBy(moved, 'home.revisions', 1)!.order).toBeUndefined()
    expect(moveBy(EMPTY_LAYOUT, 'home', 1)).toBeNull()
  })

  it('keeps per-device styles separate and produces documents the server accepts', () => {
    let doc = setStyle(EMPTY_LAYOUT, 'home.tip', 'desktop', 'padding', '24px')!
    doc = setStyle(doc, 'home.tip', 'mobile', 'padding', '8px')!
    doc = setText(doc, 'home.tip', 'kicker', 'NOTICE THIS')!
    doc = moveBy(doc, 'home.tip', -1)!
    expect(doc.components?.['home.tip']).toMatchObject({ style: { padding: '24px' }, responsive: { mobile: { padding: '8px' } } })
    expect(checkStudentLayout(doc).problems).toEqual([])
    expect(compactLayout(clearStyles(doc, 'home.tip', 'mobile')).components?.['home.tip']?.responsive).toBeUndefined()
  })
})

describe('navigation and tokens', () => {
  it('reorders groups and items and compacts back to the default', async () => {
    const { moveNavGroup, moveNavItem, navGroupsOf, navItemsOf, toggleNavHidden } = await import('./layout-ops')
    const moved = moveNavGroup(EMPTY_LAYOUT, 'tests', -1)!
    expect(navGroupsOf(moved).slice(0, 3)).toEqual(['study', 'tests', 'syllabus'])
    expect(checkStudentLayout(moved).problems).toEqual([])
    expect(moveNavGroup(moved, 'tests', 1)!.nav).toBeUndefined()
    expect(moveNavGroup(EMPTY_LAYOUT, 'study', -1)).toBeNull()
    const item = moveNavItem(EMPTY_LAYOUT, 'study', '/backlog', -1)!
    expect(navItemsOf(item, 'study')).toEqual(['/', '/backlog', '/focus', '/practice'])
    expect(checkStudentLayout(item).problems).toEqual([])
    const hidden = toggleNavHidden(EMPTY_LAYOUT, '/pyqs')!
    expect(hidden.nav?.hidden).toEqual(['/pyqs'])
    expect(toggleNavHidden(hidden, '/pyqs')!.nav).toBeUndefined()
    expect(toggleNavHidden(EMPTY_LAYOUT, '/')).toBeNull()
    expect(toggleNavHidden(EMPTY_LAYOUT, '/settings')).toBeNull()
    expect(toggleNavHidden(EMPTY_LAYOUT, '/control-panel')).toBeNull()
  })

  it('sets and clears tokens that the validator accepts', async () => {
    const { setToken } = await import('./layout-ops')
    const doc = setToken(setToken(EMPTY_LAYOUT, 'light:accent', '#225588'), 'radius', '14px')
    expect(doc.tokens).toEqual({ 'light:accent': '#225588', radius: '14px' })
    expect(checkStudentLayout(doc).problems).toEqual([])
    expect(checkStudentLayout(setToken(EMPTY_LAYOUT, 'accent', '#225588')).problems.length).toBeGreaterThan(0)
    expect(setToken(setToken(doc, 'light:accent', null), 'radius', null).tokens).toBeUndefined()
  })
})
