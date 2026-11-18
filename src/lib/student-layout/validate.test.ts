import { describe, expect, it } from 'vitest'
import { COMPONENTS, COMPONENT_MAP, DATA_KEY_PATTERN, STUDENT_PAGES } from './registry'
import { checkStudentLayout, sanitizeStudentLayout } from './validate'
import { compileStudentLayoutCss } from './compile-css'
import { APP_SECTION_PATHS } from '../app-routes'

const doc = (extra: Record<string, unknown>) => ({ schemaVersion: 1, ...extra })
const codes = (raw: unknown) => checkStudentLayout(raw).problems.map(problem => problem.code)

describe('student layout registry', () => {
  it('covers every student route plus the shell', () => {
    const paths = STUDENT_PAGES.map(page => page.path).filter(Boolean)
    expect(paths).toEqual(expect.arrayContaining(['/', ...APP_SECTION_PATHS]))
    expect(paths).toHaveLength(APP_SECTION_PATHS.length + 1)
    for (const page of STUDENT_PAGES) expect(COMPONENT_MAP.get(page.id)?.kind).toBe('page')
  })

  it('never declares a data-bound key as editable text or option', () => {
    for (const def of COMPONENTS) {
      for (const key of [...Object.keys(def.text ?? {}), ...Object.keys(def.props ?? {})]) {
        expect(DATA_KEY_PATTERN.test(key), `${def.id}.${key}`).toBe(false)
        expect(Object.keys(def.data ?? {}), `${def.id}.${key}`).not.toContain(key)
      }
    }
  })

  it('has a consistent tree', () => {
    for (const def of COMPONENTS) {
      for (const child of def.children ?? []) expect(COMPONENT_MAP.get(child)?.parent, child).toBe(def.id)
      if (def.parent) expect(COMPONENT_MAP.get(def.parent)?.children, def.id).toContain(def.id)
      if (def.caps.required) expect(def.caps.hideable, def.id).toBe(false)
    }
  })
})

describe('checkStudentLayout', () => {
  it('accepts presentation changes', () => {
    const raw = doc({
      components: {
        'home.streak': { hidden: true, text: { subtitle: 'day streak' }, style: { padding: '12px' }, responsive: { mobile: { fontSize: '1rem' } } },
        'home.syllabus': { props: { subjectRows: 3 } },
        'home.countdown': { style: { background: 'token:paper-soft', borderRadius: '20px' } }
      },
      order: { 'home.hero': ['home.streak', 'home.countdown'] },
      nav: { groups: ['planning', 'study', 'syllabus', 'tests', 'revision'], items: { study: ['/', '/practice', '/focus', '/backlog'] }, hidden: ['/backlog'] },
      tokens: { 'light:accent': '#335599', 'dark:accent': '#99aaff', radius: '12px' }
    })
    const { document, problems } = checkStudentLayout(raw)
    expect(problems).toEqual([])
    expect(document?.components?.['home.streak']?.text).toEqual({ subtitle: 'day streak' })
    expect(document?.order?.['home.hero']).toEqual(['home.streak', 'home.countdown'])
  })

  it('drops values equal to the shipped defaults', () => {
    const { document } = checkStudentLayout(doc({ components: { 'home.streak': { text: { subtitle: 'current study streak' } } }, order: { 'home.hero': ['home.countdown', 'home.streak'] } }))
    expect(document?.components).toBeUndefined()
    expect(document?.order).toBeUndefined()
  })

  it('refuses any attempt to set live student data', () => {
    expect(codes(doc({ components: { 'home.streak': { text: { current: '99' } } } }))).toContain('data_locked')
    expect(codes(doc({ components: { 'home.countdown': { text: { daysLeft: '10' } } } }))).toContain('data_locked')
    expect(codes(doc({ components: { 'home.checkpoint': { text: { marks: '300 / 300' } } } }))).toContain('data_locked')
    expect(codes(doc({ components: { 'home.header': { text: { name: 'Asha' } } } }))).toContain('data_locked')
    expect(codes(doc({ components: { 'home.study-time': { props: { minutes: 600 } } } }))).toContain('data_locked')
    expect(codes(doc({ components: { 'home.today-plan': { value: 'x' } } }))).toContain('data_locked')
    expect(codes(doc({ components: { 'home.tip': { data: { tip: 'fake advice' } } } }))).toContain('data_locked')
    expect(codes(doc({ components: { 'home.revisions': { text: { date: '2026-01-01' } } } }))).toContain('data_locked')
    expect(codes(doc({ student: { name: 'x' } }))).toContain('data_locked')
  })

  it('protects required components', () => {
    expect(codes(doc({ components: { 'home.today-plan': { hidden: true } } }))).toContain('required')
    expect(codes(doc({ components: { 'home.countdown': { style: { display: 'hide' } } } }))).toContain('required')
    expect(codes(doc({ components: { 'shell.sidebar': { responsive: { mobile: { opacity: '0.1' } } } } }))).toContain('required')
    expect(codes(doc({ components: { 'home.focus': { style: { height: '0px' } } } }))).toContain('required')
    expect(codes(doc({ nav: { hidden: ['/settings'] } }))).toContain('required')
    expect(codes(doc({ nav: { hidden: ['/'] } }))).toContain('required')
  })

  it('rejects unsafe or malformed input', () => {
    expect(codes(doc({ components: { 'home.streak': { text: { subtitle: '<img onerror=x>' } } } }))).toContain('invalid_text')
    expect(codes(doc({ components: { 'home.streak': { text: { subtitle: '{streak.current}' } } } }))).toContain('invalid_text')
    expect(codes(doc({ components: { 'home.tip': { text: { cta: 'javascript:alert(1)' } } } }))).toContain('invalid_text')
    expect(codes(doc({ components: { 'home.streak': { style: { background: 'url(https://x)' } } } }))).toContain('invalid_style')
    expect(codes(doc({ components: { 'home.streak': { style: { padding: '1px;color:red' } } } }))).toContain('invalid_style')
    expect(codes(doc({ components: { 'home.fake': {} } }))).toContain('unknown_component')
    expect(codes(doc({ order: { 'home.hero': ['home.streak', 'home.streak'] } }))).toContain('invalid_order')
    expect(codes(doc({ order: { home: ['home.header'] } }))).toContain('invalid_order')
    expect(codes(doc({ nav: { items: { study: ['/', '/focus', '/backlog', '/tests'] } } }))).toContain('invalid_order')
    expect(codes(doc({ nav: { routes: { '/': '/evil' } } }))).toContain('unknown')
    expect(codes(doc({ tokens: { 'light:accent': 'red;}' } }))).toContain('invalid_token')
    expect(codes(doc({ tokens: { accent: '#fff' } }))).toContain('invalid_token')
    expect(codes({ schemaVersion: 1, components: { 'home.tip': { text: { cta: 'x'.repeat(300_000) } } } })).toContain('too_large')
    expect(codes([])).toContain('invalid')
  })

  it('renders leniently: invalid pieces fall back to the shipped layout', () => {
    const cleaned = sanitizeStudentLayout(doc({ components: { 'home.streak': { hidden: true, text: { current: '99' } }, 'home.today-plan': { hidden: true } } }))
    expect(cleaned?.components).toEqual({ 'home.streak': { hidden: true } })
    expect(sanitizeStudentLayout(doc({}))).toBeNull()
    expect(sanitizeStudentLayout('nope')).toBeNull()
  })
})

describe('compileStudentLayoutCss', () => {
  it('scopes components, devices and palette tokens', () => {
    const { document } = checkStudentLayout(doc({
      components: { 'home.streak': { style: { padding: '12px' }, responsive: { tablet: { columns: '2' }, mobile: { display: 'hide' } } } },
      tokens: { 'light:accent': '#335599', radius: '12px' }
    }))
    const css = compileStudentLayoutCss(document)
    expect(css).toContain('.app-shell [data-sl="home.streak"]')
    expect(css).toContain('@media (max-width: 1024px)')
    expect(css).toContain('@media (max-width: 640px)')
    expect(css).toContain(":root:not([data-color]):not([data-theme='dark']){--accent:#335599}")
    expect(css).toContain(':root:root{--radius:12px}')
    expect(css).not.toMatch(/font-family|--reading-font/)
  })
})
