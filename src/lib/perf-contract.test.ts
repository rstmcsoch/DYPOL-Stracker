import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { advanceRetry, retryDueOn, startRetry } from './mistake-cause'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

describe('full-stack speed contract', () => {
  it('splits heavy vendor libraries into cacheable chunks while preserving PWA and 404 invariants', () => {
    const vite = read('vite.config.ts')
    expect(vite).toContain('manualChunks:')
    for (const chunk of ['vendor-react', 'vendor-supabase', 'vendor-query', 'vendor-dexie', 'vendor-charts', 'vendor-icons', 'vendor-export']) {
      expect(vite).toContain(`'${chunk}'`)
    }
    expect(vite).toContain("fileName: '404.html'")
    expect(vite).toContain("globIgnores: ['404.html']")
    expect(vite).toContain("handler: 'NetworkFirst'")
  })

  it('paints immediately from cached/default site status and pauses polling in background tabs', () => {
    const ctx = read('src/components/site/SiteStatusContext.tsx')
    expect(ctx).not.toContain('useState(false)\n  const [teamMember')
    expect(ctx).toContain('ready: true')
    expect(ctx).toContain('stracker-site-status-v1')
    expect(ctx).toContain("document.visibilityState === 'visible'")
  })

  it('keeps the signed-in notebook provider stack out of the public entry chunk', () => {
    const app = read('src/App.tsx')
    expect(app).toContain("const ProtectedAppShell = lazy(withChunkRecovery(() => import('./components/ProtectedAppShell')))")
    expect(app).not.toContain("from './contexts/DataContext'")
    expect(app).not.toContain("from './contexts/AIContext'")
    expect(app).not.toContain("from './components/AppShell'")
    const shell = read('src/components/ProtectedAppShell.tsx')
    expect(shell).toContain('<DataProvider key={user.id}>')
    expect(shell).toContain('<AccountNoticeGate key={user.id} userId={user.id} />')
  })

  it('prefetches public and auth routes on SiteLink hover/focus/press while blocking protocol-relative URLs', () => {
    const siteLink = read('src/components/public/SiteLink.tsx')
    expect(siteLink).toContain('preloadPublicRoute(href)')
    expect(siteLink).toContain('onPointerEnter={warm}')
    expect(siteLink).toContain('onPointerDown={warm}')
    expect(siteLink).toContain('onFocus={warm}')
    expect(siteLink).toContain("!href.startsWith('//')")
  })

  it('uses fast IST date helpers without per-item Intl.DateTimeFormat allocations in HomeSnapshot and mistake-cause', () => {
    const snapshot = read('src/components/jee/HomeSnapshot.tsx')
    expect(snapshot).not.toContain('new Intl.DateTimeFormat')
    expect(snapshot).toContain('indiaDate(session.started_at)')
    expect(snapshot).toContain('useMemo(() => computeReminders(data, today), [data, today])')

    const spy = vi.spyOn(Intl, 'DateTimeFormat')
    expect(retryDueOn({ created_at: '2026-10-01T18:30:00.000Z' })).toBe('2026-10-09')
    expect(retryDueOn({ created_at: '2026-10-01T18:29:59.999Z' })).toBe('2026-10-08')
    expect(startRetry('2026-10-08', 0)).toEqual({ retry_due_on: '2026-10-15', retry_count: 0 })
    expect(advanceRetry('2026-10-08', 0)).toMatchObject({ retry_count: 1, retry_due_on: '2026-10-29' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
