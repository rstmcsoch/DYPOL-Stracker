import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, CloudUpload, FileText, ImageIcon, Link2, Plus, Send, Trash2, X } from 'lucide-react'
import { PublicPageShell } from '../components/public/PublicPageShell'
import { BlockRoot, PageLayout } from '../components/public/PageLayout'
import { ReasonSelect } from '../components/contact/ReasonSelect'
import { Button } from '../components/ui'
import { TurnstileWidget, type TurnstileHandle } from '../components/TurnstileWidget'
import { useOptionalUser } from '../contexts/AuthContext'
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_RULES,
  CONTACT_LIMITS,
  DEFAULT_CONTACT_REASON,
  REASON_FORMS,
  attachmentProblem,
  cleanContactDetails,
  formatBytes,
  validateContactDraft,
  type ContactDetails,
  type ContactReason,
  type FormField
} from '../lib/contact/reasons'
import { ContactSubmitError, submitContactMessage } from '../lib/contact/submit'

type Phase = { kind: 'editing' } | { kind: 'sending' } | { kind: 'sent' }

/** Heading of the reason's own section. */
const SECTION_TITLES: Record<ContactReason, { title: string; intro: string; noun: string }> = {
  general_query: { title: 'How can we help?', intro: 'Ask about Stracker, your account or your data.', noun: 'question' },
  feature_request: { title: 'Suggest a feature', intro: 'Tell us what you wish Stracker could do for your preparation.', noun: 'idea' },
  bug_report: { title: 'The problem', intro: 'The more precise you are, the faster we can fix it.', noun: 'bug report' },
  complaint: { title: 'Your complaint', intro: 'Tell us what went wrong and what would put it right.', noun: 'complaint' },
  copyright: { title: 'Your copyright notice', intro: 'Every part of this notice is needed for us to act on it.', noun: 'notice' },
  sponsorship: { title: 'About the partnership', intro: 'Tell us who you are and what you have in mind.', noun: 'proposal' }
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <span className="field-error type-alert" id={id} role="alert">{message}</span> : null
}

function Required() {
  return <span className="required-mark" aria-hidden="true"> *</span>
}

function errorKey(field: FormField): string {
  return field.target ?? `details.${field.key}`
}

function FormFieldInput({ field, value, error, onChange }: { field: FormField; value: string | boolean | undefined; error?: string; onChange: (value: string | boolean) => void }) {
  const id = field.target ? `contact-${field.target}` : `contact-detail-${field.key}`
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const countId = `${id}-count`
  const text = typeof value === 'string' ? value : ''
  const multiline = field.type === 'multiline'
  const described = [field.hint ? hintId : '', multiline ? countId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined
  if (field.type === 'checkbox') {
    return <div className={`contact-check ${error ? 'field-invalid' : ''}`}>
      <label htmlFor={id}>
        <input id={id} type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} aria-invalid={error ? true : undefined} aria-describedby={described} />
        <span>{field.label}{field.required && <Required />}</span>
      </label>
      <FieldError id={errorId} message={error} />
    </div>
  }
  const common = {
    id,
    value: text,
    maxLength: field.max,
    placeholder: field.placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': described,
    'aria-required': field.required ? true : undefined,
    className: 'type-input'
  }
  return <div className={`field ${error ? 'field-invalid' : ''}`}>
    <label className="field-label type-body" htmlFor={id}>{field.label}{field.required ? <Required /> : <span className="contact-optional"> (optional)</span>}</label>
    {multiline
      ? <textarea {...common} rows={field.rows ?? 3} onChange={event => onChange(event.target.value)} />
      : <input {...common} type={field.type === 'url' ? 'url' : 'text'} inputMode={field.type === 'url' ? 'url' : undefined} onChange={event => onChange(event.target.value)} />}
    {(field.hint || multiline) && <div className="contact-field-foot">
      {field.hint ? <span className="field-hint type-caption" id={hintId}>{field.hint}</span> : <span />}
      {multiline && <span className="contact-count type-caption" id={countId} aria-label={`${text.trim().length} of ${field.max} characters`}>{text.trim().length} / {field.max}</span>}
    </div>}
    <FieldError id={errorId} message={error} />
  </div>
}

function SectionHead({ step, title, intro, id }: { step: number; title: string; intro?: string; id: string }) {
  return <div className="contact-section-head">
    <span className="contact-step" aria-hidden="true">{step}</span>
    <div>
      <h2 id={id}>{title}</h2>
      {intro && <p>{intro}</p>}
    </div>
  </div>
}

/**
 * Public Contact page (/contact). Works signed out and signed in (the email and name are
 * prefilled, and the message is linked to the account). Messages arrive in Control Center →
 * Messages. Three sections: About you, the reason's own fields (one coherent set per reason,
 * whose main description is the message), then optional links and files.
 */
export default function ContactPage() {
  const user = useOptionalUser()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState<ContactReason>(DEFAULT_CONTACT_REASON)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [details, setDetails] = useState<ContactDetails>({})
  const [links, setLinks] = useState<string[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [progress, setProgress] = useState<number[]>([])
  const [dragging, setDragging] = useState(false)
  const [website, setWebsite] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const captcha = useRef<TurnstileHandle>(null)
  const successRef = useRef<HTMLHeadingElement>(null)
  const reasonLabelId = useId().replaceAll(':', '')

  useEffect(() => {
    if (!user || user.isLocal) return
    setEmail(current => current || user.email)
    setName(current => current || user.displayName)
  }, [user])

  useEffect(() => { if (phase.kind === 'sent') successRef.current?.focus() }, [phase.kind])

  const form = REASON_FORMS[reason]
  const section = SECTION_TITLES[reason]
  const sending = phase.kind === 'sending'
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)

  const valueOf = (field: FormField) => (field.target === 'subject' ? subject : field.target === 'message' ? message : details[field.key])
  const setValue = (field: FormField, value: string | boolean) => {
    if (field.target === 'subject') setSubject(String(value))
    else if (field.target === 'message') setMessage(String(value))
    else setDetails(current => ({ ...current, [field.key]: value }))
  }

  const chooseReason = (next: ContactReason) => {
    if (next === reason) return
    setReason(next)
    // Keep only the values that belong to the new reason, so hidden fields are never sent.
    setDetails(current => Object.fromEntries(Object.entries(current).filter(([key]) => REASON_FORMS[next].some(field => !field.target && field.key === key))))
    if (!REASON_FORMS[next].some(field => field.target === 'subject')) setSubject('')
    setErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith('details.') && !['reason', 'subject', 'message'].includes(key))))
  }

  const addFiles = (list: FileList | File[] | null) => {
    if (!list || !list.length || sending) return
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

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    addFiles(event.dataTransfer.files)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending) return
    setFormError(null)
    const draft = { name, email, reason, subject, message, details: cleanContactDetails(reason, details), links }
    const found = validateContactDraft(draft) as Record<string, string>
    const fileIssue = attachmentProblem(files.map(file => ({ name: file.name, size: file.size, type: file.type })))
    if (fileIssue) found.files = fileIssue
    setErrors(found)
    if (Object.keys(found).length) {
      setFormError('Check the highlighted fields.')
      window.setTimeout(() => document.querySelector<HTMLElement>('.contact-form [aria-invalid="true"]')?.focus(), 0)
      return
    }
    setPhase({ kind: 'sending' })
    setProgress(files.map(() => 0))
    try {
      const captchaToken = await captcha.current?.getToken()
      await submitContactMessage({ name, email, reason, subject, message, details: draft.details, links, files, website, captchaToken }, (index, fraction) => {
        setProgress(current => current.map((value, position) => (position === index ? fraction : value)))
      })
      setPhase({ kind: 'sent' })
    } catch (error) {
      const failure = error instanceof ContactSubmitError ? error : new ContactSubmitError('Your message could not be sent. Try again in a few minutes.')
      if (failure.fields) setErrors(failure.fields)
      setFormError(failure.message)
      setPhase({ kind: 'editing' })
    }
    // Turnstile tokens are single-use: start a fresh check for the next attempt.
    captcha.current?.reset()
  }

  const reset = () => {
    setReason(DEFAULT_CONTACT_REASON); setSubject(''); setMessage(''); setDetails({}); setLinks([]); setFiles([]); setProgress([]); setErrors({}); setFormError(null)
    setPhase({ kind: 'editing' })
  }

  return <PublicPageShell title="Contact" description="Send a question, feature request, bug report, complaint, copyright notice or sponsorship proposal to the Stracker team at DYPOL LABS.">
    <PageLayout page="contact" sections={{ 'stracker.contact': () => <BlockRoot className="pub-shell pub-doc-shell contact-shell">
      <header className="pub-doc-head contact-head">
        <p className="pub-eyebrow"><span aria-hidden="true">✎</span> STRACKER BY DYPOL LABS</p>
        <h1 id="contact-title">Contact the Stracker team</h1>
        <p className="contact-lede">Ask a question, suggest what would make Stracker better for your preparation, or report something that is not working. Every message goes straight to the Stracker team at DYPOL LABS, and we reply to the email address you give.</p>
      </header>

      {phase.kind === 'sent'
        ? <section className="pub-doc-card contact-card contact-sent" aria-labelledby="contact-sent-title" role="status">
          <span className="contact-sent-badge"><CheckCircle2 size={30} aria-hidden="true" /></span>
          <h2 id="contact-sent-title" ref={successRef} tabIndex={-1}>Message sent</h2>
          <p>Thanks{name.trim() ? `, ${name.trim().split(/\s+/)[0]}` : ''}. Your {section.noun} has reached the Stracker team{files.length ? `, with ${files.length} ${files.length === 1 ? 'file' : 'files'}` : ''}. If it needs a reply, we will write to <strong>{email.trim()}</strong>.</p>
          <div className="contact-sent-actions">
            <Button variant="secondary" onClick={reset}><Plus size={16} aria-hidden="true" /> Send another message</Button>
            <Link className="button button-quiet button-md contact-sent-home" to="/">Back to Stracker <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        </section>
        : <form className="pub-doc-card contact-card contact-form" onSubmit={event => void submit(event)} noValidate aria-labelledby="contact-title" aria-busy={sending}>
          <section className="contact-section" aria-labelledby="contact-about-title">
            <SectionHead step={1} id="contact-about-title" title="About you" intro="So we know who to reply to." />
            <div className="contact-grid">
              <div className={`field ${errors.name ? 'field-invalid' : ''}`}>
                <label className="field-label type-body" htmlFor="contact-name">Your name<Required /></label>
                <input id="contact-name" className="type-input" autoComplete="name" maxLength={CONTACT_LIMITS.name.max} value={name} onChange={event => setName(event.target.value)} aria-required="true" aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? 'contact-name-error' : undefined} />
                <FieldError id="contact-name-error" message={errors.name} />
              </div>
              <div className={`field ${errors.email ? 'field-invalid' : ''}`}>
                <label className="field-label type-body" htmlFor="contact-email">Email for our reply<Required /></label>
                <input id="contact-email" className="type-input" type="email" inputMode="email" autoComplete="email" maxLength={CONTACT_LIMITS.email.max} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" aria-required="true" aria-invalid={errors.email ? true : undefined} aria-describedby={['contact-email-hint', errors.email ? 'contact-email-error' : ''].filter(Boolean).join(' ')} />
                <span className="field-hint type-caption" id="contact-email-hint">{user && !user.isLocal ? 'Filled in from your Stracker account. You can change it.' : 'Used only to reply to this message.'}</span>
                <FieldError id="contact-email-error" message={errors.email} />
              </div>
            </div>
          </section>

          <section className="contact-section" aria-labelledby="contact-reason-title">
            <SectionHead step={2} id="contact-reason-title" title={section.title} intro={section.intro} />
            <div className={`field ${errors.reason ? 'field-invalid' : ''}`}>
              <span className="field-label type-body" id={reasonLabelId}>What is it about?</span>
              <ReasonSelect value={reason} onChange={chooseReason} error={errors.reason} labelId={reasonLabelId} describedBy={errors.reason ? 'contact-reason-error' : undefined} />
              <FieldError id="contact-reason-error" message={errors.reason} />
            </div>
            <div className="contact-reveal" key={reason} data-reason={reason}>
              {form.map(field => <FormFieldInput key={field.key} field={field} value={valueOf(field)} error={errors[errorKey(field)]} onChange={value => setValue(field, value)} />)}
            </div>
          </section>

          <section className="contact-section" aria-labelledby="contact-extras-title">
            <SectionHead step={3} id="contact-extras-title" title="Links and attachments" intro={`Optional. Up to ${CONTACT_LIMITS.links.max} links and ${ATTACHMENT_RULES.maxFiles} files.`} />

            <fieldset className="contact-group">
              <legend className="visually-hidden">Links</legend>
              {links.map((link, index) => <div className={`contact-link-row ${errors[`links.${index}`] ? 'field-invalid' : ''}`} key={index}>
                <span className="contact-link-input">
                  <Link2 size={16} aria-hidden="true" />
                  <input className="type-input" type="url" inputMode="url" aria-label={`Link ${index + 1}`} placeholder="https://" maxLength={CONTACT_LIMITS.links.length} value={link} onChange={event => setLinks(current => current.map((value, position) => (position === index ? event.target.value : value)))} aria-invalid={errors[`links.${index}`] ? true : undefined} aria-describedby={errors[`links.${index}`] ? `contact-link-${index}-error` : undefined} />
                </span>
                <button type="button" className="icon-button contact-remove" aria-label={`Remove link ${index + 1}`} title="Remove link" onClick={() => { setLinks(current => current.filter((_, position) => position !== index)); setErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith('links.')))) }}><X size={16} aria-hidden="true" /></button>
                <FieldError id={`contact-link-${index}-error`} message={errors[`links.${index}`]} />
              </div>)}
              {links.length < CONTACT_LIMITS.links.max && <button type="button" className="contact-add" onClick={() => setLinks(current => [...current, ''])}><Plus size={16} aria-hidden="true" /> Add a link</button>}
            </fieldset>

            <fieldset className={`contact-group ${errors.files ? 'field-invalid' : ''}`}>
              <legend className="visually-hidden">Attachments</legend>
              {files.length < ATTACHMENT_RULES.maxFiles && !sending && <div
                className={`contact-drop ${dragging ? 'is-dragging' : ''}`}
                onDragOver={event => { event.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <CloudUpload size={26} aria-hidden="true" />
                <span className="contact-drop-text">
                  <label className="contact-drop-pick">
                    Attach files
                    <input ref={fileInputRef} className="visually-hidden" type="file" multiple accept={ATTACHMENT_ACCEPT} disabled={sending} aria-describedby="contact-files-hint" onChange={event => addFiles(event.target.files)} />
                  </label>
                  {' '}or drop them here
                </span>
                <span className="field-hint type-caption" id="contact-files-hint">PDF, JPG or PNG · up to 10 MB each, 15 MB in total{reason === 'bug_report' ? ' · a screenshot helps a lot' : ''}</span>
              </div>}
              {files.length > 0 && <ul className="contact-files" aria-label="Attached files">
                {files.map((file, index) => {
                  const fraction = progress[index] ?? 0
                  return <li key={`${file.name}-${index}`} className="contact-file">
                    <span className="contact-file-icon">{file.type === 'application/pdf' ? <FileText size={17} aria-hidden="true" /> : <ImageIcon size={17} aria-hidden="true" />}</span>
                    <span className="contact-file-text"><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span>
                    {sending && <progress className="contact-file-progress" max={1} value={fraction} aria-label={`Uploading ${file.name}`}>{Math.round(fraction * 100)}%</progress>}
                    {!sending && <button type="button" className="icon-button contact-remove" aria-label={`Remove ${file.name}`} title="Remove file" onClick={() => removeFile(index)}><Trash2 size={16} aria-hidden="true" /></button>}
                  </li>
                })}
              </ul>}
              {files.length > 0 && <span className="field-hint type-caption contact-total">{formatBytes(totalBytes)} of 15 MB used</span>}
              <FieldError id="contact-files-error" message={errors.files} />
            </fieldset>
          </section>

          {/* Honeypot: hidden from people and assistive technology; bots that fill it are ignored. */}
          <div className="contact-hp" aria-hidden="true">
            <label htmlFor="contact-website">Website</label>
            <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} />
          </div>

          {formError && <div className="form-error" role="alert">{formError}</div>}
          <TurnstileWidget ref={captcha} action="contact" />
          <div className="contact-actions">
            <Button type="submit" size="lg" className="contact-send" loading={sending}>{sending ? (files.length ? 'Sending and uploading…' : 'Sending…') : <><Send size={17} aria-hidden="true" /> Send {section.noun}</>}</Button>
            <p className="contact-privacy-note">By sending, you agree that DYPOL LABS stores this message to answer it, as described in the <Link to="/privacy">Privacy Policy</Link>.</p>
          </div>
        </form>}
    </BlockRoot> }} />
  </PublicPageShell>
}
