// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { clearAIDraft } from './aiDraft'
import type { AIMessage } from '../../contexts/AIContext'
import { CONTINUE_ANSWER_PROMPT } from '../../lib/ai/output-truncate'

const holder = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock('../../contexts/AIContext', () => ({ useAI: () => holder.current }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test-user' } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ notify: vi.fn() }) }))

import { AIExperience } from './AIExperience'

const sendMessage = vi.fn()
const retryLast = vi.fn()

function message(overrides: Partial<AIMessage> = {}): AIMessage {
  return {
    id: 'a1', role: 'assistant', content: '| Chapter | Score |\n| --- | --- |\n| Oscillations | 62',
    status: 'completed', providerId: 'stracker', modelId: 'Google Gemini', createdAt: '2026-11-23T10:00:00.000Z',
    ...overrides
  }
}

function renderChat(overrides: Record<string, unknown> = {}) {
  holder.current = {
    panelOpen: true, minimized: false, largeOpen: true,
    openPanel: vi.fn(), restorePanel: vi.fn(), minimizePanel: vi.fn(), closePanel: vi.fn(),
    expandPanel: vi.fn(), collapseLarge: vi.fn(),
    conversationTitle: 'Study chat', conversationId: 'c1', clearConversation: vi.fn(), newConversation: vi.fn(),
    isBusy: false, backendStatus: 'ok', messages: [], activeTask: null, providers: [], providersLoading: false,
    stracker: { status: 'ready', model: 'Google Gemini' }, preference: 'stracker', lastRequest: { message: 'Plan', pageContext: '/analytics' },
    sendMessage, stopTask: vi.fn(), retryLast, confirmAction: vi.fn(),
    recentConversations: [], recentTasks: [], openConversation: vi.fn(), loadConversations: vi.fn(),
    ...overrides
  }
  return render(<MemoryRouter><AIExperience hideLauncher /></MemoryRouter>)
}

beforeAll(() => {
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia
  Element.prototype.scrollIntoView = () => {}
})
afterEach(() => { cleanup(); clearAIDraft(); sendMessage.mockClear(); retryLast.mockClear() })

describe('Stracker AI send, switch notice and continue', () => {
  it('labels the composer button Send, never Retry last request, and does not retry from an empty send', () => {
    renderChat()
    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Retry last request/i })).toBeNull()
    expect((send as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(send.closest('form')!)
    expect(retryLast).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('shows Retry only on a failed answer, not on the send button', () => {
    renderChat({
      messages: [message({ status: 'failed', content: '', error: 'The request did not complete.' })]
    })
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Retry last request/i })).toBeNull()
  })

  it('hides a fake switch between the same Stracker AI (Default) labels', () => {
    renderChat({
      messages: [message({
        fallbackFrom: { providerId: 'stracker', providerName: 'Stracker AI (Default)', modelId: 'Google Gemini' }
      })]
    })
    expect(screen.queryByText(/Switched from/)).toBeNull()
  })

  it('offers Continue when an answer was cut short, and resuming sends the continue prompt', () => {
    renderChat({ messages: [message({ truncated: true })] })
    expect(screen.getByText('This answer was cut short.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(sendMessage).toHaveBeenCalledWith(CONTINUE_ANSWER_PROMPT, expect.any(String))
  })
})
