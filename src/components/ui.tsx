import { useEffect, useRef, type FormEvent, type ReactNode } from 'react'
import { ArrowUpRight, Check, LoaderCircle, Sparkles, X } from 'lucide-react'
import type { Subject } from '../types'

export function Button({
  children, variant = 'primary', size = 'md', className = '', loading = false, type = 'button', ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger' | 'marker'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}) {
  return <button type={type} className={`button button-${variant} button-${size} ${className}`} disabled={props.disabled || loading} {...props}>
    {loading ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : null}{children}
  </button>
}

export function IconButton({ label, className = '', children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>
}

export function NotebookCard({ children, className = '', accent, style, ...props }: React.HTMLAttributes<HTMLElement> & { accent?: 'blue' | 'green' | 'orange' | 'yellow' | 'plain' }) {
  return <section className={`notebook-card ${accent ? `accent-${accent}` : ''} ${className}`} style={style} {...props}>{children}</section>
}

export function PageHeader({
  eyebrow, title, subtitle, action, doodle
}: { eyebrow?: string; title: string; subtitle?: string; action?: ReactNode; doodle?: ReactNode }) {
  return <div className="page-header">
    <div className="page-header-copy">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1>{title}{doodle && <span className="title-doodle" aria-hidden="true">{doodle}</span>}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {action && <div className="page-header-action">{action}</div>}
  </div>
}

export function SubjectBadge({ subject, withMark = false }: { subject: Subject | null | undefined; withMark?: boolean }) {
  if (!subject) return <span className="subject-badge subject-neutral">General</span>
  return <span className={`subject-badge subject-${subject.toLowerCase()}`}>
    {withMark && <span className="subject-mark" aria-hidden="true" />}{subject}
  </span>
}

export function StatusBadge({ children, tone = 'muted' }: { children: ReactNode; tone?: string }) {
  return <span className={`status-badge tone-${tone.toLowerCase().replaceAll(' ', '-')}`}>{children}</span>
}

export function StatCard({ label, value, note, icon, tint = 'paper', className = '' }: { label: string; value: ReactNode; note?: ReactNode; icon?: ReactNode; tint?: string; className?: string }) {
  return <NotebookCard className={`stat-card tint-${tint} ${className}`}>
    <div className="stat-top"><span>{label}</span>{icon && <span className="stat-icon">{icon}</span>}</div>
    <div className="stat-value">{value}</div>
    {note && <div className="stat-note">{note}</div>}
  </NotebookCard>
}

export function ProgressRing({ value, size = 94, label, sublabel, color = 'var(--ink)' }: { value: number; size?: number; label?: ReactNode; sublabel?: ReactNode; color?: string }) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  const radius = 40
  const circumference = 2 * Math.PI * radius
  const dash = circumference * safe / 100
  return <div className="progress-ring" style={{ width: size, height: size }} role="img" aria-label={`${Math.round(safe)} percent${sublabel ? `, ${String(sublabel)}` : ''}`}>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r={radius} className="progress-ring-track" />
      <circle cx="50" cy="50" r={radius} className="progress-ring-value" style={{ strokeDasharray: `${dash} ${circumference}`, stroke: color }} />
    </svg>
    <div className="progress-ring-label">{label ?? `${Math.round(safe)}%`}{sublabel && <small>{sublabel}</small>}</div>
  </div>
}

export function ProgressBar({ value, color = 'var(--accent)', label }: { value: number; color?: string; label?: string }) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  return <div className="progress-bar-wrap" aria-label={label}>
    <div className="progress-bar-track" role="progressbar" aria-valuenow={Math.round(safe)} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? 'Progress'}>
      <span style={{ width: `${safe}%`, background: color }} />
    </div>
    {label && <span className="progress-bar-caption">{label}</span>}
  </div>
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state">
    <div className="empty-illustration">{icon ?? <span className="empty-star">✳</span>}</div>
    <h3>{title}</h3><p>{description}</p>{action && <div className="empty-action">{action}</div>}
  </div>
}

export function Field({ label, hint, required, children, className = '' }: { label: string; hint?: string; required?: boolean; children: ReactNode; className?: string }) {
  return <label className={`field ${className}`}>
    <span className="field-label">{label}{required && <span className="required-mark" aria-hidden="true"> *</span>}</span>
    {children}
    {hint && <span className="field-hint">{hint}</span>}
  </label>
}

export function Dialog({ title, subtitle, onClose, children, className = '', labelledBy }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; className?: string; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const timer = window.setTimeout(() => ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus(), 20)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab' && ref.current) {
        const elements = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
        const first = elements[0]
        const last = elements.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.classList.add('modal-open')
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('modal-open')
      previous?.focus?.()
    }
  }, [onClose])
  const titleId = labelledBy ?? 'dialog-title'
  const stop = (event: FormEvent) => event.preventDefault()
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className={`dialog-panel ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} onSubmit={stop}>
      <div className="dialog-head"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton label="Close dialog" onClick={onClose}><X size={19} /></IconButton></div>
      <div className="dialog-content">{children}</div>
    </div>
  </div>
}

export function ConfirmDialog({ title, message, confirmLabel = 'Delete', danger = true, onConfirm, onCancel }: { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return <Dialog title={title} onClose={onCancel} className="dialog-narrow">
    <p className="confirm-copy">{message}</p>
    <div className="dialog-actions"><Button variant="secondary" onClick={onCancel}>Keep it</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button></div>
  </Dialog>
}

export function SectionHeading({ title, note, action }: { title: string; note?: string; action?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2>{note && <p>{note}</p>}</div>{action}</div>
}

export function IllustrationNote({ children }: { children: ReactNode }) {
  return <div className="illustration-note"><Sparkles size={15} aria-hidden="true" />{children}<ArrowUpRight size={14} aria-hidden="true" /></div>
}

export function CheckMark({ checked }: { checked: boolean }) {
  return <span className={`checkmark ${checked ? 'checked' : ''}`} aria-hidden="true">{checked && <Check size={13} strokeWidth={3} />}</span>
}
