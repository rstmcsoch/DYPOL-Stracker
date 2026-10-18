// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { nextScrollExpanded, useScrollExpanded } from './scroll-expand'

describe('nextScrollExpanded', () => {
  it('expands on scroll down and collapses on scroll up', () => {
    expect(nextScrollExpanded(false, 100, 140)).toBe(true)
    expect(nextScrollExpanded(true, 400, 300)).toBe(false)
  })
  it('ignores jitter below the threshold', () => {
    expect(nextScrollExpanded(true, 300, 296)).toBe(true)
    expect(nextScrollExpanded(false, 300, 305)).toBe(false)
  })
  it('is always the compact circle near the top', () => {
    expect(nextScrollExpanded(true, 10, 20)).toBe(false)
    expect(nextScrollExpanded(true, 400, 0)).toBe(false)
  })
})

describe('useScrollExpanded', () => {
  it('follows window scroll direction, one update per animation frame', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frames.push(cb); return frames.length })
    const { result, unmount } = renderHook(() => useScrollExpanded())
    const scrollTo = (y: number) => { Object.defineProperty(window, 'scrollY', { value: y, configurable: true }); window.dispatchEvent(new Event('scroll')) }
    const flush = () => act(() => { frames.splice(0).forEach(cb => cb(0)) })
    expect(result.current).toBe(false)
    scrollTo(200); scrollTo(260)
    expect(frames).toHaveLength(1)
    flush()
    expect(result.current).toBe(true)
    scrollTo(120); flush()
    expect(result.current).toBe(false)
    scrollTo(400); flush()
    expect(result.current).toBe(true)
    scrollTo(5); flush()
    expect(result.current).toBe(false)
    unmount()
    vi.restoreAllMocks()
  })
})
