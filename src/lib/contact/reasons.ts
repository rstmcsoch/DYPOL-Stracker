/**
 * Contact form rules. Shared by the public /contact page, the POST /api/contact route (which
 * enforces every rule again and rejects anything else) and the Control Center Messages tab.
 * Pure data and validation only: no browser or Node APIs.
 */
export const CONTACT_REASONS = [
  { value: 'feature_request', label: 'Feature request', hint: 'An idea that would make Stracker more useful for your preparation' },
  { value: 'bug_report', label: 'Bug report', hint: 'Something in Stracker is broken, wrong or not saving' },
  { value: 'complaint', label: 'Complaint', hint: 'Something about Stracker or DYPOL LABS did not meet your expectations' },
  { value: 'copyright', label: 'Copyright', hint: 'Content on Stracker that you believe uses your work without permission' },
  { value: 'sponsorship', label: 'Sponsorship', hint: 'Partnering with or sponsoring Stracker by DYPOL LABS' },
  { value: 'general_query', label: 'General query', hint: 'Anything else about Stracker, your account or your data' }
] as const

export type ContactReason = typeof CONTACT_REASONS[number]['value']
export const CONTACT_REASON_VALUES = CONTACT_REASONS.map(reason => reason.value) as [ContactReason, ...ContactReason[]]

export function isContactReason(value: unknown): value is ContactReason {
  return typeof value === 'string' && (CONTACT_REASON_VALUES as string[]).includes(value)
}

export const CONTACT_STATUSES = ['new', 'read', 'archived'] as const
export type ContactStatus = typeof CONTACT_STATUSES[number]

export const CONTACT_LIMITS = {
  name: { min: 1, max: 80 },
  email: { min: 3, max: 254 },
  subject: { max: 120 },
  message: { min: 10, max: 4000 },
  links: { max: 5, length: 500 }
} as const

export function contactReasonLabel(value: string): string {
  return CONTACT_REASONS.find(reason => reason.value === value)?.label ?? 'General query'
}

/** What the main message box is called for each reason. */
export const MESSAGE_LABELS: Record<ContactReason, { label: string; placeholder: string }> = {
  feature_request: { label: 'Your idea', placeholder: 'Describe the feature you would like in Stracker.' },
  bug_report: { label: 'What went wrong', placeholder: 'A short summary of the problem you hit in Stracker.' },
  complaint: { label: 'What happened', placeholder: 'Tell us what happened and what you would like us to do about it.' },
  copyright: { label: 'Your notice', placeholder: 'Explain which content you believe infringes your rights and what you are asking us to do.' },
  sponsorship: { label: 'Your proposal', placeholder: 'What you have in mind, who it is for, and the timeline.' },
  general_query: { label: 'Message', placeholder: 'How can we help?' }
}

/* ------------------------------------------------------------------ reason-specific fields */

export type DetailFieldType = 'text' | 'multiline' | 'url' | 'checkbox'
export interface DetailField {
  key: string
  label: string
  type: DetailFieldType
  max: number
  required?: boolean
  placeholder?: string
  hint?: string
}

/** Whitelist of extra fields per reason. Anything not listed here is rejected by the server. */
export const REASON_FIELDS: Record<ContactReason, readonly DetailField[]> = {
  bug_report: [
    { key: 'area', label: 'Page or feature affected', type: 'text', max: 120, required: true, placeholder: 'For example: Tests → Log a mock, Planner, Stracker AI' },
    { key: 'steps', label: 'Steps to reproduce', type: 'multiline', max: 2000, placeholder: '1. Open …\n2. Tap …\n3. …' },
    { key: 'expected', label: 'What you expected', type: 'multiline', max: 1000 },
    { key: 'actual', label: 'What actually happened', type: 'multiline', max: 1000 },
    { key: 'device', label: 'Device and browser', type: 'text', max: 120, placeholder: 'For example: Android tablet, Chrome 131' }
  ],
  feature_request: [
    { key: 'area', label: 'Which part of Stracker', type: 'text', max: 120, placeholder: 'For example: Revision planner, Analytics, Focus timer' },
    { key: 'benefit', label: 'How it would help your preparation', type: 'multiline', max: 1000 }
  ],
  complaint: [
    { key: 'area', label: 'Area concerned', type: 'text', max: 120, required: true, placeholder: 'For example: my account, Stracker AI answers, a page on the site' }
  ],
  copyright: [
    { key: 'original_work', label: 'Your original work and ownership', type: 'multiline', max: 2000, required: true, hint: 'Describe the work and how you own or represent the rights to it.' },
    { key: 'content_location', label: 'Where the content appears on Stracker', type: 'text', max: 500, required: true, placeholder: 'The page address or where in Stracker you saw it' },
    { key: 'good_faith', label: 'I believe in good faith that this use is not authorised by the rights owner, its agent or the law, and the information in this notice is accurate.', type: 'checkbox', max: 5, required: true }
  ],
  sponsorship: [
    { key: 'organisation', label: 'Organisation name', type: 'text', max: 120, required: true },
    { key: 'website', label: 'Organisation website', type: 'url', max: 300, placeholder: 'https://' }
  ],
  general_query: []
}

export type ContactDetails = Record<string, string | boolean>

/* ------------------------------------------------------------------------ links and files */

/** http(s) only, no credentials, at most `CONTACT_LIMITS.links.length` characters. Returns the normalised URL or null. */
export function normaliseContactUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value || value.length > CONTACT_LIMITS.links.length || /\s/.test(value)) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password || !url.hostname.includes('.')) return null
  return url.toString()
}

export const ATTACHMENT_RULES = {
  maxFiles: 5,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 15 * 1024 * 1024,
  types: [
    { mime: 'application/pdf', extensions: ['pdf'], label: 'PDF' },
    { mime: 'image/jpeg', extensions: ['jpg', 'jpeg'], label: 'JPG' },
    { mime: 'image/png', extensions: ['png'], label: 'PNG' }
  ]
} as const

export type AttachmentMime = typeof ATTACHMENT_RULES.types[number]['mime']
export const ATTACHMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

export function fileExtension(name: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim())
  return match?.[1]?.toLowerCase() ?? ''
}

/** The allowed MIME type for a file, from its extension and declared type together, or null. */
export function attachmentMime(name: string, declaredType: string): AttachmentMime | null {
  const extension = fileExtension(name)
  const rule = ATTACHMENT_RULES.types.find(type => (type.extensions as readonly string[]).includes(extension))
  if (!rule) return null
  // Some systems leave the type empty; when present it must agree with the extension.
  if (declaredType && declaredType.toLowerCase() !== rule.mime) return null
  return rule.mime
}

/** Checks the first bytes of a file against its type (PDF, PNG and JPEG signatures). */
export function magicBytesMatch(mime: AttachmentMime, bytes: Uint8Array): boolean {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte)
  if (mime === 'application/pdf') return starts(0x25, 0x50, 0x44, 0x46, 0x2d)
  if (mime === 'image/png') return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  return starts(0xff, 0xd8, 0xff)
}

export interface AttachmentCandidate { name: string; size: number; type: string }

/** One clear message per problem, or null when the set of files is acceptable. */
export function attachmentProblem(files: readonly AttachmentCandidate[]): string | null {
  if (files.length > ATTACHMENT_RULES.maxFiles) return `Attach up to ${ATTACHMENT_RULES.maxFiles} files.`
  let total = 0
  for (const file of files) {
    if (!attachmentMime(file.name, file.type)) return `“${file.name}” is not a PDF, JPG or PNG file.`
    if (!Number.isFinite(file.size) || file.size <= 0) return `“${file.name}” is empty.`
    if (file.size > ATTACHMENT_RULES.maxFileBytes) return `“${file.name}” is larger than 10 MB.`
    total += file.size
  }
  if (total > ATTACHMENT_RULES.maxTotalBytes) return 'Attachments add up to more than 15 MB. Remove a file or attach a smaller one.'
  return null
}

/** Storage-safe file name: letters, numbers, dash and underscore, plus the lower-case extension. */
export function safeFileName(name: string): string {
  const extension = fileExtension(name)
  const base = name.replace(/\.[A-Za-z0-9]{1,8}$/, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 60) || 'file'
  return extension ? `${base}.${extension}` : base
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/* ------------------------------------------------------------------------- whole draft */

/** Deliberately simple: one address, no spaces, a dot in the domain. The database checks the same shape. */
export const CONTACT_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export interface ContactDraft {
  name: string
  email: string
  reason: ContactReason | ''
  subject: string
  message: string
  details: ContactDetails
  links: string[]
}
export type ContactFieldErrors = Partial<Record<string, string>>

/** Validation shared by browser and server. Keys: name, email, reason, subject, message, `details.<key>`, `links.<index>`. */
export function validateContactDraft(draft: ContactDraft): ContactFieldErrors {
  const errors: ContactFieldErrors = {}
  const name = draft.name.trim()
  const email = draft.email.trim()
  const subject = draft.subject.trim()
  const message = draft.message.trim()
  if (!name) errors.name = 'Tell us what to call you.'
  else if (name.length > CONTACT_LIMITS.name.max) errors.name = `Use ${CONTACT_LIMITS.name.max} characters or fewer.`
  if (!email) errors.email = 'Add the email address we should reply to.'
  else if (email.length > CONTACT_LIMITS.email.max || !CONTACT_EMAIL_PATTERN.test(email)) errors.email = 'Enter one valid email address, like you@example.com.'
  if (!isContactReason(draft.reason)) errors.reason = 'Choose why you are contacting us.'
  if (subject.length > CONTACT_LIMITS.subject.max) errors.subject = `Use ${CONTACT_LIMITS.subject.max} characters or fewer.`
  if (message.length < CONTACT_LIMITS.message.min) errors.message = `Write at least ${CONTACT_LIMITS.message.min} characters so we can help.`
  else if (message.length > CONTACT_LIMITS.message.max) errors.message = `Use ${CONTACT_LIMITS.message.max} characters or fewer.`
  if (isContactReason(draft.reason)) {
    const fields = REASON_FIELDS[draft.reason]
    for (const key of Object.keys(draft.details)) {
      if (!fields.some(field => field.key === key)) errors[`details.${key}`] = 'This field does not belong to the chosen reason.'
    }
    for (const field of fields) {
      const raw = draft.details[field.key]
      const id = `details.${field.key}`
      if (field.type === 'checkbox') {
        if (raw !== undefined && typeof raw !== 'boolean') errors[id] = 'Tick or untick this box.'
        else if (field.required && raw !== true) errors[id] = 'Tick this box to send the notice.'
        continue
      }
      if (raw !== undefined && typeof raw !== 'string') { errors[id] = 'Enter text here.'; continue }
      const value = (raw ?? '').trim()
      if (!value) { if (field.required) errors[id] = 'This is needed for this kind of message.'; continue }
      if (value.length > field.max) errors[id] = `Use ${field.max} characters or fewer.`
      else if (field.type === 'url' && !normaliseContactUrl(value)) errors[id] = 'Enter a full http:// or https:// address.'
    }
  }
  const links = draft.links
  if (links.length > CONTACT_LIMITS.links.max) errors.links = `Add up to ${CONTACT_LIMITS.links.max} links.`
  links.forEach((link, index) => {
    if (link.trim() && !normaliseContactUrl(link)) errors[`links.${index}`] = 'Enter a full http:// or https:// address.'
  })
  return errors
}

/** The stored form of a valid draft's details: only whitelisted, non-empty, trimmed values. */
export function cleanContactDetails(reason: ContactReason, details: ContactDetails): ContactDetails {
  const clean: ContactDetails = {}
  for (const field of REASON_FIELDS[reason]) {
    const raw = details[field.key]
    if (field.type === 'checkbox') { if (raw === true) clean[field.key] = true; continue }
    if (typeof raw !== 'string' || !raw.trim()) continue
    clean[field.key] = field.type === 'url' ? normaliseContactUrl(raw) ?? '' : raw.trim()
  }
  return clean
}

export function cleanContactLinks(links: readonly string[]): string[] {
  return [...new Set(links.map(link => normaliseContactUrl(link)).filter((link): link is string => Boolean(link)))]
}
