import { describe, expect, it } from 'vitest'
import { BLOCK_SPEC_LIST } from './blocks-spec'
import { compileBlocksCss } from './compile-css'
import { BUILTIN_SECTIONS, defaultPage, resolvePage, type SiteDocument } from './model'
import { checkSiteDocument, sanitizeSiteDocument } from './validate'

const IMG = 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/homepage-media/site/image/12345678-1234-1234-1234-123456789abc.png'

function doc(blocks: unknown[], extra: Record<string, unknown> = {}): unknown {
  return { schemaVersion: 1, pages: { home: { blocks } }, ...extra }
}

const home = () => defaultPage('home').blocks

describe('page document model', () => {
  it('renders the shipped page when nothing is stored', () => {
    expect(resolvePage(null, 'home').blocks.map(block => block.id)).toEqual(BUILTIN_SECTIONS.home.map(section => section.id))
  })

  it('keeps stored order and puts back missing Stracker sections', () => {
    const stored = doc([{ id: 'home-final', type: 'stracker.final' }, { id: 'home-hero', type: 'stracker.hero', hidden: true }])
    const ids = resolvePage(stored, 'home').blocks.map(block => block.id)
    expect(ids[0]).toBe('home-final')
    expect(ids).toHaveLength(BUILTIN_SECTIONS.home.length)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('drops a Stracker section placed on the wrong page and duplicates', () => {
    const stored = { schemaVersion: 1, pages: { about: { blocks: [{ id: 'home-hero', type: 'stracker.hero' }, { id: 'about-doc', type: 'stracker.doc' }, { id: 'about-doc', type: 'stracker.doc' }] } } }
    expect(resolvePage(stored, 'about').blocks.map(block => block.id)).toEqual(['about-doc'])
  })
})

describe('strict document validation', () => {
  it('accepts every block type with its defaults', () => {
    const blocks = [...home(), ...BLOCK_SPEC_LIST.map((spec, index) => ({ id: `b-${index}`, type: spec.type, props: spec.defaults() }))]
    const { problems } = checkSiteDocument(doc(blocks))
    expect(problems).toEqual([])
  })

  it('rejects markup, script links and unknown blocks', () => {
    const { problems } = checkSiteDocument(doc([
      ...home(),
      { id: 'x1', type: 'paragraph', props: { text: '<img src=x onerror=alert(1)>' } },
      { id: 'x2', type: 'button', props: { label: 'Go', href: 'javascript:alert(1)', variant: 'primary', size: 'md', arrow: false } },
      { id: 'x3', type: 'script', props: {} },
      { id: 'x4', type: 'image', props: { src: 'https://evil.example/x.png' } },
      { id: 'x5', type: 'heading', props: { text: 'Hi', level: '1' } },
      { id: 'x6', type: 'paragraph', props: { text: 'ok', onclick: 'x' } }
    ]))
    const paths = problems.map(problem => problem.path)
    expect(paths.some(path => path.includes('blocks[12].props.text'))).toBe(true)
    expect(paths.some(path => path.includes('blocks[13].props.href'))).toBe(true)
    expect(problems.some(problem => problem.message.includes('not a supported block'))).toBe(true)
    expect(paths.some(path => path.includes('blocks[15].props.src'))).toBe(true)
    expect(paths.some(path => path.includes('blocks[16].props.level'))).toBe(true)
    expect(paths.some(path => path.includes('blocks[17].props.onclick'))).toBe(true)
  })

  it('rejects unsafe styles and accepts whitelisted ones', () => {
    const bad = checkSiteDocument(doc([...home(), { id: 's1', type: 'container', style: { background: 'red;}body{display:none', behavior: 'x', padding: '10px; color: red', backgroundImage: 'https://evil.example/a.png' } }]))
    expect(bad.problems).toHaveLength(4)
    const good = checkSiteDocument(doc([...home(), { id: 's1', type: 'container', style: { background: 'token:mint', padding: '12px 2rem', borderRadius: '18px', backgroundImage: IMG }, responsive: { mobile: { padding: '8px', display: 'hide' } } }]))
    expect(good.problems).toEqual([])
  })

  it('rejects duplicate ids, deep nesting and oversized documents', () => {
    expect(checkSiteDocument(doc([...home(), { id: 'd', type: 'divider' }, { id: 'd', type: 'divider' }])).problems.length).toBe(1)
    let nested: Record<string, unknown> = { id: 'n9', type: 'container' }
    for (let level = 8; level >= 0; level -= 1) nested = { id: `n${level}`, type: 'container', children: [nested] }
    expect(checkSiteDocument(doc([...home(), nested])).problems.some(problem => problem.message.includes('nested'))).toBe(true)
    const huge = doc([...home(), ...Array.from({ length: 400 }, (_, index) => ({ id: `p${index}`, type: 'paragraph', props: { text: 'x'.repeat(900) } }))])
    expect(checkSiteDocument(huge).problems[0]?.message).toMatch(/too large/)
  })

  it('validates tables and charts', () => {
    const table = { caption: '', header: true, striped: true, bordered: true, scroll: true, padding: 'md', columns: [{ label: 'A', align: 'left', width: 'auto', hidden: false }], rows: [['1'], ['<b>']] }
    expect(checkSiteDocument(doc([...home(), { id: 't', type: 'table', props: { table } }])).problems).toHaveLength(1)
    const chart = { kind: 'pie', title: 'T', labels: ['a', 'b'], series: [{ name: 's', color: 'mint', values: [1, 'NaN'] }] }
    expect(checkSiteDocument(doc([...home(), { id: 'c', type: 'chart', props: { chart } }])).problems).toHaveLength(1)
  })

  it('lenient read keeps the valid parts', () => {
    const clean = sanitizeSiteDocument(doc([...home(), { id: 'ok', type: 'heading', props: { text: 'Hello', level: '2' } }, { id: 'bad', type: 'nope' }])) as SiteDocument
    const ids = clean.pages.home?.blocks.map(block => block.id) ?? []
    expect(ids).toContain('ok')
    expect(ids).not.toContain('bad')
  })
})

describe('style compiler', () => {
  it('emits scoped rules with real media queries and theme tokens', () => {
    const { document } = checkSiteDocument(doc([...home(), { id: 'cols', type: 'columns', props: { columns: 3, tablet: 2, mobile: 1, gap: 'md' }, style: { padding: '24px' }, responsive: { tablet: { padding: '16px' }, mobile: { display: 'hide' } } }], { tokens: { 'light:paper': '#ffffff', 'dark:paper': '#000000' } }))
    const css = compileBlocksCss(document.pages.home?.blocks ?? [], document.tokens)
    expect(css).toContain('[data-sb="cols"][data-sb]{padding:24px}')
    expect(css).toContain('@media (max-width: 1024px){.pub-page [data-sb="cols"][data-sb]{padding:16px}}')
    expect(css).toContain('@media (max-width: 640px){.pub-page [data-sb="cols"][data-sb]{display:none !important}}')
    expect(css.indexOf(':not([data-public-theme=\'dark\'])')).toBeLessThan(css.indexOf("[data-public-theme='dark']{"))
  })
})
