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
    expect(pages).toHaveLength(18)
    for (const page of pages) {
      const source = sourceFor(page.id)
      expect(source, page.id).toBeTruthy()
      for (const def of COMPONENTS.filter(entry => entry.parent === page.id && entry.id !== `${page.id}.header`)) {
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
