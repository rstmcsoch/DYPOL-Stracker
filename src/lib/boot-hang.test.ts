import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { isChunkLoadError, reloadOnce, withChunkRecovery } from './chunk-recovery'
import { whenPageSettled, SW_REGISTER_DELAY_MS } from './offline-shell'

const memory = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) } } }

describe('stuck "Just a moment…" recovery', () => {
  it('recognises stale or failed chunk errors only', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/LandingPage-abc.js'))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/a.css'))).toBe(true)
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
  })

  it('reloads at most once per minute', () => {
    const storage = memory(); const reload = vi.fn()
    expect(reloadOnce(storage, reload, 1_000_000)).toBe(true)
    expect(reloadOnce(storage, reload, 1_030_000)).toBe(false)
    expect(reloadOnce(storage, reload, 1_070_000)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('recovers a chunk that never answers, without touching one that loads', async () => {
    vi.useFakeTimers()
    const recover = vi.fn(() => true)
    void withChunkRecovery(() => new Promise(() => {}), 8000, recover)()
    vi.advanceTimersByTime(7999); expect(recover).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1); expect(recover).toHaveBeenCalledTimes(1)
    const ok = vi.fn(() => true)
    await expect(withChunkRecovery(() => Promise.resolve('page'), 8000, ok)()).resolves.toBe('page')
    vi.advanceTimersByTime(10_000); expect(ok).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('rejects normally when recovery is not possible', async () => {
    await expect(withChunkRecovery(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: x')), 8000, () => false)()).rejects.toThrow(/dynamically imported/)
  })

  it('registers the service worker only after load and a delay, so its precache never competes with the first page', () => {
    vi.useFakeTimers()
    const listeners: Record<string, () => void> = {}
    const task = vi.fn()
    const win = { document: { readyState: 'loading' }, addEventListener: (name: string, fn: () => void) => { listeners[name] = fn }, setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) } as unknown as Window
    whenPageSettled(task, win)
    vi.advanceTimersByTime(60_000); expect(task).not.toHaveBeenCalled()
    listeners.load!()
    vi.advanceTimersByTime(SW_REGISTER_DELAY_MS); expect(task).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('wires the safety nets into the app', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toContain("const LandingPage = lazy(withChunkRecovery(() => import('./pages/LandingPage')))")
    expect(app).toContain('<ChunkErrorBoundary><AppRoutes /></ChunkErrorBoundary>')
    expect(readFileSync('src/main.tsx', 'utf8')).toContain('installChunkErrorRecovery()')
    const auth = readFileSync('src/contexts/AuthContext.tsx', 'utf8')
    expect(auth).toContain('AUTH_RESTORE_TIMEOUT_MS = 5_000')
    expect(auth).toContain('useState(() => !supabase || mayHaveSession())')
  })
})
