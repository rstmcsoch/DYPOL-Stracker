// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ToastProvider, useToast } from './ToastContext'

afterEach(cleanup)

function Probe({ times }: { times: number }) {
  const { notify } = useToast()
  return <button type="button" onClick={() => { for (let i = 0; i < times; i += 1) notify('Weekly goal saved.') }}>bump</button>
}

describe('toast stacking', () => {
  it('replaces an identical toast instead of stacking one per press', () => {
    render(<ToastProvider><Probe times={4} /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'bump' }))
    const toasts = screen.getAllByRole('status')
    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.textContent).toContain('Weekly goal saved.')
  })
})
