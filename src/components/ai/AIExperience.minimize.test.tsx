// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { clearAIDraft } from './aiDraft'

const holder = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('../../contexts/AIContext', () => ({ useAI: () => holder.current }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test-user' } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ notify: vi.fn() }) }))

import { AIExperience } from './AIExperience'

function FakeAI({ hideLauncher = false }: { hideLauncher?: boolean }) {
  const [panel, setPanel] = useState({ panelOpen: true, minimized: false, largeOpen: false })
  holder.current = {
    ...panel,
    openPanel: () => setPanel({ panelOpen: true, minimized: false, largeOpen: false }),
    restorePanel: () => setPanel(p => ({ ...p, panelOpen: true, minimized: false })),
    minimizePanel: () => setPanel({ panelOpen: false, minimized: true, largeOpen: false }),
    closePanel: () => setPanel({ panelOpen: false, minimized: false, largeOpen: false }),
    expandPanel: () => setPanel(p => ({ ...p, panelOpen: true, largeOpen: true })),
    collapseLarge: () => setPanel(p => ({ ...p, largeOpen: false })),
    conversationTitle: 'New conversation', conversationId: null, clearConversation: vi.fn(), newConversation: vi.fn(),
    isBusy: false, backendStatus: 'ok', messages: [], activeTask: null, providers: [], providersLoading: false,
    stracker: { status: 'ready', model: 'test' }, preference: 'stracker', lastRequest: null,
    sendMessage: vi.fn(), stopTask: vi.fn(), retryLast: vi.fn(), confirmAction: vi.fn(),
    recentConversations: [], recentTasks: [], openConversation: vi.fn(), loadConversations: vi.fn(),
  }
  return <MemoryRouter><p data-testid="page">Page</p><AIExperience hideLauncher={hideLauncher} /></MemoryRouter>
}

const tap = (el: Element) => {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5, button: 0 }))
  el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 5, clientY: 5, button: 0 }))
}
const composer = () => screen.getByLabelText('Message Stracker AI') as HTMLTextAreaElement

beforeAll(() => {
  // Reduced motion: exit transitions finish at once, so the state is checked synchronously.
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia
  Element.prototype.scrollIntoView = () => {}
})
afterEach(() => { cleanup(); clearAIDraft() })

describe('Stracker AI window: minimise keeps the session and draft', () => {
  it('a click outside minimises (not closes) and the unsent draft survives restore', () => {
    render(<FakeAI />)
    fireEvent.change(composer(), { target: { value: 'Plan my physics revision' } })
    act(() => tap(screen.getByTestId('page')))
    expect(document.querySelector('.ai-floating-window')).toBeNull()
    const restore = screen.getByRole('button', { name: /restore ai assistant/i })
    fireEvent.click(restore)
    expect(composer().value).toBe('Plan my physics revision')
  })

  it('clicks inside the window do not minimise it', () => {
    render(<FakeAI />)
    act(() => tap(composer()))
    expect(document.querySelector('.ai-floating-window')).not.toBeNull()
  })

  it('Escape minimises the floating window and keeps the draft', () => {
    render(<FakeAI />)
    fireEvent.change(composer(), { target: { value: 'half a question' } })
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(document.querySelector('.ai-floating-window')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /restore ai assistant/i }))
    expect(composer().value).toBe('half a question')
  })

  it('the minimise button keeps the draft, the close button clears it', () => {
    render(<FakeAI />)
    fireEvent.change(composer(), { target: { value: 'keep me' } })
    fireEvent.click(screen.getByRole('button', { name: /minimize assistant/i }))
    fireEvent.click(screen.getByRole('button', { name: /restore ai assistant/i }))
    expect(composer().value).toBe('keep me')
    fireEvent.click(screen.getByRole('button', { name: /close assistant/i }))
    fireEvent.click(screen.getByRole('button', { name: /ask stracker/i }))
    expect(composer().value).toBe('')
  })

  it('the launcher steps aside while the quick-action menu is open', () => {
    render(<FakeAI hideLauncher />)
    act(() => tap(screen.getByTestId('page')))
    const wrap = document.querySelector('.ai-launcher-wrap') as HTMLElement
    expect(wrap.classList.contains('ai-launcher-hidden')).toBe(true)
    expect(wrap.getAttribute('aria-hidden')).toBe('true')
  })
})
