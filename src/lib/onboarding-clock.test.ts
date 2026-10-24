import { describe, expect, it } from 'vitest'
import { shouldShowOnboarding } from './defaults'
import { focusClockLabel } from './focus-clock'

describe('onboarding waits for the real profile', () => {
  const base = { needed: true, loading: false, profileLoaded: true, syncState: 'synced', alreadyShown: false }
  it('never shows before this user’s settings have loaded, even if an old session left sync settled', () => {
    expect(shouldShowOnboarding({ ...base, profileLoaded: false })).toBe(false)
    expect(shouldShowOnboarding({ ...base, loading: true })).toBe(false)
    expect(shouldShowOnboarding({ ...base, syncState: 'syncing' })).toBe(false)
  })
  it('shows only for a genuinely incomplete profile after load, and stays up once shown', () => {
    expect(shouldShowOnboarding(base)).toBe(true)
    expect(shouldShowOnboarding({ ...base, needed: false })).toBe(false)
    expect(shouldShowOnboarding({ ...base, profileLoaded: false, syncState: 'syncing', alreadyShown: true })).toBe(true)
  })
})

describe('Home focus clock', () => {
  it('shows m:ss instead of rounding to minutes', () => {
    expect(focusClockLabel(90)).toBe('1:30')
    expect(focusClockLabel(5)).toBe('0:05')
    expect(focusClockLabel(3725)).toBe('1:02:05')
    expect(focusClockLabel(-3)).toBe('0:00')
  })
})
