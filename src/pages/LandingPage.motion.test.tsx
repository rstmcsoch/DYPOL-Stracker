// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { NotebookPreview } from '../components/public/NotebookPreview'
import { AiSection } from '../components/public/LandingSections'
import LandingPage from './LandingPage'

const homeCss = readFileSync(`${process.cwd()}/src/styles/home.css`, 'utf8')

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('sample task ticks', () => {
  it('counts ticks and celebrates only on the transition into all three done', () => {
    mockReducedMotion(false)
    const { container } = render(<NotebookPreview />)
    const tasks = screen.getAllByRole('button')
    expect(tasks).toHaveLength(3)
    const count = () => container.querySelector('.hp-task-count')?.textContent
    const confetti = () => container.querySelectorAll('.hp-confetti i').length
    const before = tasks.filter(task => task.getAttribute('aria-pressed') === 'true').length
    expect(count()).toBe(String(before))

    tasks.forEach(task => { if (task.getAttribute('aria-pressed') !== 'true' && task !== tasks[2]) fireEvent.click(task) })
    expect(confetti()).toBe(0)
    if (tasks[2]?.getAttribute('aria-pressed') !== 'true') fireEvent.click(tasks[2]!)
    expect(count()).toBe('3')
    expect(screen.getByText(/All 3 done/)).toBeTruthy()
    expect(confetti()).toBeGreaterThan(0)
  })

  it('never fires confetti when the visitor prefers reduced motion', () => {
    mockReducedMotion(true)
    const { container } = render(<NotebookPreview />)
    screen.getAllByRole('button').forEach(task => { if (task.getAttribute('aria-pressed') !== 'true') fireEvent.click(task) })
    expect(container.querySelector('.hp-task-count')?.textContent).toBe('3')
    expect(container.querySelectorAll('.hp-confetti i')).toHaveLength(0)
  })
})

describe('AI example exchange', () => {
  it('shows the whole exchange statically without IntersectionObserver or with reduced motion', () => {
    mockReducedMotion(true)
    const { container } = render(<MemoryRouter><AiSection /></MemoryRouter>)
    expect(container.querySelector('.hp-chat')?.className).toContain('is-static')
    expect(screen.getByText(/Illustrative exchange/)).toBeTruthy()
    expect(container.textContent).toContain('Which topics are pulling my recent mock scores down?')
  })

  it('plays question, typing and answer once the panel enters the viewport', () => {
    mockReducedMotion(false)
    vi.useFakeTimers()
    let trigger: (entries: Array<{ isIntersecting: boolean }>) => void = () => {}
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof trigger) { trigger = callback }
      observe() {}
      disconnect() {}
      unobserve() {}
    })
    const { container } = render(<MemoryRouter><AiSection /></MemoryRouter>)
    const chat = () => container.querySelector('.hp-chat')?.className ?? ''
    expect(chat()).toContain('is-idle')
    act(() => trigger([{ isIntersecting: true }]))
    expect(chat()).toContain('is-ask')
    act(() => { vi.advanceTimersByTime(700) })
    expect(chat()).toContain('is-typing')
    act(() => { vi.advanceTimersByTime(1300) })
    expect(chat()).toContain('is-answer')
  })
})

describe('homepage redesign scope', () => {
  it('scopes every homepage rule to the signed-out page', () => {
    const rules = homeCss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '').replace(/:(?:where|is|not)\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '')
    const selectors = [...rules.matchAll(/(^|[{}])\s*([^{}@]+)\{/g)].map(match => match[2]!.trim()).filter(Boolean)
    const unscoped = selectors.flatMap(group => group.split(',').map(part => part.trim())).filter(part => part && !/\.pub-hp|\.hp-|^(?:from|to|\d+%)/.test(part))
    expect(unscoped).toEqual([])
  })

  it('keeps universal exam positioning without inventing counts', () => {
    const { container } = render(<MemoryRouter initialEntries={['/']}><LandingPage /></MemoryRouter>)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/18\+|10 features|JEE-only|for JEE aspirants/i)
    expect(container.querySelectorAll('.hp-note')).toHaveLength(4)
    expect(container.querySelector('#dypol-labs')).not.toBeNull()
  })
})

describe('homepage page end and footer', () => {
  it('keeps decorations from extending the page and hides the ruled body backdrop', () => {
    expect(homeCss).toMatch(/\.pub-page\.pub-hp \{ overflow: clip; \}/)
    expect(homeCss).toContain('body:has(.pub-hp)::before { display: none; }')
    const motion = readFileSync(`${process.cwd()}/src/components/public/home-motion.ts`, 'utf8')
    expect(motion).toContain('PARALLAX_MAX')
  })

  it('labels the information column Legal', () => {
    const { container } = render(<MemoryRouter initialEntries={['/']}><LandingPage /></MemoryRouter>)
    const headings = [...container.querySelectorAll('footer h2, footer h3, footer h4, footer p, footer strong')].map(node => node.textContent?.trim())
    expect(headings).toContain('Legal')
    expect(headings).not.toContain('Information')
  })
})


describe('homepage decorations', () => {
  it('has no four-point sparkle decoration', () => {
    const { container } = render(<MemoryRouter initialEntries={['/']}><LandingPage /></MemoryRouter>)
    const decorative = [...container.querySelectorAll('[aria-hidden="true"]')].map(node => node.textContent ?? '')
    expect(decorative.some(text => text.includes('✦'))).toBe(false)
  })
})
