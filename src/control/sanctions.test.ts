import { describe, expect, it } from 'vitest'
import { resolveBan } from './sanctions'
import { sanctionRefusal } from '../lib/control-permissions'

const NOW = Date.parse('2026-11-14T10:00:00Z')
const choice = (preset: string, extra: Partial<{ amount: string; unit: 'minutes' | 'hours' | 'days'; untilLocal: string }> = {}) => ({ preset, amount: '2', unit: 'hours' as const, untilLocal: '', ...extra }) as Parameters<typeof resolveBan>[0]

describe('ban length choice', () => {
  it('maps presets, custom lengths and end times', () => {
    expect(resolveBan(choice('permanent'), 'UTC', NOW)).toEqual({ permanent: true })
    expect(resolveBan(choice('24h'), 'UTC', NOW)).toEqual({ permanent: false, until: '2026-11-15T10:00:00.000Z' })
    expect(resolveBan(choice('duration', { amount: '90', unit: 'minutes' }), 'UTC', NOW)).toEqual({ permanent: false, until: '2026-11-14T11:30:00.000Z' })
    expect(resolveBan(choice('until', { untilLocal: '2026-11-20T08:00' }), 'UTC', NOW)).toEqual({ permanent: false, until: '2026-11-20T08:00:00.000Z' })
  })

  it('refuses unusable choices', () => {
    expect(resolveBan(choice('duration', { amount: '0' }), 'UTC', NOW)).toHaveProperty('error')
    expect(resolveBan(choice('until', { untilLocal: '2026-11-13T08:00' }), 'UTC', NOW)).toHaveProperty('error')
    expect(resolveBan(choice('until', { untilLocal: '' }), 'UTC', NOW)).toHaveProperty('error')
    expect(resolveBan(choice('duration', { amount: '20', unit: 'days' }), 'UTC', NOW)).not.toHaveProperty('error')
    expect(resolveBan(choice('duration', { amount: '4000', unit: 'days' }), 'UTC', NOW)).toHaveProperty('error')
  })
})

describe('who may act on whom', () => {
  it('protects the owner and yourself, and needs strictly higher rank', () => {
    expect(sanctionRefusal({ id: 'a', role: 'administrator' }, { id: 'o', role: 'owner' })).toBe('owner_protected')
    expect(sanctionRefusal({ id: 'o', role: 'owner' }, { id: 'o', role: 'owner' })).toBe('self_action_blocked')
    expect(sanctionRefusal({ id: 'o', role: 'owner' }, { id: 'o2', role: 'owner' })).toBe('owner_protected')
    expect(sanctionRefusal({ id: 'a', role: 'administrator' }, { id: 'b', role: 'administrator' })).toBe('rank_protected')
    expect(sanctionRefusal({ id: 'm', role: 'moderator' }, { id: 'v', role: 'viewer' })).toBeNull()
    expect(sanctionRefusal({ id: 'v', role: 'viewer' }, { id: 's', role: null })).toBeNull()
    expect(sanctionRefusal({ id: 'o', role: 'owner' }, { id: 'a', role: 'administrator' })).toBeNull()
  })
})
