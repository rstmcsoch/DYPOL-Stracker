// @vitest-environment jsdom
import { act, fireEvent, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { useExit } from './use-exit'

const motion = (reduce: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))

describe('useExit', () => {
  beforeEach(() => { vi.useFakeTimers(); motion(false) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('marks closed, then runs the callback once after the fallback timeout', () => {
    const done = vi.fn()
    const { result } = renderHook(() => useExit(150))
    act(() => result.current.exit(done))
    expect(result.current.state).toBe('closed')
    act(() => result.current.exit(done))
    expect(done).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(150) })
    expect(done).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('open')
  })

  it('unmounts on the element animationend, ignoring bubbled child animations', () => {
    function Harness() {
      const [open, setOpen] = useState(true)
      const { state, exit, onAnimationEnd } = useExit(1000)
      return open ? <div data-testid="panel" data-state={state} onAnimationEnd={onAnimationEnd}><span data-testid="child" /><button onClick={() => exit(() => setOpen(false))}>close</button></div> : <p>gone</p>
    }
    const view = render(<Harness />)
    fireEvent.click(view.getByText('close'))
    expect(view.getByTestId('panel').dataset.state).toBe('closed')
    fireEvent.animationEnd(view.getByTestId('child'))
    expect(view.queryByTestId('panel')).not.toBeNull()
    fireEvent.animationEnd(view.getByTestId('panel'))
    expect(view.getByText('gone')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(2000) })
  })

  it('runs immediately with prefers-reduced-motion', () => {
    motion(true)
    const done = vi.fn()
    const { result } = renderHook(() => useExit())
    act(() => result.current.exit(done))
    expect(done).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('open')
  })

  it('cleans up its timer on unmount without calling back', () => {
    const done = vi.fn()
    const { result, unmount } = renderHook(() => useExit(100))
    act(() => result.current.exit(done))
    unmount()
    vi.advanceTimersByTime(500)
    expect(done).not.toHaveBeenCalled()
  })
})
