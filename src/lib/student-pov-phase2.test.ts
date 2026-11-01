import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TOPIC_MAX, chapterGroups, topicCounterText } from './planner-fields'
import { revisionIntervalDays, revisionIntervalLabel } from './revision-labels'
import { formatStudiedDuration } from './focus-timer'
import { mistakeSubjectOptions } from './exams/subjects'
import { stableChapterOrder } from './syllabus-order'
import { APP_SECTION_PATHS, isKnownAppPath } from './app-routes'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

describe('item 14: Home clears the floating buttons', () => {
  it('pads the dashboard by the full FAB stack height using the safe-area-aware variables', () => {
    const css = read('src/styles/layout.css')
    const rule = css.match(/\.dashboard-page\s*\{[^}]*padding-bottom:\s*([^;]+);/)
    expect(rule?.[1]).toContain('var(--fab-bottom)')
    expect(rule?.[1]).toMatch(/2 \* var\(--fab-size\)/)
    expect(rule?.[1]).toContain('var(--fab-gap)')
    // The phone breakpoints fold the safe-area inset into --fab-bottom, so the padding follows it.
    expect(css).toMatch(/max-width: 700px\)[^}]*--fab-bottom: calc\([^)]*var\(--safe-bottom\)/)
  })
})

describe('item 15: General chapter picker groups by subject', () => {
  it('lists exam subjects first, then any other subject, each sorted by position', () => {
    const chapters = [
      { id: 'b', subject: 'Chemistry', name: 'Mole Concept', position: 0 },
      { id: 'a', subject: 'Physics', name: 'Optics', position: 2 },
      { id: 'c', subject: 'Physics', name: 'Kinematics', position: 1 },
      { id: 'd', subject: 'Biology', name: 'Cell', position: 0 }
    ]
    const groups = chapterGroups(chapters, ['Physics', 'Chemistry'])
    expect(groups.map(group => [group.subject, group.chapters.map(chapter => chapter.name)])).toEqual([
      ['Physics', ['Kinematics', 'Optics']], ['Chemistry', ['Mole Concept']], ['Biology', ['Cell']]
    ])
  })
})

describe('item 16: Planner topic counter', () => {
  it('counts live and warns near and at the 120-character limit', () => {
    expect(TOPIC_MAX).toBe(120)
    expect(topicCounterText(0)).toBe('0/120 characters')
    expect(topicCounterText(100)).toMatch(/100\/120 characters — nearly at the limit/)
    expect(topicCounterText(120)).toMatch(/120\/120 characters — limit reached/)
  })
})

describe('item 17: Revision interval labels', () => {
  it('shows the real step for each round of the default 1/7/30 schedule and repeats per cycle', () => {
    const gaps = [1, 7, 30]
    expect([1, 2, 3, 4].map(n => revisionIntervalLabel(n, gaps))).toEqual(['R1 · 1d', 'R2 · 7d', 'R3 · 30d', 'R4 · 1d'])
    expect(revisionIntervalDays(2, [2, 5])).toBe(5)
    expect(revisionIntervalDays(1, [])).toBeNull()
    expect(revisionIntervalLabel(3, [])).toBe('R3')
  })
})

describe('item 18: exact studied duration', () => {
  it('shows seconds and minutes exactly without rounding up', () => {
    expect(formatStudiedDuration(33)).toBe('33s')
    expect(formatStudiedDuration(134)).toBe('2m 14s')
    expect(formatStudiedDuration(18 * 60)).toBe('18m')
    expect(formatStudiedDuration(3903)).toBe('1h 5m 3s')
    expect(formatStudiedDuration(59.9)).toBe('59s')
    expect(formatStudiedDuration(-4)).toBe('0s')
  })
})

describe('item 19: mistake subjects follow the exam', () => {
  it('uses the exam subjects plus any subject that already has chapters', () => {
    expect(mistakeSubjectOptions(['Physics', 'Chemistry', 'Biology'], [{ subject: 'Physics' }, { subject: 'English' }]))
      .toEqual(['Physics', 'Chemistry', 'Biology', 'English'])
  })
})

describe('item 21: stable syllabus order', () => {
  const row = (id: string, subject: string, position: number, name = id) => ({ chapter: { id, subject, position, name } })
  it('orders by subject then saved position, regardless of input order', () => {
    const rows = [row('c2', 'Chemistry', 0), row('p2', 'Physics', 1), row('m1', 'Maths', 0), row('p1', 'Physics', 0)]
    const order = ['Physics', 'Chemistry', 'Maths']
    const ids = stableChapterOrder(rows, order).map(item => item.chapter.id)
    expect(ids).toEqual(['p1', 'p2', 'c2', 'm1'])
    expect(stableChapterOrder([...rows].reverse(), order).map(item => item.chapter.id)).toEqual(ids)
  })
  it('places subjects outside the exam after it, alphabetically, and never mixes subjects', () => {
    const ids = stableChapterOrder([row('z', 'Zoology', 0), row('e', 'English', 0), row('p', 'Physics', 5)], ['Physics']).map(item => item.chapter.id)
    expect(ids).toEqual(['p', 'e', 'z'])
  })
})

describe('item 24: unknown addresses', () => {
  it('knows exactly the notebook sections that vercel.json serves', () => {
    const vercel = JSON.parse(read('vercel.json')) as { rewrites: { source: string; destination: string }[] }
    const served = vercel.rewrites.filter(rule => rule.destination === '/index.html').map(rule => rule.source)
    for (const path of APP_SECTION_PATHS) expect(served).toContain(path)
    expect(isKnownAppPath('/')).toBe(true)
    expect(isKnownAppPath('/syllabus')).toBe(true)
    expect(isKnownAppPath('/syllabus/')).toBe(true)
    expect(isKnownAppPath('/does-not-exist')).toBe(false)
    expect(isKnownAppPath('/mistakes/abc')).toBe(false)
  })
  it('emits dist/404.html as the app shell instead of adding a catch-all rewrite', () => {
    const viteConfig = read('vite.config.ts')
    expect(viteConfig).toMatch(/fileName: '404\.html'/)
    expect(viteConfig).toContain("bundle['index.html']")
    expect(viteConfig).toContain("globIgnores: ['404.html']")
    const app = read('src/App.tsx')
    expect(app).not.toMatch(/path="\*" element=\{<Navigate/)
    expect(app.match(/path="\*" element=\{<NotFoundPage/g)?.length).toBe(2)
  })
})
