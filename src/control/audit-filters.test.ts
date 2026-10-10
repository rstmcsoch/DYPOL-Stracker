import { describe, expect, it } from 'vitest'
import { AUDIT_ACTION_NAMES } from '../lib/control-audit-catalog'
import {
  auditActionChoices, auditFiltersToParams, buildAuditQuery, DEFAULT_AUDIT_FILTERS,
  invalidFilterField, isDefaultAuditFilters, readAuditFilters, readAuditPage
} from './audit-filters'

const TARGET = '11111111-2222-4333-8444-555555555555'

describe('audit filter serialization', () => {
  it('sends no filter parameters at all for the default (empty) filters', () => {
    // Regression: the page used to send outcome=all&action=&target=&from=&to= on first load,
    // which the server correctly rejected as an invalid filter.
    expect(auditFiltersToParams(DEFAULT_AUDIT_FILTERS).toString()).toBe('')
    const query = new URLSearchParams(buildAuditQuery(DEFAULT_AUDIT_FILTERS, 'Asia/Kolkata'))
    expect([...query.keys()]).toEqual(['tz'])
    expect(query.get('tz')).toBe('Asia/Kolkata')
  })

  it('serializes only the non-default values, the same way for the URL and the API', () => {
    const filters = { ...DEFAULT_AUDIT_FILTERS, outcome: 'denied' as const, from: '2026-10-01', target: TARGET }
    expect(auditFiltersToParams(filters).toString()).toBe(`outcome=denied&target=${TARGET}&from=2026-10-01`)
    expect(auditFiltersToParams(filters, 3).get('page')).toBe('3')
    expect(auditFiltersToParams(filters, 1).has('page')).toBe(false)
    const api = new URLSearchParams(buildAuditQuery(filters, 'UTC', { format: 'csv' }))
    expect(api.get('outcome')).toBe('denied')
    expect(api.get('from')).toBe('2026-10-01')
    expect(api.get('to')).toBeNull()
    expect(api.get('action')).toBeNull()
    expect(api.get('format')).toBe('csv')
    expect(api.get('tz')).toBe('UTC')
  })

  it('round-trips through the URL and drops values that could never be valid', () => {
    const params = new URLSearchParams({ outcome: 'all', action: 'user.viewed', target: TARGET.toUpperCase(), from: '2026-10-04', to: '2026-10-10', page: '2' })
    const filters = readAuditFilters(params)
    expect(filters).toEqual({ outcome: 'all', action: 'user.viewed', target: TARGET, from: '2026-10-04', to: '2026-10-10' })
    expect(readAuditPage(params)).toBe(2)
    expect(isDefaultAuditFilters(filters)).toBe(false)

    const junk = readAuditFilters(new URLSearchParams({ outcome: 'bogus', action: 'DROP TABLE', target: 'not-a-uuid', from: 'yesterday', to: '2026-13-99x', page: '-4' }))
    expect(junk).toEqual(DEFAULT_AUDIT_FILTERS)
    expect(isDefaultAuditFilters(junk)).toBe(true)
    expect(readAuditPage(new URLSearchParams({ page: '-4' }))).toBe(1)
    expect(readAuditPage(new URLSearchParams({ page: 'NaN' }))).toBe(1)
  })

  it('offers every catalogued action plus an unknown-but-valid action from the URL', () => {
    expect(auditActionChoices('')).toEqual([...AUDIT_ACTION_NAMES])
    expect(auditActionChoices('user.viewed')).toEqual([...AUDIT_ACTION_NAMES])
    expect(auditActionChoices('legacy.event')).toEqual([...AUDIT_ACTION_NAMES, 'legacy.event'])
    expect(AUDIT_ACTION_NAMES).toContain('control.access')
    expect(AUDIT_ACTION_NAMES).toContain('audit.export')
    expect(AUDIT_ACTION_NAMES).toContain('owner.provisioned')
  })

  it('maps only the server field hints to a filter and ignores anything else', () => {
    expect(invalidFilterField('field:from')).toBe('from')
    expect(invalidFilterField('field:outcome')).toBe('outcome')
    expect(invalidFilterField('field:password')).toBeNull()
    expect(invalidFilterField('SELECT * FROM')).toBeNull()
    expect(invalidFilterField(undefined)).toBeNull()
  })
})
