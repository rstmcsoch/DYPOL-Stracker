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
