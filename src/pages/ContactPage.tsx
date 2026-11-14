import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, FileText, ImageIcon, Link2, Paperclip, Plus, Send, Trash2, X } from 'lucide-react'
import { PublicPageShell } from '../components/public/PublicPageShell'
import { ReasonSelect } from '../components/contact/ReasonSelect'
import { Button } from '../components/ui'
import { useOptionalUser } from '../contexts/AuthContext'
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_RULES,
  CONTACT_LIMITS,
  MESSAGE_LABELS,
  REASON_FIELDS,
  attachmentProblem,
  cleanContactDetails,
  formatBytes,
  validateContactDraft,
  type ContactDetails,
  type ContactReason,
  type DetailField
} from '../lib/contact/reasons'
import { ContactSubmitError, submitContactMessage } from '../lib/contact/submit'

type Phase = { kind: 'editing' } | { kind: 'sending' } | { kind: 'sent' }

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <span className="field-error type-alert" id={id} role="alert">{message}</span> : null
}

function DetailInput({ field, value, error, onChange }: { field: DetailField; value: string | boolean | undefined; error?: string; onChange: (value: string | boolean) => void }) {
  const id = `contact-detail-${field.key}`
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const described = [field.hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined
  if (field.type === 'checkbox') {
    return <div className={`contact-check ${error ? 'field-invalid' : ''}`}>
      <label htmlFor={id}>
        <input id={id} type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} aria-invalid={error ? true : undefined} aria-describedby={described} />
        <span>{field.label}{field.required && <span className="required-mark" aria-hidden="true"> *</span>}</span>
      </label>
      <FieldError id={errorId} message={error} />
    </div>
  }
  const common = {
    id,
    value: typeof value === 'string' ? value : '',
    maxLength: field.max,
    placeholder: field.placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': described,
    'aria-required': field.required ? true : undefined,
    className: 'type-input'
  }
  return <div className={`field ${error ? 'field-invalid' : ''}`}>
    <label className="field-label type-body" htmlFor={id}>{field.label}{field.required && <span className="required-mark" aria-hidden="true"> *</span>}</label>
    {field.type === 'multiline'
      ? <textarea {...common} rows={3} onChange={event => onChange(event.target.value)} />
      : <input {...common} type={field.type === 'url' ? 'url' : 'text'} inputMode={field.type === 'url' ? 'url' : undefined} onChange={event => onChange(event.target.value)} />}
    {field.hint && <span className="field-hint type-caption" id={hintId}>{field.hint}</span>}
    <FieldError id={errorId} message={error} />
  </div>
}

/**
 * Public Contact page (/contact). Works signed out and signed in (the email and name are
 * prefilled, and the message is linked to the account). Messages arrive in Control Center →
 * Messages. Extra fields depend on the chosen reason; files go straight to private storage.
 */
export default function ContactPage() {
  const user = useOptionalUser()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState<ContactReason | ''>('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [details, setDetails] = useState<ContactDetails>({})
  const [links, setLinks] = useState<string[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [progress, setProgress] = useState<number[]>([])
  const [website, setWebsite] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const successRef = useRef<HTMLHeadingElement>(null)
  const reasonLabelId = useId().replaceAll(':', '')

  useEffect(() => {
    if (!user || user.isLocal) return
    setEmail(current => current || user.email)
    setName(current => current || user.displayName)
  }, [user])

  useEffect(() => { if (phase.kind === 'sent') successRef.current?.focus() }, [phase.kind])

  const fields = reason ? REASON_FIELDS[reason] : []
  const messageLabel = reason ? MESSAGE_LABELS[reason] : MESSAGE_LABELS.general_query
  const sending = phase.kind === 'sending'
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)

  const chooseReason = (next: ContactReason) => {
    setReason(next)
    // Keep only the values that belong to the new reason, so hidden fields are never sent.
    setDetails(current => Object.fromEntries(Object.entries(current).filter(([key]) => REASON_FIELDS[next].some(field => field.key === key))))
    setErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith('details.') && key !== 'reason')))
  }

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return
    const next = [...files, ...Array.from(list)]
    const problem = attachmentProblem(next.map(file => ({ name: file.name, size: file.size, type: file.type })))
    if (problem) setErrors(current => ({ ...current, files: problem }))
    else {
      setFiles(next)
      setErrors(current => { const copy = { ...current }; delete copy.files; return copy })
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeFile = (index: number) => {
    setFiles(current => current.filter((_, position) => position !== index))
    setErrors(current => { const copy = { ...current }; delete copy.files; return copy })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending) return
    setFormError(null)
    const draft = { name, email, reason, subject, message, details: reason ? cleanContactDetails(reason, details) : {}, links }
    const found = validateContactDraft(draft) as Record<string, string>
    const fileIssue = attachmentProblem(files.map(file => ({ name: file.name, size: file.size, type: file.type })))
    if (fileIssue) found.files = fileIssue
    setErrors(found)
    if (Object.keys(found).length || !reason) {
      setFormError('Check the highlighted fields.')
      const first = document.querySelector<HTMLElement>('.contact-form [aria-invalid="true"]')
      first?.focus()
      return
    }
    setPhase({ kind: 'sending' })
    setProgress(files.map(() => 0))
    try {
      await submitContactMessage({ name, email, reason, subject, message, details: draft.details, links, files, website }, (index, fraction) => {
        setProgress(current => current.map((value, position) => (position === index ? fraction : value)))
      })
      setPhase({ kind: 'sent' })
    } catch (error) {
      const failure = error instanceof ContactSubmitError ? error : new ContactSubmitError('Your message could not be sent. Try again in a few minutes.')
      if (failure.fields) setErrors(failure.fields)
      setFormError(failure.message)
      setPhase({ kind: 'editing' })
    }
  }

  const reset = () => {
    setReason(''); setSubject(''); setMessage(''); setDetails({}); setLinks([]); setFiles([]); setProgress([]); setErrors({}); setFormError(null)
    setPhase({ kind: 'editing' })
  }

  return <PublicPageShell title="Contact" description="Send a feature request, bug report, complaint, copyright notice, sponsorship proposal or question to the Stracker team at DYPOL LABS.">
    <div className="pub-shell pub-doc-shell contact-shell">
      <header className="pub-doc-head contact-head">
        <p className="pub-eyebrow"><span aria-hidden="true">✎</span> STRACKER BY DYPOL LABS</p>
        <h1 id="contact-title">Contact the Stracker team</h1>
        <p className="contact-lede">Tell us what would make Stracker better for your preparation, report something that is not working, or ask a question. Every message goes straight to the Stracker team at DYPOL LABS, and we reply to the email address you give.</p>
      </header>

      {phase.kind === 'sent'
        ? <section className="pub-doc-card contact-card contact-sent" aria-labelledby="contact-sent-title" role="status">
          <CheckCircle2 size={34} aria-hidden="true" className="contact-sent-icon" />
          <h2 id="contact-sent-title" ref={successRef} tabIndex={-1}>Message sent</h2>
          <p>Thanks{name.trim() ? `, ${name.trim().split(/\s+/)[0]}` : ''}. Your message has reached the Stracker team. If it needs a reply, we will write to <strong>{email.trim()}</strong>.</p>
          <div className="contact-sent-actions">
            <Button variant="secondary" onClick={reset}>Send another message</Button>
            <Link className="button button-quiet button-md" to="/">Back to Stracker</Link>
          </div>
        </section>
        : <form className="pub-doc-card contact-card contact-form form-stack" onSubmit={event => void submit(event)} noValidate aria-labelledby="contact-title" aria-busy={sending}>
          <div className="contact-grid">
            <div className={`field ${errors.name ? 'field-invalid' : ''}`}>
              <label className="field-label type-body" htmlFor="contact-name">Your name<span className="required-mark" aria-hidden="true"> *</span></label>
              <input id="contact-name" className="type-input" autoComplete="name" maxLength={CONTACT_LIMITS.name.max} value={name} onChange={event => setName(event.target.value)} aria-required="true" aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? 'contact-name-error' : undefined} />
              <FieldError id="contact-name-error" message={errors.name} />
            </div>
            <div className={`field ${errors.email ? 'field-invalid' : ''}`}>
              <label className="field-label type-body" htmlFor="contact-email">Email for our reply<span className="required-mark" aria-hidden="true"> *</span></label>
              <input id="contact-email" className="type-input" type="email" inputMode="email" autoComplete="email" maxLength={CONTACT_LIMITS.email.max} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" aria-required="true" aria-invalid={errors.email ? true : undefined} aria-describedby={['contact-email-hint', errors.email ? 'contact-email-error' : ''].filter(Boolean).join(' ')} />
              <span className="field-hint type-caption" id="contact-email-hint">{user && !user.isLocal ? 'Filled in from your Stracker account. You can change it.' : 'Used only to reply to this message.'}</span>
              <FieldError id="contact-email-error" message={errors.email} />
            </div>
          </div>

          <div className={`field ${errors.reason ? 'field-invalid' : ''}`}>
            <span className="field-label type-body" id={reasonLabelId}>Why are you contacting us?<span className="required-mark" aria-hidden="true"> *</span></span>
            <ReasonSelect value={reason} onChange={chooseReason} error={errors.reason} labelId={reasonLabelId} describedBy={errors.reason ? 'contact-reason-error' : undefined} />
            <FieldError id="contact-reason-error" message={errors.reason} />
          </div>

          {fields.length > 0 && <fieldset className="contact-reveal" key={reason}>
            <legend className="visually-hidden">Details for this kind of message</legend>
            <div className="contact-reveal-inner">
              {fields.map(field => <DetailInput key={field.key} field={field} value={details[field.key]} error={errors[`details.${field.key}`]} onChange={value => setDetails(current => ({ ...current, [field.key]: value }))} />)}
            </div>
          </fieldset>}

          <div className={`field ${errors.subject ? 'field-invalid' : ''}`}>
            <label className="field-label type-body" htmlFor="contact-subject">Subject <span className="contact-optional">(optional)</span></label>
            <input id="contact-subject" className="type-input" maxLength={CONTACT_LIMITS.subject.max} value={subject} onChange={event => setSubject(event.target.value)} aria-invalid={errors.subject ? true : undefined} aria-describedby={errors.subject ? 'contact-subject-error' : undefined} />
            <FieldError id="contact-subject-error" message={errors.subject} />
          </div>

          <div className={`field ${errors.message ? 'field-invalid' : ''}`}>
            <label className="field-label type-body" htmlFor="contact-message">{messageLabel.label}<span className="required-mark" aria-hidden="true"> *</span></label>
            <textarea id="contact-message" className="type-input" rows={6} maxLength={CONTACT_LIMITS.message.max} value={message} onChange={event => setMessage(event.target.value)} placeholder={messageLabel.placeholder} aria-required="true" aria-invalid={errors.message ? true : undefined} aria-describedby={['contact-message-count', errors.message ? 'contact-message-error' : ''].filter(Boolean).join(' ')} />
            <span className="field-hint type-caption contact-count" id="contact-message-count">{message.trim().length} / {CONTACT_LIMITS.message.max}</span>
            <FieldError id="contact-message-error" message={errors.message} />
          </div>

          <fieldset className="contact-group">
            <legend className="field-label type-body"><Link2 size={15} aria-hidden="true" /> Links <span className="contact-optional">(optional, up to {CONTACT_LIMITS.links.max})</span></legend>
            {links.map((link, index) => <div className={`contact-link-row ${errors[`links.${index}`] ? 'field-invalid' : ''}`} key={index}>
              <input className="type-input" type="url" inputMode="url" aria-label={`Link ${index + 1}`} placeholder="https://" maxLength={CONTACT_LIMITS.links.length} value={link} onChange={event => setLinks(current => current.map((value, position) => (position === index ? event.target.value : value)))} aria-invalid={errors[`links.${index}`] ? true : undefined} aria-describedby={errors[`links.${index}`] ? `contact-link-${index}-error` : undefined} />
              <button type="button" className="icon-button" aria-label={`Remove link ${index + 1}`} title="Remove link" onClick={() => { setLinks(current => current.filter((_, position) => position !== index)); setErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith('links.')))) }}><X size={16} aria-hidden="true" /></button>
              <FieldError id={`contact-link-${index}-error`} message={errors[`links.${index}`]} />
            </div>)}
            {links.length < CONTACT_LIMITS.links.max && <Button variant="quiet" size="sm" onClick={() => setLinks(current => [...current, ''])}><Plus size={15} aria-hidden="true" /> Add a link</Button>}
          </fieldset>

          <fieldset className={`contact-group ${errors.files ? 'field-invalid' : ''}`}>
            <legend className="field-label type-body"><Paperclip size={15} aria-hidden="true" /> Attachments <span className="contact-optional">(optional)</span></legend>
            <span className="field-hint type-caption" id="contact-files-hint">PDF, JPG or PNG. Up to {ATTACHMENT_RULES.maxFiles} files, 10 MB each and 15 MB in total. Screenshots help a lot with bug reports.</span>
            {files.length > 0 && <ul className="contact-files" aria-label="Attached files">
              {files.map((file, index) => {
                const fraction = progress[index] ?? 0
                return <li key={`${file.name}-${index}`} className="contact-file">
                  {file.type === 'application/pdf' ? <FileText size={18} aria-hidden="true" /> : <ImageIcon size={18} aria-hidden="true" />}
                  <span className="contact-file-text"><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span>
                  {sending && <progress className="contact-file-progress" max={1} value={fraction} aria-label={`Uploading ${file.name}`}>{Math.round(fraction * 100)}%</progress>}
                  {!sending && <button type="button" className="icon-button" aria-label={`Remove ${file.name}`} title="Remove file" onClick={() => removeFile(index)}><Trash2 size={16} aria-hidden="true" /></button>}
                </li>
              })}
            </ul>}
            {files.length > 0 && <span className="field-hint type-caption">{formatBytes(totalBytes)} of 15 MB used</span>}
            {files.length < ATTACHMENT_RULES.maxFiles && <label className="button button-quiet button-sm contact-file-pick">
              <Plus size={15} aria-hidden="true" /> Attach files
              <input ref={fileInputRef} className="visually-hidden" type="file" multiple accept={ATTACHMENT_ACCEPT} disabled={sending} aria-describedby="contact-files-hint" onChange={event => addFiles(event.target.files)} />
            </label>}
            <FieldError id="contact-files-error" message={errors.files} />
          </fieldset>

          {/* Honeypot: hidden from people and assistive technology; bots that fill it are ignored. */}
          <div className="contact-hp" aria-hidden="true">
            <label htmlFor="contact-website">Website</label>
            <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} />
          </div>

          {formError && <div className="form-error" role="alert">{formError}</div>}
          <div className="contact-actions">
            <Button type="submit" size="lg" loading={sending}>{sending ? (files.length ? 'Sending and uploading…' : 'Sending…') : <><Send size={16} aria-hidden="true" /> Send message</>}</Button>
            <p className="contact-privacy-note">By sending, you agree that DYPOL LABS stores this message to answer it, as described in the <Link to="/privacy">Privacy Policy</Link>.</p>
          </div>
        </form>}
    </div>
  </PublicPageShell>
}
