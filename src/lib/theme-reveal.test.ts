// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isThemeRevealRunning, revealThemeChange, THEME_REVEAL_MS } from './theme-reveal'

type Doc = { startViewTransition?: unknown }

function mockMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: reduced && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
}

afterEach(() => {
  delete (document as unknown as Doc).startViewTransition
  const root = document.documentElement
  root.classList.remove('theme-revealing')
  root.style.removeProperty('--theme-reveal-x')
  root.style.removeProperty('--theme-reveal-y')
  root.style.removeProperty('--theme-reveal-r')
  root.style.removeProperty('--theme-reveal-duration')
  vi.restoreAllMocks()
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

  it('sets CSS reveal geometry synchronously before startViewTransition and ignores presses while running', async () => {
    mockMotion(false)
    let finish!: () => void
    const finished = new Promise<void>(resolve => { finish = resolve })
    const start = vi.fn((cb: () => void) => {
      // Geometry and class must already be on <html> before the pseudo-tree is created (Frame-0 lock).
      const root = document.documentElement
      expect(root.classList.contains('theme-revealing')).toBe(true)
      expect(root.style.getPropertyValue('--theme-reveal-x')).toMatch(/^\d+px$/)
      expect(root.style.getPropertyValue('--theme-reveal-y')).toMatch(/^\d+px$/)
      expect(root.style.getPropertyValue('--theme-reveal-r')).toMatch(/^\d+px$/)
      expect(root.style.getPropertyValue('--theme-reveal-duration')).toBe(`${THEME_REVEAL_MS}ms`)
      cb()
      return { ready: new Promise<void>(() => {}), finished }
    })
    ;(document as unknown as Doc).startViewTransition = start
    const update = vi.fn()
    revealThemeChange(button(), update)
    revealThemeChange(button(), update)
    expect(start).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
    finish(); await finished; await Promise.resolve(); await Promise.resolve()
    expect(isThemeRevealRunning()).toBe(false)
    expect(document.documentElement.classList.contains('theme-revealing')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--theme-reveal-x')).toBe('')
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

  it('uses pure CSS keyframes (no WAAPI .ready race) and cleanly handles 6 consecutive switches without sticking', async () => {
    mockMotion(false)
    const animate = vi.fn()
    document.documentElement.animate = animate as unknown as typeof document.documentElement.animate
    const update = vi.fn()

    for (let i = 0; i < 6; i++) {
      let finish!: () => void
      const finished = new Promise<void>(resolve => { finish = resolve })
      ;(document as unknown as Doc).startViewTransition = vi.fn((cb: () => void) => {
        cb()
        return { ready: Promise.resolve(), finished }
      })
      revealThemeChange(button(), update)
      await Promise.resolve()
      finish()
      await finished
      await Promise.resolve()
      await Promise.resolve()
      expect(isThemeRevealRunning()).toBe(false)
      expect(document.documentElement.classList.contains('theme-revealing')).toBe(false)
      expect(document.documentElement.style.getPropertyValue('--theme-reveal-duration')).toBe('')
    }

    expect(update).toHaveBeenCalledTimes(6)
    expect(animate).not.toHaveBeenCalled()
    expect(THEME_REVEAL_MS).toBeGreaterThanOrEqual(500)
  })

  it('releases the lock and clears custom properties when transition.ready rejects (AbortError)', async () => {
    mockMotion(false)
    const start = vi.fn((cb: () => void) => {
      cb()
      return { ready: Promise.reject(new DOMException('Aborted', 'AbortError')), finished: new Promise<void>(() => {}) }
    })
    ;(document as unknown as Doc).startViewTransition = start
    const update = vi.fn()
    revealThemeChange(button(), update)
    await Promise.resolve()
    await Promise.resolve()
    expect(isThemeRevealRunning()).toBe(false)
    expect(document.documentElement.classList.contains('theme-revealing')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--theme-reveal-r')).toBe('')
  })
})
