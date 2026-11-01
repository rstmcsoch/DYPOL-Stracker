// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, beforeEach } from 'vitest'
import { SiteContentProvider } from '../contexts/SiteContentContext'
import { InfoLinks } from '../components/public/InfoLinks'
import { SITE_CONTENT_DEFAULTS, SITE_CONTENT_FIELDS } from './site-content/registry'
import { validateFieldValue } from './site-content/content'
import { infoParagraphs } from './site-content/info-pages'
import { groupedChapterOptions } from './planner-fields'
import { hiddenSeriesKey, loadHiddenSeries } from './analytics-legend'
import InfoPage from '../pages/InfoPage'

const read = (path: string) => readFileSync(path, 'utf8')

afterEach(cleanup)

function links(overrides: Record<string, string>, homepageAnchor = false) {
  render(<MemoryRouter><SiteContentProvider overrides={overrides}><InfoLinks homepageAnchor={homepageAnchor} /></SiteContentProvider></MemoryRouter>)
  const found = screen.queryAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])
  cleanup()
  return found
}

describe('item 1: footer information links', () => {
  it('ships no page text and keeps the bodies optional', () => {
    for (const kind of ['about', 'terms', 'privacy']) {
      expect(SITE_CONTENT_DEFAULTS[`public.footer.${kind}.body`]).toBe('')
      const field = SITE_CONTENT_FIELDS.find(item => item.key === `public.footer.${kind}.body`)!
      expect(field.optional).toBe(true)
      expect(validateFieldValue(field, '')).toEqual({ ok: true, value: '' })
    }
  })

  it('hides About and Terms until written; Privacy falls back to the homepage section', () => {
    expect(links({}, true)).toEqual([['Privacy', '#privacy']])
    expect(links({})).toEqual([['Privacy', '/privacy']])
  })

  it('shows owner-written pages', () => {
    expect(links({ 'public.footer.terms.body': 'T', 'public.footer.about.body': 'A', 'public.footer.privacy.body': 'P' }, true))
      .toEqual([['Privacy', '/privacy'], ['Terms', '/terms'], ['About', '/about']])
  })

  it('renders owner text as paragraphs and 404s an unwritten page', () => {
    expect(infoParagraphs('One\n\n Two \n\n\n')).toEqual(['One', 'Two'])
    const { unmount } = render(<MemoryRouter><SiteContentProvider overrides={{ 'public.footer.terms.body': 'First.\n\nSecond.' }}><InfoPage kind="terms" /></SiteContentProvider></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Terms' })).toBeTruthy()
    expect(screen.getByText('Second.')).toBeTruthy()
    unmount()
    render(<MemoryRouter><SiteContentProvider overrides={{}}><InfoPage kind="about" /></SiteContentProvider></MemoryRouter>)
    expect(screen.getByText(/PAGE NOT FOUND/)).toBeTruthy()
  })

  it('routes the pages explicitly (no catch-all) and links them from the notebook footer', () => {
    const vercel = JSON.parse(read('vercel.json')) as { rewrites: { source: string; destination: string }[] }
    for (const path of ['/privacy', '/terms', '/about']) expect(vercel.rewrites).toContainEqual({ source: path, destination: '/index.html' })
    expect(vercel.rewrites.some(rule => rule.source === '/(.*)')).toBe(false)
    expect(read('src/components/AppShell.tsx')).toContain('<InfoLinks />')
  })
})

describe('item 2: Cmd+K test result', () => {
  it('opens that test\'s own detail view', () => {
    expect(read('src/components/AppShell.tsx')).toContain("type: 'Test', to: `/tests?view=${encodeURIComponent(test.id)}`")
  })
})

describe('item 3: General chapters grouped by subject', () => {
  it('puts a heading row before each subject\'s chapters', () => {
    const rows = groupedChapterOptions([
      { id: 'c1', subject: 'Chemistry', name: 'Mole Concept' },
      { id: 'p1', subject: 'Physics', name: 'Electrostatics' }
    ], ['Physics', 'Chemistry'])
    expect(rows).toEqual([
      { kind: 'heading', subject: 'Physics' }, { kind: 'chapter', id: 'p1', label: 'Physics · Electrostatics' },
      { kind: 'heading', subject: 'Chemistry' }, { kind: 'chapter', id: 'c1', label: 'Chemistry · Mole Concept' }
    ])
  })
})

describe('item 4: weekly goals over target', () => {
  it('shows the real percentage and an over badge', () => {
    const planner = read('src/pages/PlannerPage.tsx')
    expect(planner).toContain('{Math.round(rawPct)}% of target')
    expect(planner).toContain('+{fmtNumber(over, 1)} over')
  })
})

describe('item 5: analytics hidden legend series persist', () => {
  beforeEach(() => localStorage.clear())
  it('reads back what was stored per user and ignores junk', () => {
    localStorage.setItem(hiddenSeriesKey('u1'), JSON.stringify(['Physics', 3]))
    expect(loadHiddenSeries('u1')).toEqual(['Physics'])
    expect(loadHiddenSeries('u2')).toEqual([])
    localStorage.setItem(hiddenSeriesKey('u3'), 'not json')
    expect(loadHiddenSeries('u3')).toEqual([])
  })
})
