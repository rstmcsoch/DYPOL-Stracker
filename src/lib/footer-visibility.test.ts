import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { showsBrandFooter } from './brand-footer'

describe('brand footer visibility', () => {
  it('shows only on Home, Profile and Settings', () => {
    for (const path of ['/', '/profile', '/settings', '/profile/', '/settings/']) expect(showsBrandFooter(path)).toBe(true)
    for (const path of ['/syllabus', '/tests', '/analytics', '/focus', '/backlog', '/practice', '/pyqs', '/planner', '/revision', '/decks', '/mistakes', '/retry', '/weak-areas', '/backup', '/mock-analysis', '/study-now', '/nope'])
      expect(showsBrandFooter(path)).toBe(false)
  })

  it('uses one shared page-end spacing instead of stacked per-page gaps', () => {
    const layout = readFileSync('src/styles/layout.css', 'utf8')
    const base = readFileSync('src/styles/base.css', 'utf8')
    expect(layout).toContain('--page-bottom-clearance: calc(var(--fab-bottom) + var(--fab-size) + var(--fab-gap))')
    expect(layout).toContain('.dashboard-page { padding-bottom: 0; }')
    expect(layout).toMatch(/\.page-wrap \{ flex: 0 0 auto; padding-bottom: var\(--page-end-gap\); \}/)
    expect(layout).toMatch(/\.app-footer \{ margin-top: 0; margin-bottom: 0;/)
    expect(base).toContain('.main-area::after { content: \'\'; display: block; flex: none; height: var(--page-bottom-clearance); }')
  })
})
