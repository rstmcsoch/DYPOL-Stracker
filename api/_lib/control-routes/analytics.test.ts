import { describe, expect, it, vi } from 'vitest'

const seen = vi.hoisted(() => ({ options: null as unknown, methods: [] as string[] }))
vi.mock('../control.js', () => ({
  recordAuditEvent: async () => true,
  requireRecentMfa: async () => undefined,
  controlHandler: async (_req: unknown, res: { statusCode?: number; end: (b: string) => void }, methods: string[], options: unknown) => {
    seen.options = options; seen.methods = methods
    // Simulate the real gate refusing a request without an owner session.
    res.statusCode = 401; res.end(JSON.stringify({ error: 'unauthenticated' }))
  }
}))

const { analyticsHandler, parseFilters } = await import('./analytics.js')
const { CONFIG_SCHEMAS, funnelSchema, customReportSchema } = await import('../../../src/lib/telemetry/report-config.js')

describe('analytics owner route', () => {
  it('is gated by the owner-only control handler at aal2 and never runs without it', async () => {
    let body = ''
    const res = { statusCode: 0, setHeader: () => undefined, end: (text: string) => { body = text } }
    await analyticsHandler({ method: 'GET', url: '/api/control/operations?route=analytics&report=overview', headers: {} } as never, res as never)
    expect(seen.options).toEqual({ requireAal2: true })
    expect(seen.methods).toEqual(['GET', 'PUT'])
    expect(res.statusCode).toBe(401)
    expect(body).toContain('unauthenticated')
  })

  it('validates filters and defaults to IST, production, non-test', () => {
    const { report, preset, filters } = parseFilters(new URLSearchParams('report=nope&preset=bad&device=fridge&path=/<script>&env=x'))
    expect([report, preset]).toEqual(['overview', '7d'])
    expect(filters).toMatchObject({ timeZone: 'Asia/Kolkata', env: 'production', device: null, route: null, includeTest: false, compare: false })
    expect(parseFilters(new URLSearchParams('path=/tests/:id&test=1&compare=1&tz=UTC')).filters).toMatchObject({ route: '/tests/:id', includeTest: true, compare: true, timeZone: 'UTC' })
  })

  it('accepts only closed-list definitions (no SQL)', () => {
    expect(funnelSchema.safeParse({ id: 'ok-1', name: 'x', steps: [{ name: 'page_view' }] }).success).toBe(false)
    expect(funnelSchema.safeParse({ id: 'ok-1', name: 'x', steps: [{ name: 'page_view' }, { name: 'drop table' }] }).success).toBe(false)
    expect(customReportSchema.safeParse({ id: 'r-1', name: 'x', event: null, measure: 'events', dimension: 'route; select 1', limit: 5 }).success).toBe(false)
    expect(CONFIG_SCHEMAS['overview.widgets'].safeParse(['kpi_visitors']).success).toBe(true)
  })
})
