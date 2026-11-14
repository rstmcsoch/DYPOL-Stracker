/**
 * Contact form rules. Shared by the public /contact page, the POST /api/contact route (which
 * enforces every rule again and rejects anything else) and the Control Center Messages tab.
 * Pure data and validation only: no browser or Node APIs.
 */
export const CONTACT_REASONS = [
  { value: 'general_query', label: 'General query', hint: 'A question about Stracker, your account or your data' },
  { value: 'feature_request', label: 'Feature request', hint: 'An idea that would make Stracker more useful for your preparation' },
  { value: 'bug_report', label: 'Bug report', hint: 'Something in Stracker is broken, wrong or not saving' },
  { value: 'complaint', label: 'Complaint', hint: 'Something about Stracker or DYPOL LABS did not meet your expectations' },
  { value: 'copyright', label: 'Copyright', hint: 'Content on Stracker that you believe uses your work without permission' },
  { value: 'sponsorship', label: 'Sponsorship', hint: 'Partnering with or sponsoring Stracker by DYPOL LABS' }
] as const

/** The reason the form opens with. */
export const DEFAULT_CONTACT_REASON = 'general_query'

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
  rows?: number
}

/**
 * A field on the form. `target: 'message'` is the reason's main description and is stored in the
 * `message` column (required, 10–4000 characters); `target: 'subject'` is stored in `subject`.
 * Every other field is a reason-specific detail stored in the `details` jsonb.
 */
export interface FormField extends DetailField { target?: 'subject' | 'message' }

/**
 * One coherent field set per reason, in display order, after "About you" (name and email).
 * No two fields ask for the same thing: the reason's main description replaces a generic
 * message box, and only General query and Feature request ask for a title; every other
 * reason gets its subject from its first field (see `contactSubject`).
 */
export const REASON_FORMS: Record<ContactReason, readonly FormField[]> = {
  general_query: [
    { key: 'subject', target: 'subject', label: 'Subject', type: 'text', max: CONTACT_LIMITS.subject.max, placeholder: 'For example: exporting my notebook, changing my email address' },
    { key: 'message', target: 'message', label: 'Your question', type: 'multiline', max: CONTACT_LIMITS.message.max, required: true, rows: 6, placeholder: 'Ask anything about Stracker, your account or your data. The more context, the better our answer.' }
  ],
  feature_request: [
    { key: 'subject', target: 'subject', label: 'Your idea in one line', type: 'text', max: CONTACT_LIMITS.subject.max, required: true, placeholder: 'For example: Revision reminders for chapters I marked weak' },
    { key: 'area', label: 'Part of Stracker it touches', type: 'text', max: 120, placeholder: 'For example: Planner, Tests, Analytics, Focus timer, Stracker AI' },
    { key: 'message', target: 'message', label: 'How it would work', type: 'multiline', max: CONTACT_LIMITS.message.max, required: true, rows: 5, placeholder: 'Walk us through it: where you would start, what you would tap, what Stracker would show.' },
    { key: 'benefit', label: 'How it would help your preparation', type: 'multiline', max: 1000, rows: 3, placeholder: 'For example: I would stop losing track of chapters I have not revised in two weeks.' }
  ],
  bug_report: [
    { key: 'area', label: 'Where it happened', type: 'text', max: 120, required: true, placeholder: 'For example: Tests → Log a mock, Planner, Stracker AI' },
    { key: 'message', target: 'message', label: 'What went wrong', type: 'multiline', max: CONTACT_LIMITS.message.max, required: true, rows: 4, placeholder: 'What you saw: an error message, a wrong number, something that did not save.' },
    { key: 'steps', label: 'Steps to reproduce', type: 'multiline', max: 2000, rows: 4, placeholder: '1. Open …\n2. Tap …\n3. …', hint: 'If we can make it happen on our side, we can fix it faster.' },
    { key: 'expected', label: 'What you expected instead', type: 'multiline', max: 1000, rows: 2 },
    { key: 'device', label: 'Device and browser', type: 'text', max: 120, placeholder: 'For example: Android phone, Chrome 131 · or the installed Stracker app' }
  ],
  complaint: [
    { key: 'area', label: 'What it concerns', type: 'text', max: 120, required: true, placeholder: 'For example: my account, a Stracker AI answer, a reply from the team' },
    { key: 'message', target: 'message', label: 'What happened', type: 'multiline', max: CONTACT_LIMITS.message.max, required: true, rows: 5, placeholder: 'Tell us what happened and when, in your own words.' },
    { key: 'resolution', label: 'What would put it right', type: 'multiline', max: 1000, rows: 2, placeholder: 'Optional: what you would like us to do.' }
  ],
  copyright: [
    { key: 'original_work', label: 'Your work and your rights to it', type: 'multiline', max: 2000, required: true, rows: 3, hint: 'Describe the original work, and whether you own it or act for the owner.' },
    { key: 'content_location', label: 'Where it appears on Stracker', type: 'text', max: 500, required: true, placeholder: 'The page address, or where in Stracker you saw it' },
    { key: 'message', target: 'message', label: 'What you are asking us to do', type: 'multiline', max: CONTACT_LIMITS.message.max, required: true, rows: 3, placeholder: 'For example: remove the content, or credit the original source.' },
    { key: 'good_faith', label: 'I believe in good faith that this use is not authorised by the rights owner, its agent or the law, and the information in this notice is accurate.', type: 'checkbox', max: 5, required: true }
  ],
  sponsorship: [
    { key: 'organisation', label: 'Organisation', type: 'text', max: 120, required: true },
    { key: 'website', label: 'Organisation website', type: 'url', max: 300, placeholder: 'https://' },
    { key: 'role', label: 'Your role', type: 'text', max: 120, placeholder: 'For example: Partnerships lead' },
    { key: 'message', target: 'message', label: 'Your proposal', type: 'multiline', max: CONTACT_LIMITS.message.max, required: true, rows: 5, placeholder: 'What you have in mind, who it is for (which exams or classes), and your timeline.' }
  ]
}

/** Whitelist of detail fields per reason (the form fields stored in `details`). Anything else is rejected by the server. */
export const REASON_FIELDS: Record<ContactReason, readonly DetailField[]> = Object.fromEntries(
  CONTACT_REASON_VALUES.map(reason => [reason, REASON_FORMS[reason].filter(field => !field.target)])
) as unknown as Record<ContactReason, readonly DetailField[]>

export function reasonField(reason: ContactReason, target: 'subject' | 'message'): FormField | undefined {
  return REASON_FORMS[reason].find(field => field.target === target)
}

/** The stored subject: the sender's own where the form asks for one, otherwise reason + first field. */
export function contactSubject(reason: ContactReason, subject: string, details: ContactDetails): string | null {
  if (reasonField(reason, 'subject')) return subject.trim() || null
  const first = REASON_FIELDS[reason].find(field => field.type !== 'checkbox' && typeof details[field.key] === 'string' && (details[field.key] as string).trim())
  const lead = { general_query: 'Question', feature_request: 'Idea', bug_report: 'Bug', complaint: 'Complaint', copyright: 'Copyright notice', sponsorship: 'Sponsorship' }[reason]
  const text = first ? `${lead}: ${(details[first.key] as string).trim().replace(/\s+/g, ' ')}` : contactReasonLabel(reason)
  return text.length > CONTACT_LIMITS.subject.max ? `${text.slice(0, CONTACT_LIMITS.subject.max - 1)}…` : text
}

/** Labels for detail keys used by earlier versions of the form, so older messages still read well. */
const LEGACY_DETAIL_LABELS: Record<string, string> = {
  actual: 'What actually happened',
  area: 'Area',
  benefit: 'How it would help',
  original_work: 'Original work and ownership',
  content_location: 'Where the content appears'
}

export interface MessageRow { key: string; label: string; type: DetailFieldType; value: string | boolean }

/**
 * Everything a sender wrote, in the order of the form they used, under the form's labels:
 * the main description under its reason label, detail fields, then any older or unknown keys.
 */
export function messageRows(reason: string, message: string, details: Record<string, string | boolean>): MessageRow[] {
  const form = isContactReason(reason) ? REASON_FORMS[reason] : []
  const rows: MessageRow[] = []
  const seen = new Set<string>()
  for (const field of form) {
    if (field.target === 'subject') continue
    if (field.target === 'message') { rows.push({ key: 'message', label: field.label, type: 'multiline', value: message }); continue }
    seen.add(field.key)
    const value = details[field.key]
    if (value === undefined || value === '') continue
    rows.push({ key: field.key, label: field.type === 'checkbox' ? 'Good-faith statement' : field.label, type: field.type, value })
  }
  if (!form.length) rows.push({ key: 'message', label: 'Message', type: 'multiline', value: message })
  for (const [key, value] of Object.entries(details)) {
    if (seen.has(key) || value === '' || (typeof value !== 'string' && typeof value !== 'boolean')) continue
    const label = LEGACY_DETAIL_LABELS[key] ?? key.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase())
    rows.push({ key, label, type: typeof value === 'boolean' ? 'checkbox' : 'multiline', value })
  }
  return rows
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
  else if (isContactReason(draft.reason)) {
    const subjectField = reasonField(draft.reason, 'subject')
    if (!subjectField && subject) errors.subject = 'This kind of message does not use a subject.'
    else if (subjectField?.required && !subject) errors.subject = 'Sum it up in one line.'
  }
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
