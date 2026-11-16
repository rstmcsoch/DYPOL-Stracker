// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SiteContentProvider } from '../contexts/SiteContentContext'
import { BUILTIN_SECTIONS } from '../lib/site-editor/model'
import LandingPage from './LandingPage'

beforeAll(() => {
  class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
  vi.stubGlobal('IntersectionObserver', Observer)
})
afterEach(cleanup)

function renderWith(document: unknown) {
  const { container } = render(<MemoryRouter><SiteContentProvider overrides={{}} document={document}><LandingPage /></SiteContentProvider></MemoryRouter>)
  return container
}

const order = (container: HTMLElement) => [...container.querySelectorAll('main [data-sb]')].filter(node => !node.parentElement?.closest('[data-sb]')).map(node => node.getAttribute('data-sb'))

describe('homepage page document', () => {
  it('renders every Stracker section in the shipped order with no document', () => {
    const container = renderWith(null)
    expect(order(container)).toEqual(BUILTIN_SECTIONS.home.filter(section => section.id !== 'home-video' || container.querySelector('[data-sb="home-video"]')).map(section => section.id))
    expect(screen.getByText('JEE', { selector: '.hp-exams-track:first-child li' })).toBeTruthy()
  })

  it('applies stored order, hidden sections and structured lists', () => {
    const blocks = BUILTIN_SECTIONS.home.map(section => ({ id: section.id, type: section.type })).reverse() as Array<Record<string, unknown>>
    blocks.find(block => block.id === 'home-ai')!.hidden = true
    blocks.find(block => block.id === 'home-exams')!.props = { items: ['GATE', 'Custom exam'], label: 'Made for' }
    const container = renderWith({ schemaVersion: 1, pages: { home: { blocks } } })
    const ids = order(container)
    expect(ids[0]).toBe('home-final')
    expect(ids).not.toContain('home-ai')
    expect(screen.getByText('Made for')).toBeTruthy()
    expect(screen.getAllByText('Custom exam').length).toBeGreaterThan(0)
  })

  it('renders editor blocks from the lazy chunk, escaping text', async () => {
    const blocks = [
      { id: 'note-1', type: 'heading', props: { text: 'Fresh **heading**', level: '2', highlight: '' } },
      ...BUILTIN_SECTIONS.home.map(section => ({ id: section.id, type: section.type })),
      { id: 'bad', type: 'paragraph', props: { text: '<script>alert(1)</script>' } }
    ]
    const container = renderWith({ schemaVersion: 1, pages: { home: { blocks } } })
    await waitFor(() => expect(container.querySelector('[data-sb="note-1"]')).not.toBeNull())
    expect(container.querySelector('[data-sb="note-1"] strong')?.textContent).toBe('heading')
    expect(container.querySelector('[data-sb="bad"]')?.textContent).toBe('')
    expect(container.querySelector('script')).toBeNull()
  })

  it('renders card lists from document items (hidden ones skipped) and counts modules from them', () => {
    const blocks = BUILTIN_SECTIONS.home.map(section => ({ id: section.id, type: section.type })) as Array<Record<string, unknown>>
    blocks.find(block => block.id === 'home-features')!.props = { items: [
      { icon: 'target', title: 'Doc feature one', summary: 'S1', points: ['P1'], image: '', alt: '', hidden: false },
      { icon: 'timer', title: 'Doc feature hidden', summary: 'S2', points: [], image: '', alt: '', hidden: true },
      { icon: 'timer', title: 'Doc feature two', summary: 'S3', points: [], image: '', alt: '', hidden: false }
    ] }
    blocks.find(block => block.id === 'home-how')!.props = { items: [{ title: 'Only step', body: 'Do it', hidden: false }] }
    blocks.find(block => block.id === 'home-privacy')!.props = { items: [{ title: 'Private point', body: 'Body', hidden: false }] }
    blocks.find(block => block.id === 'home-principles')!.props = { items: [{ icon: 'check', title: 'Doc principle', body: 'Body', hidden: false }] }
    const container = renderWith({ schemaVersion: 1, pages: { home: { blocks } } })
    expect([...container.querySelectorAll('#feature-list > li h3')].map(node => node.textContent)).toEqual(['Doc feature one', 'Doc feature two'])
    expect(container.querySelector('#feature-list [data-se-prop="items.2.title"]')).not.toBeNull()
    expect(container.querySelectorAll('.hp-step-list > li')).toHaveLength(1)
    expect(screen.getByText('Private point')).toBeTruthy()
    expect(screen.getByText('Doc principle')).toBeTruthy()
    // The stats strip's {modules} counts the visible document items.
    expect(container.querySelector('[data-sb="home-stats"] strong')?.textContent).toBe('2')
  })
})
