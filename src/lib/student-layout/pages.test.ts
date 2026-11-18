import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMPONENTS, COMPONENT_MAP, STUDENT_PAGES } from './registry'
import { checkStudentLayout } from './validate'

const PAGES_DIR = join(process.cwd(), 'src/pages')
const sources = readdirSync(PAGES_DIR).filter(file => file.endsWith('Page.tsx')).map(file => readFileSync(join(PAGES_DIR, file), 'utf8'))
const sourceFor = (id: string) => sources.find(source => source.includes(`usePageSlots('${id}')`))

describe('per-page student components', () => {
  const pages = STUDENT_PAGES.filter(page => page.id !== 'home' && page.id !== 'shell')

  it('registers every page with slots wired into its source', () => {
    expect(pages).toHaveLength(STUDENT_PAGES.length - 2)
    for (const page of pages) {
      const source = sourceFor(page.id)
      expect(source, page.id).toBeTruthy()
      for (const def of COMPONENTS.filter(entry => entry.parent === page.id && entry.id !== `${page.id}.header` && !entry.id.endsWith('.labels'))) {
        const key = def.id.slice(page.id.length + 1)
        expect(source, def.id).toContain(`sl.attrs('${key}')`)
        if (def.caps.hideable) expect(source, def.id).toContain(`sl.hidden('${key}')`)
      }
    }
  })

  it('keeps header defaults identical to the shipped wording', () => {
    for (const page of pages) {
      const header = COMPONENT_MAP.get(`${page.id}.header`)
      if (!header) continue
      const source = sourceFor(page.id)!
      expect(source, page.id).toContain(`layoutId="${page.id}.header"`)
      for (const field of Object.values(header.text ?? {})) expect(source, `${page.id}: ${field.default}`).toContain(field.default.slice(0, 30))
    }
  })

  it('keeps sections in their functional order and data unreachable', () => {
    for (const def of COMPONENTS.filter(entry => entry.page !== 'home' && entry.page !== 'shell' && entry.parent && entry.parent === entry.page)) {
      expect(def.caps.reorderable, def.id).toBe(false)
    }
    const { problems } = checkStudentLayout({ schemaVersion: 1, components: { 'tests.board': { text: { records: 'x' } }, 'analytics.kpis': { props: { score: 99 } }, 'tests.header': { text: { title: 'My tests' } } } })
    expect(problems.some(problem => problem.path.startsWith('components.tests.board'))).toBe(true)
    expect(problems.some(problem => problem.path.startsWith('components.analytics.kpis'))).toBe(true)
    expect(problems.some(problem => problem.path.startsWith('components.tests.header'))).toBe(false)
    expect(checkStudentLayout({ schemaVersion: 1, components: { 'tests.board': { hidden: true } } }).problems.length).toBeGreaterThan(0)
    expect(checkStudentLayout({ schemaVersion: 1, components: { 'tests.summary': { hidden: true } } }).problems).toEqual([])
  })
})

describe('static page wording', () => {
  const all = readdirSync(PAGES_DIR).filter(file => file.endsWith('.tsx') && !file.includes('.test.')).map(file => readFileSync(join(PAGES_DIR, file), 'utf8'))
  const COMPONENTS_DIRS = ['src/components/jee', 'src/components/ai', 'src/components']
  for (const dir of COMPONENTS_DIRS) for (const file of readdirSync(join(process.cwd(), dir)).filter(name => name.endsWith('.tsx') && !name.includes('.test.'))) all.push(readFileSync(join(process.cwd(), dir, file), 'utf8'))

  it('registers every wrapped label with its shipped wording as the default', () => {
    let count = 0
    for (const source of all) {
      for (const match of source.matchAll(/<T k="([a-z-]+):([^"]+)">\{("(?:[^"\\]|\\.)*")\}<\/T>/g)) {
        const field = COMPONENT_MAP.get(`${match[1]}.labels`)?.text?.[match[2]!]
        expect(field?.default, `${match[1]}:${match[2]}`).toBe(JSON.parse(match[3]!))
        count += 1
      }
    }
    expect(count).toBeGreaterThan(400)
  })

  it('only wraps literal text, and label keys never look like data fields', () => {
    for (const source of all) {
      for (const match of source.matchAll(/<(?:T|Label) k=\{`([^`]+)`\}>\{([^}]+)\}<\/(?:T|Label)>/g)) {
        expect(['tab.label', 'mode.label', 'wording'], match[0]).toContain(match[2])
      }
    }
    const pattern = /^(value|values|data|source|binding|bind|query|record|records|student|user|name|email|date|dates|time|timer|marks?|scores?|percent(age)?|count|counts|streak|progress|total|days?|minutes|result|results|notes?|exam|tasks?)$/i
    for (const def of COMPONENTS.filter(entry => entry.id.endsWith('.labels'))) {
      for (const key of Object.keys(def.text ?? {})) expect(pattern.test(key), `${def.id}:${key}`).toBe(false)
      expect(def.data).toBeUndefined()
    }
    const { problems } = checkStudentLayout({ schemaVersion: 1, components: { 'settings.labels': { text: { 'tab-account': 'Profile & login', 'not-a-label': 'x' } } } })
    expect(problems.map(problem => problem.path)).toEqual([expect.stringContaining('not-a-label')])
  })
})
