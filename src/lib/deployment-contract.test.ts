import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const viteConfig = read('vite.config.ts')
const appShell = read('src/components/AppShell.tsx')
const offlineShell = read('src/lib/offline-shell.ts')
const vercel = JSON.parse(read('vercel.json')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[]
  rewrites: { source: string; destination: string }[]
}

describe('production deployment freshness contract', () => {
  it('keeps the SPA entry and deployment metadata out of browser/CDN caches', () => {
    const appResponses = vercel.headers.find(rule => rule.source === '/(.*)')
    const appHeaders = new Map(appResponses?.headers.map(header => [header.key.toLowerCase(), header.value]))

    expect(appHeaders.get('cache-control')).toContain('no-store')
    expect(appHeaders.get('cache-control')).toContain('no-cache')
    expect(appHeaders.get('cache-control')).toContain('must-revalidate')
    expect(appHeaders.get('cdn-cache-control')).toBe('no-store')
    expect(appHeaders.get('vercel-cdn-cache-control')).toBe('no-store')
    expect(vercel.rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' })
  })

  it('gives only content-hashed Vite assets a long immutable cache lifetime', () => {
    const assets = vercel.headers.find(rule => rule.source === '/assets/(.*)')
    const assetHeaders = new Map(assets?.headers.map(header => [header.key.toLowerCase(), header.value]))

    expect(assetHeaders.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(assetHeaders.get('cdn-cache-control')).toBe('public, max-age=31536000, immutable')
    expect(assetHeaders.get('vercel-cdn-cache-control')).toBe('public, max-age=31536000, immutable')
  })

  it('uses network-first document navigation with the precached shell only as an offline fallback', () => {
    expect(viteConfig).toContain("registerType: 'autoUpdate'")
    expect(viteConfig).toContain('navigateFallback: null')
    expect(viteConfig).toContain("handler: 'NetworkFirst'")
    expect(viteConfig).toContain("request.mode === 'navigate'")
    expect(viteConfig).toContain("precacheFallback: { fallbackURL: '/index.html' }")
    expect(viteConfig).not.toContain('StaleWhileRevalidate')
    expect(viteConfig).not.toContain('networkTimeoutSeconds')
  })

  it('has no update prompt or forced reload path in the application shell', () => {
    expect(appShell).not.toMatch(/PwaUpdatePrompt|A fresh page is ready|onNeedRefresh|virtual:pwa-register/)
    expect(offlineShell).toContain('onNeedReload() {}')
    expect(offlineShell).not.toMatch(/location\.reload/)
  })
})
