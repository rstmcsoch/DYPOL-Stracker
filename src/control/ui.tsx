import { useEffect, useId, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react'
import { X, LoaderCircle, TriangleAlert } from 'lucide-react'

export type Tone = 'ok' | 'warn' | 'crit' | 'info' | 'neutral'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`cc-badge cc-badge--${tone}`}>{children}</span>
}

export function Panel({ title, description, actions, children, className = '', id, footer }: {
  title?: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string; footer?: ReactNode
}) {
  const headingId = useId()
  return (
    <section className={`cc-panel ${className}`} aria-labelledby={title ? headingId : undefined} id={id}>
      {(title || actions) && (
        <header className="cc-panel__header">
          <div>
            {title && <h2 id={headingId} className="cc-panel__title">{title}</h2>}
            {description && <p className="cc-panel__desc">{description}</p>}
          </div>
          {actions && <div className="cc-panel__actions">{actions}</div>}
        </header>
      )}
      <div className="cc-panel__body">{children}</div>
      {footer && <footer className="cc-panel__footer">{footer}</footer>}
    </section>
  )
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className={`cc-stat${tone ? ` cc-stat--${tone}` : ''}`}>
      <span className="cc-stat__label">{label}</span>
      <strong className="cc-stat__value">{value}</strong>
      {hint && <span className="cc-stat__hint">{hint}</span>}
    </div>
  )
}

export function Skeleton({ rows = 3, height = 14 }: { rows?: number; height?: number }) {
  return (
    <div className="cc-skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => <span key={index} style={{ height, width: `${92 - (index % 3) * 14}%` }} />)}
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="cc-inline-status" role="status"><LoaderCircle size={16} className="cc-spin" aria-hidden="true" />{label}</span>
}

export function EmptyState({ title, body, action }: { title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="cc-empty">
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="cc-error" role="alert">
      <TriangleAlert size={18} aria-hidden="true" />
      <div>
        <strong>Could not load this view.</strong>
        <p>{message}</p>
      </div>
      {onRetry && <Button variant="ghost" onClick={onRetry}>Try again</Button>}
    </div>
  )
}

export function Button({ variant = 'default', size = 'md', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  return <button type="button" {...props} className={`cc-btn cc-btn--${variant} cc-btn--${size} ${className}`} />
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <div className="cc-segmented" role="group" aria-label={label}>
      {options.map(option => (
        <button key={option.value} type="button" aria-pressed={option.value === value} className={option.value === value ? 'is-active' : ''} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Accessible modal: labelled, Escape closes (unless busy), focus moves in and returns on close. */
export function Dialog({ title, description, onClose, children, footer, busy = false, danger = false }: {
  title: string; description?: ReactNode; onClose: () => void; children: ReactNode; footer: ReactNode; busy?: boolean; danger?: boolean
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const focusable = panel.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])')
    focusable?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
      if (event.key === 'Tab' && panel.current) {
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]'))
        if (items.length === 0) return
        const first = items[0]!
        const last = items[items.length - 1]!
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [busy, onClose])
  return (
    <div className="cc-scrim" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`cc-dialog${danger ? ' cc-dialog--danger' : ''}`}>
        <header className="cc-dialog__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" data-close className="cc-icon-btn" aria-label="Close dialog" onClick={onClose} disabled={busy}><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="cc-dialog__body">{children}</div>
        <footer className="cc-dialog__footer">{footer}</footer>
      </div>
    </div>
  )
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string | null; children: ReactNode; htmlFor: string }) {
  return (
    <div className="cc-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="cc-field__error" role="alert">{error}</span> : hint ? <span className="cc-field__hint">{hint}</span> : null}
    </div>
  )
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <nav className="cc-pager" aria-label="Pagination">
      <span>{total === 0 ? 'No results' : `Page ${page} of ${pages} · ${total.toLocaleString()} total`}</span>
      <div>
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </nav>
  )
}
