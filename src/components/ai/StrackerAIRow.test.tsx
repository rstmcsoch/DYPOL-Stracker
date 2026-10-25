// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrackerAIRow, STRACKER_UNAVAILABLE_COPY } from './StrackerAIRow'

const status = (overrides = {}) => ({ name: 'Stracker AI', model: 'Flash Lite', status: 'ready' as const, preferred: true, dailyLimit: 40, usedToday: 3, ...overrides })

describe('StrackerAIRow', () => {
  afterEach(cleanup)
  it('shows only the brand, model and availability, with no edit or remove', () => {
    render(<StrackerAIRow stracker={status()} preferred />)
    expect(screen.getByText('Stracker AI (Default)')).toBeTruthy()
    expect(screen.getByText('Flash Lite')).toBeTruthy()
    expect(screen.getByText('Ready')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /edit|remove|delete/i })).toBeNull()
    expect(document.body.textContent).not.toMatch(/admin|owner|api key|base url/i)
  })

  it('warns when unavailable and offers to add an own model', () => {
    const onAddOwn = vi.fn()
    render(<StrackerAIRow stracker={status({ status: 'unavailable' })} preferred={false} onAddOwn={onAddOwn} />)
    expect(screen.getByText(STRACKER_UNAVAILABLE_COPY)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /add your own model/i }))
    expect(onAddOwn).toHaveBeenCalledOnce()
  })
})

describe('Add-your-own-model prompts in the chat', () => {
  afterEach(cleanup)
  it('the header button hides only while the chat is served by the student’s own model', async () => {
    const { chatServedByOwnModel, hasOwnModel } = await import('./AIExperience')
    expect(hasOwnModel([])).toBe(false)
    expect(hasOwnModel([{ id: 'own' }])).toBe(true)
    // Own model added but the default is answering: keep the button.
    expect(chatServedByOwnModel({ activeProviderId: 'stracker' })).toBe(false)
    expect(chatServedByOwnModel({ lastReplyProviderId: 'stracker', activeProviderId: 'gemini' })).toBe(false)
    // Own model in use (selected, last reply, or answering now): hide it.
    expect(chatServedByOwnModel({ activeProviderId: 'gemini' })).toBe(true)
    expect(chatServedByOwnModel({ lastReplyProviderId: 'custom', activeProviderId: 'stracker' })).toBe(true)
    // Live switch: the default takes over mid-chat, so the button returns.
    expect(chatServedByOwnModel({ liveProviderId: 'stracker', lastReplyProviderId: 'gemini' })).toBe(false)
    expect(chatServedByOwnModel({})).toBe(false)
  })

  it('the unavailable notice points a student with their own model to check it, not to add one', async () => {
    const { StrackerUnavailableNotice, STRACKER_UNAVAILABLE_OWN_COPY } = await import('./StrackerAIRow')
    const onCheckOwn = vi.fn()
    render(<StrackerUnavailableNotice ownModel onCheckOwn={onCheckOwn} onAddOwn={vi.fn()} />)
    expect(screen.getByText(STRACKER_UNAVAILABLE_OWN_COPY)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /add your own model/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /check your model/i }))
    expect(onCheckOwn).toHaveBeenCalledOnce()
  })
})
