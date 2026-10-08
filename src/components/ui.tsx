import { Children, cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, Check, LoaderCircle, MoreHorizontal, Sparkles, X } from 'lucide-react'
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

export function Field({ label, hint, error, required, children, className = '' }: { label: string; hint?: string; error?: string; required?: boolean; children: ReactNode; className?: string }) {
  const fieldId = useId().replaceAll(':', '')
  const hintId = `${fieldId}-hint`
  const errorId = `${fieldId}-error`
  const controls = Children.map(children, child => {
    if (!isValidElement(child) || typeof child.type !== 'string' || !['input', 'select', 'textarea'].includes(child.type)) return child
    const element = child as ReactElement<Record<string, unknown>>
    const describedBy = [element.props['aria-describedby'], hint ? hintId : null, error ? errorId : null]
      .filter((value): value is string => typeof value === 'string' && value.length > 0).join(' ')
    return cloneElement(element, {
      'aria-invalid': error ? true : element.props['aria-invalid'],
      'aria-describedby': describedBy || undefined
    })
  })
  return <label className={`field ${error ? 'field-invalid' : ''} ${className}`}>
    <span className="field-label">{label}{required && <span className="required-mark" aria-hidden="true"> *</span>}</span>
    {controls}
    {hint && <span className="field-hint" id={hintId}>{hint}</span>}
    {error && <span className="field-error" id={errorId} role="alert">{error}</span>}
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

export function ConfirmDialog({ title, message, confirmLabel = 'Delete', danger = true, onConfirm, onCancel, loading = false }: { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void; loading?: boolean }) {
  return <Dialog title={title} onClose={onCancel} className="dialog-narrow">
    <p className="confirm-copy">{message}</p>
    <div className="dialog-actions"><Button variant="secondary" onClick={onCancel} disabled={loading}>Keep it</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{loading ? 'Working…' : confirmLabel}</Button></div>
  </Dialog>
}

export function SectionHeading({ title, note, action }: { title: string; note?: string; action?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2>{note && <p>{note}</p>}</div>{action}</div>
}

export interface OverflowMenuItem {
  id: string
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

/**
 * Compact ⋯ overflow menu for row actions. Rendered in a portal with fixed
 * coordinates so it is never clipped by a card, table, or the viewport edge, and it
 * closes on outside taps, Escape, scroll, and after every action.
 */
export function OverflowMenu({ label, items, menuWidth = 216 }: { label: string; items: OverflowMenuItem[]; menuWidth?: number }) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const margin = 8
    const estimatedHeight = items.length * 44 + 14
    let top = rect.bottom + 6
    // Flip above the trigger when there is no room below but there is above.
    if (top + estimatedHeight > window.innerHeight - margin && rect.top - estimatedHeight - 6 > margin) {
      top = Math.max(margin, rect.top - estimatedHeight - 6)
    }
    let left = rect.right - menuWidth
    left = Math.min(Math.max(margin, left), window.innerWidth - menuWidth - margin)
    setCoords({ top, left })
  }, [open, items.length, menuWidth])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node) || buttonRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus() } }
    const onScrollOrResize = () => setOpen(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    const focusTimer = window.setTimeout(() => menuRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus(), 20)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      clearTimeout(focusTimer)
    }
  }, [open])

  const runItem = (item: OverflowMenuItem) => {
    setOpen(false)
    buttonRef.current?.focus()
    item.onSelect()
  }

  return <>
    <button
      ref={buttonRef}
      type="button"
      className={`overflow-trigger ${open ? 'open' : ''}`}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={label}
      title={label}
      onClick={() => setOpen(value => !value)}
    >
      <MoreHorizontal size={18} strokeWidth={2.1} aria-hidden="true" />
    </button>
    {open && coords && createPortal(
      <div ref={menuRef} className="overflow-menu" role="menu" aria-label={label} style={{ top: coords.top, left: coords.left, width: menuWidth }}>
        {items.map(item => (
          <button key={item.id} type="button" role="menuitem" className={item.danger ? 'overflow-danger' : ''} disabled={item.disabled} onClick={() => runItem(item)}>
            {item.icon}<span>{item.label}</span>
          </button>
        ))}
      </div>,
      document.body
    )}
  </>
}

export function IllustrationNote({ children }: { children: ReactNode }) {
  return <div className="illustration-note"><Sparkles size={15} aria-hidden="true" />{children}<ArrowUpRight size={14} aria-hidden="true" /></div>
}

export function CheckMark({ checked }: { checked: boolean }) {
  return <span className={`checkmark ${checked ? 'checked' : ''}`} aria-hidden="true">{checked && <Check size={13} strokeWidth={3} />}</span>
}
