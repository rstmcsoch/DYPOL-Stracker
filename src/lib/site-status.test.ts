import { describe, expect, it } from 'vitest'
import { NORMAL_SITE_STATUS, parseSiteStatus, siteGateDecision } from './site-status'

const down = { ...NORMAL_SITE_STATUS, siteDown: true, maintenanceMessage: 'Back at 6 PM' }
const notice = { ...NORMAL_SITE_STATUS, maintenanceEnabled: true }

describe('site switches', () => {
  it('renders normally when everything is on', () => {
    for (const kind of ['public', 'app', 'auth'] as const) expect(siteGateDecision(NORMAL_SITE_STATUS, kind, false, false)).toBe('render')
  })
  it('maintenance notice keeps every page usable with a banner', () => {
    for (const kind of ['public', 'app', 'auth'] as const) expect(siteGateDecision(notice, kind, true, false)).toBe('render-with-notice')
  })
  it('site down: visitors and signed-in students get the maintenance page', () => {
    expect(siteGateDecision(down, 'public', false, false)).toBe('maintenance-page')
    expect(siteGateDecision(down, 'app', true, false)).toBe('maintenance-page')
    expect(siteGateDecision(down, 'public', true, false)).toBe('maintenance-page')
  })
  it('site down: log in stays reachable and team members keep using the site', () => {
    expect(siteGateDecision(down, 'auth', false, false)).toBe('render-with-notice')
    expect(siteGateDecision(down, 'app', true, true)).toBe('render-with-notice')
    // A team flag without a session never bypasses the outage.
    expect(siteGateDecision(down, 'app', false, true)).toBe('maintenance-page')
  })
  it('fails open on missing or malformed settings', () => {
    expect(parseSiteStatus(null)).toEqual(NORMAL_SITE_STATUS)
    expect(parseSiteStatus({ site_down: 'yes', signup_enabled: null })).toMatchObject({ siteDown: false, signupEnabled: true, signinEnabled: true })
    expect(parseSiteStatus({ signup_enabled: false, signin_enabled: false })).toMatchObject({ signupEnabled: false, signinEnabled: false })
  })
})
