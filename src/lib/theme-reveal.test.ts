// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isThemeRevealRunning, revealThemeChange } from './theme-reveal'

type Doc = { startViewTransition?: unknown }

function mockMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: reduced && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
}

afterEach(() => {
  delete (document as unknown as Doc).startViewTransition
  document.documentElement.classList.remove('theme-revealing')
})

describe('revealThemeChange', () => {
  const button = () => document.createElement('button')

  it('switches instantly when the View Transitions API is missing', () => {
    mockMotion(false)
    const update = vi.fn()
    revealThemeChange(button(), update)
    expect(update).toHaveBeenCalledTimes(1)
    expect(isThemeRevealRunning()).toBe(false)
  })

  it('switches instantly for reduced motion, without a view transition', () => {
    mockMotion(true)
    const start = vi.fn()
    ;(document as unknown as Doc).startViewTransition = start
    const update = vi.fn()
    revealThemeChange(button(), update)
    expect(update).toHaveBeenCalledTimes(1)
    expect(start).not.toHaveBeenCalled()
  })

  it('reveals through a view transition and ignores presses while it runs', async () => {
    mockMotion(false)
    let finish!: () => void
    const finished = new Promise<void>(resolve => { finish = resolve })
    const start = vi.fn((cb: () => void) => { cb(); return { ready: new Promise<void>(() => {}), finished } })
    ;(document as unknown as Doc).startViewTransition = start
    const update = vi.fn()
    revealThemeChange(button(), update)
    revealThemeChange(button(), update)
    expect(start).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(document.documentElement.classList.contains('theme-revealing')).toBe(true)
    finish(); await finished; await Promise.resolve(); await Promise.resolve()
    expect(isThemeRevealRunning()).toBe(false)
    expect(document.documentElement.classList.contains('theme-revealing')).toBe(false)
  })

  it('skips the reveal when the light/dark mode would not change', () => {
    mockMotion(false)
    const start = vi.fn()
    ;(document as unknown as Doc).startViewTransition = start
    const update = vi.fn()
    revealThemeChange(button(), update, false)
    expect(start).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
  })
})
