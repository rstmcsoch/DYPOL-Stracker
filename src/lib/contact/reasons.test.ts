import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_RULES, CONTACT_REASONS, REASON_FIELDS, attachmentMime, attachmentProblem, cleanContactDetails, cleanContactLinks,
  magicBytesMatch, normaliseContactUrl, safeFileName, validateContactDraft, type ContactDraft
} from './reasons'

const MB = 1024 * 1024
const draft = (overrides: Partial<ContactDraft> = {}): ContactDraft => ({
  name: 'Asha', email: 'asha@example.com', reason: 'general_query', subject: '', message: 'How do I export my tests?', details: {}, links: [], ...overrides
})

describe('contact reasons', () => {
  it('offers exactly the six reasons Rustam asked for', () => {
    expect(CONTACT_REASONS.map(reason => reason.label)).toEqual(['Feature request', 'Bug report', 'Complaint', 'Copyright', 'Sponsorship', 'General query'])
  })

  it('general query needs only name, email, message (subject optional)', () => {
    expect(validateContactDraft(draft())).toEqual({})
    expect(REASON_FIELDS.general_query).toEqual([])
  })

  it('validates name, email, reason and message lengths', () => {
    const errors = validateContactDraft(draft({ name: ' ', email: 'not-an-email', reason: '', message: 'short' }))
    expect(Object.keys(errors).sort()).toEqual(['email', 'message', 'name', 'reason'])
    expect(validateContactDraft(draft({ name: 'x'.repeat(81) })).name).toBeTruthy()
    expect(validateContactDraft(draft({ message: 'x'.repeat(4001) })).message).toBeTruthy()
    expect(validateContactDraft(draft({ subject: 'x'.repeat(121) })).subject).toBeTruthy()
    expect(validateContactDraft(draft({ email: 'a@b.co, c@d.co' })).email).toBeTruthy()
  })

  it('requires the reason-specific fields and rejects fields of other reasons', () => {
    expect(validateContactDraft(draft({ reason: 'bug_report' }))['details.area']).toBeTruthy()
    expect(validateContactDraft(draft({ reason: 'bug_report', details: { area: 'Planner' } }))).toEqual({})
    expect(validateContactDraft(draft({ reason: 'general_query', details: { area: 'Planner' } }))['details.area']).toMatch(/does not belong/)
    const copyright = validateContactDraft(draft({ reason: 'copyright', details: { original_work: 'My notes', content_location: '/about' } }))
    expect(copyright['details.good_faith']).toBeTruthy()
    expect(validateContactDraft(draft({ reason: 'copyright', details: { original_work: 'My notes', content_location: '/about', good_faith: true } }))).toEqual({})
    expect(validateContactDraft(draft({ reason: 'sponsorship', details: { organisation: 'Acme', website: 'javascript:alert(1)' } }))['details.website']).toBeTruthy()
    expect(validateContactDraft(draft({ reason: 'sponsorship', details: { organisation: 'Acme', website: 'x'.repeat(301) } }))['details.website']).toBeTruthy()
  })

  it('keeps only whitelisted, non-empty detail values', () => {
    expect(cleanContactDetails('sponsorship', { organisation: ' Acme ', website: '', extra: 'x' })).toEqual({ organisation: 'Acme' })
    expect(cleanContactDetails('copyright', { good_faith: false })).toEqual({})
  })
})

describe('contact links', () => {
  it('accepts only http(s) URLs without credentials, at most five', () => {
    expect(normaliseContactUrl('https://example.com/page')).toBe('https://example.com/page')
    expect(normaliseContactUrl('http://example.com')).toBe('http://example.com/')
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'https://user:pw@example.com', 'example.com', 'https://local', 'https://a.com/ b']) expect(normaliseContactUrl(bad)).toBeNull()
    expect(validateContactDraft(draft({ links: ['https://a.com', 'nope'] }))['links.1']).toBeTruthy()
    expect(validateContactDraft(draft({ links: Array.from({ length: 6 }, (_, index) => `https://a${index}.com`) })).links).toBeTruthy()
    expect(cleanContactLinks(['https://a.com', ' https://a.com ', '', 'bad'])).toEqual(['https://a.com/'])
  })
})

describe('contact attachments', () => {
  it('allows only PDF, JPG, JPEG and PNG with matching extension and MIME type', () => {
    expect(attachmentMime('a.pdf', 'application/pdf')).toBe('application/pdf')
    expect(attachmentMime('a.JPG', 'image/jpeg')).toBe('image/jpeg')
    expect(attachmentMime('a.jpeg', '')).toBe('image/jpeg')
    expect(attachmentMime('a.png', 'image/png')).toBe('image/png')
    expect(attachmentMime('a.png', 'application/pdf')).toBeNull()
    expect(attachmentMime('a.gif', 'image/gif')).toBeNull()
    expect(attachmentMime('a.webp', 'image/webp')).toBeNull()
    expect(attachmentMime('a.pdf.exe', 'application/pdf')).toBeNull()
    expect(attachmentMime('noextension', 'application/pdf')).toBeNull()
  })

  it('enforces 10 MB per file, 15 MB per message and five files', () => {
    expect(attachmentProblem([{ name: 'a.pdf', size: 10 * MB, type: 'application/pdf' }])).toBeNull()
    expect(attachmentProblem([{ name: 'a.pdf', size: 10 * MB + 1, type: 'application/pdf' }])).toMatch(/10 MB/)
    expect(attachmentProblem([{ name: 'a.pdf', size: 8 * MB, type: 'application/pdf' }, { name: 'b.png', size: 7 * MB + 1, type: 'image/png' }])).toMatch(/15 MB/)
    expect(attachmentProblem([{ name: 'a.pdf', size: 8 * MB, type: 'application/pdf' }, { name: 'b.png', size: 7 * MB, type: 'image/png' }])).toBeNull()
    expect(attachmentProblem(Array.from({ length: ATTACHMENT_RULES.maxFiles + 1 }, (_, index) => ({ name: `${index}.png`, size: 10, type: 'image/png' })))).toMatch(/up to 5/)
    expect(attachmentProblem([{ name: 'a.gif', size: 10, type: 'image/gif' }])).toMatch(/not a PDF, JPG or PNG/)
    expect(attachmentProblem([{ name: 'a.png', size: 0, type: 'image/png' }])).toMatch(/empty/)
  })

  it('checks magic bytes for each type', () => {
    expect(magicBytesMatch('application/pdf', new TextEncoder().encode('%PDF-1.7'))).toBe(true)
    expect(magicBytesMatch('image/png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
    expect(magicBytesMatch('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true)
    expect(magicBytesMatch('image/png', new TextEncoder().encode('%PDF-1.7'))).toBe(false)
    expect(magicBytesMatch('application/pdf', new TextEncoder().encode('<html>'))).toBe(false)
    expect(magicBytesMatch('image/jpeg', Uint8Array.from([0xff, 0xd8]))).toBe(false)
  })

  it('makes storage-safe file names that keep the extension', () => {
    expect(safeFileName('My Résumé (final).PDF')).toBe('My-Resume-final.pdf')
    expect(safeFileName('../../etc/passwd.png')).toBe('etc-passwd.png')
    expect(safeFileName('***.png')).toBe('file.png')
  })
})
