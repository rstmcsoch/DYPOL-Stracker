import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { CONTACT_REASONS, type ContactReason } from '../../lib/contact/reasons'

/**
 * Themed single-select for the contact reason (a listbox, not a native <select>).
 * Keyboard: Enter, Space, ArrowDown or ArrowUp opens; arrows, Home and End move; Enter or Space
 * picks; Escape or Tab closes; typing a letter jumps to the next reason starting with it.
 * Focus stays on the trigger and the active option is announced through aria-activedescendant.
 */
export function ReasonSelect({ value, onChange, error, labelId, describedBy }: {
  value: ContactReason | ''
  onChange: (value: ContactReason) => void
  error?: string
  labelId: string
  describedBy?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(() => Math.max(0, CONTACT_REASONS.findIndex(reason => reason.value === value)))
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listId = useId().replaceAll(':', '')
  const optionId = (index: number) => `${listId}-option-${index}`
  const selected = CONTACT_REASONS.find(reason => reason.value === value)

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
  })

  const openList = (index = Math.max(0, CONTACT_REASONS.findIndex(reason => reason.value === value))) => { setActive(index); setOpen(true) }
  const choose = (index: number) => {
    const reason = CONTACT_REASONS[index]
    if (!reason) return
    onChange(reason.value)
    setOpen(false)
    buttonRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = CONTACT_REASONS.length - 1
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        openList(event.key === 'ArrowUp' && !value ? last : undefined)
      }
      return
    }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(last, index + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)) }
    else if (event.key === 'Home') { event.preventDefault(); setActive(0) }
    else if (event.key === 'End') { event.preventDefault(); setActive(last) }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active) }
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
    else if (event.key === 'Tab') setOpen(false)
    else if (/^[a-z]$/i.test(event.key)) {
      const letter = event.key.toLowerCase()
      const order = [...CONTACT_REASONS.keys()].map(offset => (active + 1 + offset) % CONTACT_REASONS.length)
      const match = order.find(index => CONTACT_REASONS[index]!.label.toLowerCase().startsWith(letter))
      if (match !== undefined) setActive(match)
    }
  }

  return <div className={`reason-select ${open ? 'is-open' : ''} ${error ? 'is-invalid' : ''}`} ref={rootRef}>
    <button
      ref={buttonRef}
      type="button"
      className="reason-select-trigger type-input"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listId}
      aria-labelledby={`${labelId} ${listId}-value`}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      aria-activedescendant={open ? optionId(active) : undefined}
      onClick={() => (open ? setOpen(false) : openList())}
      onKeyDown={onKeyDown}
    >
      <span id={`${listId}-value`} className={selected ? 'reason-select-value' : 'reason-select-placeholder'}>{selected?.label ?? 'Choose a reason'}</span>
      <ChevronDown size={17} aria-hidden="true" className="reason-select-chevron" />
    </button>
    <ul id={listId} role="listbox" aria-labelledby={labelId} className="reason-select-list" hidden={!open} tabIndex={-1}>
      {CONTACT_REASONS.map((reason, index) => <li
        key={reason.value}
        id={optionId(index)}
        role="option"
        aria-selected={reason.value === value}
        className={`reason-select-option ${index === active ? 'is-active' : ''}`}
        onPointerEnter={() => setActive(index)}
        onMouseDown={event => event.preventDefault()}
        onClick={() => choose(index)}
      >
        <span className="reason-select-option-text"><strong>{reason.label}</strong><small>{reason.hint}</small></span>
        {reason.value === value && <Check size={16} aria-hidden="true" />}
      </li>)}
    </ul>
  </div>
}
