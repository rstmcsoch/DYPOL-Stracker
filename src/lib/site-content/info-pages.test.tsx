// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SiteContentProvider } from '../../contexts/SiteContentContext'
import InfoPage from '../../pages/InfoPage'
import { infoBlocks } from './info-pages'
import { DEFAULT_ABOUT_BODY, DEFAULT_PRIVACY_BODY, DEFAULT_TERMS_BODY } from './info-page-defaults'

afterEach(cleanup)

describe('information page text format', () => {
  it('turns plain text into headings, lists, the date and paragraphs', () => {
    expect(infoBlocks('Last updated: 14 November 2026\n\nIntro.\n\n## What we keep\n\n- one\n- two\n\n## What we keep')).toEqual([
      { kind: 'updated', text: 'Last updated: 14 November 2026' },
      { kind: 'paragraph', text: 'Intro.' },
      { kind: 'heading', text: 'What we keep', id: 'what-we-keep' },
      { kind: 'list', items: ['one', 'two'] },
      { kind: 'heading', text: 'What we keep', id: 'what-we-keep-2' }
    ])
  })
})

describe('built-in page text is specific to Stracker and invents nothing', () => {
  const all = [DEFAULT_PRIVACY_BODY, DEFAULT_TERMS_BODY, DEFAULT_ABOUT_BODY]

  it('names no email address, phone number or postal address', () => {
    for (const body of all) {
      expect(body).not.toMatch(/@/)
      expect(body).not.toMatch(/\+91|\b\d{10}\b/)
      expect(body).not.toMatch(/[<>]/)
    }
  })

  it('serves many exams, not only JEE', () => {
    for (const exam of ['NEET UG', 'MHT CET', 'CA', 'Class']) expect(DEFAULT_ABOUT_BODY).toContain(exam)
    expect(DEFAULT_PRIVACY_BODY).toContain('NEET UG')
  })

  it('discloses the real processors, AI routing and analytics behaviour', () => {
    for (const fact of ['Supabase', 'Vercel', 'three.dev', 'DeepSeek, Qwen, NVIDIA', 'Do Not Track', 'Global Privacy Control', 'AES-256-GCM', 'IndexedDB', 'Row-level security', 'does not delete your login']) {
      expect(DEFAULT_PRIVACY_BODY).toContain(fact)
    }
    expect(DEFAULT_TERMS_BODY).toContain('can be wrong')
  })

  it('renders the Privacy Policy with a table of contents and anchored headings', () => {
    render(<MemoryRouter><SiteContentProvider overrides={{}}><InfoPage kind="privacy" /></SiteContentProvider></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeTruthy()
    expect(screen.getByText('Last updated: 14 November 2026')).toBeTruthy()
    const toc = screen.getByRole('navigation', { name: 'On this page' })
    expect(toc.querySelectorAll('a').length).toBeGreaterThan(8)
    expect(screen.getByRole('heading', { level: 2, name: /^AI observability with three\.dev$/ }).id).toBe(`ai-observability-with-three${'-'}dev`)
    expect(screen.getByRole('navigation', { name: 'More about Stracker' }).textContent).toBe('TermsAboutContact')
  })
})

describe('public page navigation', () => {
  const pages = <MemoryRouter initialEntries={['/privacy']}><SiteContentProvider overrides={{}}><Routes>
    <Route path="/privacy" element={<InfoPage kind="privacy" />} />
    <Route path="/terms" element={<InfoPage kind="terms" />} />
  </Routes></SiteContentProvider></MemoryRouter>
  const top = { top: 0, left: 0, behavior: 'instant' }

  it('opens the next page at its top, instantly, with focus on its heading', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    render(pages)
    expect(scrollTo).toHaveBeenCalledWith(top)
    expect(document.activeElement?.tagName).not.toBe('H1')
    scrollTo.mockClear()
    fireEvent.click(screen.getByRole('navigation', { name: /more about stracker/i }).querySelector('a[href="/terms"]')!)
    expect(screen.getByRole('heading', { level: 1, name: 'Terms & Conditions' })).toBe(document.activeElement)
    expect(scrollTo).toHaveBeenCalledWith(top)
    expect(document.documentElement.style.scrollBehavior).toBe('')
    scrollTo.mockRestore()
  })

  it('also returns to the top when the link of the page already open is clicked', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    render(pages)
    scrollTo.mockClear()
    fireEvent.click(screen.getByRole('contentinfo').querySelector('a[href="/privacy"]')!)
    expect(scrollTo).toHaveBeenCalledWith(top)
    scrollTo.mockRestore()
  })

  it('keeps manual scroll restoration only while a public page is open', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    window.history.scrollRestoration = 'auto'
    const view = render(pages)
    expect(window.history.scrollRestoration).toBe('manual')
    view.unmount()
    expect(window.history.scrollRestoration).toBe('auto')
    scrollTo.mockRestore()
  })
})
