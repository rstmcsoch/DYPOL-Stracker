// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SiteContentProvider } from '../contexts/SiteContentContext'
import { ReasonSelect } from '../components/contact/ReasonSelect'
import ContactPage from './ContactPage'
import { PublicFooter } from '../components/public/PublicFooter'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function renderContact() {
  return render(<MemoryRouter initialEntries={['/contact']}><SiteContentProvider overrides={{}}><ContactPage /></SiteContentProvider></MemoryRouter>)
}

describe('custom reason dropdown', () => {
  it('is a listbox (not a native select) driven by the keyboard', () => {
    const onChange = vi.fn()
    render(<><span id="lbl">Reason</span><ReasonSelect value="" onChange={onChange} labelId="lbl" /></>)
    const trigger = screen.getByRole('button', { name: /Reason/ })
    expect(document.querySelector('select')).toBeNull()
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const options = screen.getAllByRole('option')
    expect(options.map(option => option.querySelector('strong')?.textContent)).toEqual(['Feature request', 'Bug report', 'Complaint', 'Copyright', 'Sponsorship', 'General query'])
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[0]!.id)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[1]!.id)
    fireEvent.keyDown(trigger, { key: 'End' })
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[5]!.id)
    fireEvent.keyDown(trigger, { key: 's' })
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[4]!.id)
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('sponsorship')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on Escape without choosing and supports clicking an option', () => {
    const onChange = vi.fn()
    render(<><span id="lbl">Reason</span><ReasonSelect value="bug_report" onChange={onChange} labelId="lbl" /></>)
    const trigger = screen.getByRole('button', { name: /Reason Bug report/ })
    fireEvent.click(trigger)
    expect(screen.getByRole('option', { name: /Bug report/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('option', { name: /Copyright/ }))
    expect(onChange).toHaveBeenCalledWith('copyright')
  })
})

describe('contact page', () => {
  const choose = (label: RegExp) => {
    fireEvent.click(screen.getByRole('button', { name: /Why are you contacting us/ }))
    fireEvent.click(screen.getByRole('option', { name: label }))
  }

  it('shows reason-specific fields and swaps them when the reason changes', () => {
    renderContact()
    expect(screen.queryByLabelText(/Steps to reproduce/)).toBeNull()
    choose(/Bug report/)
    expect(screen.getByLabelText(/Page or feature affected/)).toBeTruthy()
    expect(screen.getByLabelText(/Steps to reproduce/)).toBeTruthy()
    expect(screen.getByLabelText(/Device and browser/)).toBeTruthy()
    choose(/Copyright/)
    expect(screen.queryByLabelText(/Steps to reproduce/)).toBeNull()
    expect(screen.getByLabelText(/Where the content appears/)).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /good faith/ })).toBeTruthy()
    choose(/Sponsorship/)
    expect(screen.getByLabelText(/Organisation name/)).toBeTruthy()
    expect(screen.getByLabelText(/Your proposal/)).toBeTruthy()
    choose(/General query/)
    expect(document.querySelector('.contact-reveal')).toBeNull()
  })

  it('reveals with a CSS animation that is switched off for reduced motion', () => {
    const css = readFileSync(`${process.cwd()}/src/styles/public.css`, 'utf8')
    expect(css).toMatch(/\.contact-reveal \{[^}]*animation: contact-reveal-in/)
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/\.contact-reveal, \.reason-select-list \{ animation: none; \}/)
  })

  it('adds and removes up to five links', () => {
    renderContact()
    const add = () => fireEvent.click(screen.getByRole('button', { name: /Add a link/ }))
    for (let index = 0; index < 5; index += 1) add()
    expect(screen.getAllByRole('textbox', { name: /^Link \d/ })).toHaveLength(5)
    expect(screen.queryByRole('button', { name: /Add a link/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove link 2' }))
    expect(screen.getAllByRole('textbox', { name: /^Link \d/ })).toHaveLength(4)
  })

  it('refuses wrong file types and oversized files with a clear message', () => {
    renderContact()
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(input.accept).toContain('.pdf')
    fireEvent.change(input, { target: { files: [new File(['x'], 'clip.gif', { type: 'image/gif' })] } })
    expect(screen.getByRole('alert').textContent).toMatch(/not a PDF, JPG or PNG/)
    const big = new File(['x'], 'scan.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 })
    fireEvent.change(input, { target: { files: [big] } })
    expect(screen.getByRole('alert').textContent).toMatch(/larger than 10 MB/)
    fireEvent.change(input, { target: { files: [new File(['%PDF-'], 'notes.pdf', { type: 'application/pdf' })] } })
    expect(screen.getByText('notes.pdf')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove notes.pdf' }))
    expect(screen.queryByText('notes.pdf')).toBeNull()
  })

  it('validates before sending and shows the success state after the API accepts', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, id: 'x', uploads: [], finalised: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    renderContact()
    fireEvent.click(screen.getByRole('button', { name: /Send message/ }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText('Check the highlighted fields.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: 'Asha' } })
    fireEvent.change(screen.getByLabelText(/Email for our reply/), { target: { value: 'asha@example.com' } })
    choose(/General query/)
    fireEvent.change(screen.getByLabelText(/^Message/), { target: { value: 'How do I export my tests to CSV?' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Send message/ })) })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Message sent' })).toBeTruthy())
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body).toMatchObject({ action: 'start', name: 'Asha', reason: 'general_query', website: '', files: [] })
  })

  it('shows the server error and keeps the form when sending fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'rate_limited', message: 'You have sent several messages recently. Wait a while before sending another.' }), { status: 429, headers: { 'Content-Type': 'application/json' } })))
    renderContact()
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: 'Asha' } })
    fireEvent.change(screen.getByLabelText(/Email for our reply/), { target: { value: 'asha@example.com' } })
    choose(/Feature request/)
    fireEvent.change(screen.getByLabelText(/^Your idea/), { target: { value: 'Let me pin the planner to Home.' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Send message/ })) })
    await waitFor(() => expect(screen.getByText(/sent several messages recently/)).toBeTruthy())
    expect(screen.getByRole('button', { name: /Send message/ })).toBeTruthy()
  })

  it('keeps the honeypot out of sight and out of the tab order', () => {
    renderContact()
    const trap = document.getElementById('contact-website') as HTMLInputElement
    expect(trap.tabIndex).toBe(-1)
    expect(trap.closest('[aria-hidden="true"]')).toBeTruthy()
  })
})

describe('footer links', () => {
  it('the public footer links Privacy, Terms, About and Contact pages', () => {
    render(<MemoryRouter><SiteContentProvider overrides={{}}><PublicFooter /></SiteContentProvider></MemoryRouter>)
    for (const [name, href] of [['Privacy', '/privacy'], ['Terms', '/terms'], ['About', '/about'], ['Contact', '/contact']]) {
      expect(screen.getByRole('link', { name }).getAttribute('href')).toBe(href)
    }
  })

})
