import { useEffect, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { DATE_RANGE_MESSAGE, MAX_INPUT_DATE, MIN_INPUT_DATE, isValidInputDate, parseDateText, parseTimeText, stepTime } from '../lib/date-input'

/**
 * Native date picker with a four-digit year range, paste support for typed dates
 * (2025-06-15 or 15/06/2025) and an explicit Clear button. Values outside 1900–2100 or
 * impossible dates are rejected inline instead of being saved as a corrupted year.
 */
export function DateInput({ value, onChange, label, clearable = true, disabled, min = MIN_INPUT_DATE, max = MAX_INPUT_DATE, invalid }: {
  value: string
  onChange: (value: string) => void
  label: string
  clearable?: boolean
  disabled?: boolean
  min?: string
  max?: string
  invalid?: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const accept = (next: string) => {
    if (next === '') { setError(null); onChange(''); return }
    if (isValidInputDate(next) && next >= min && next <= max) { setError(null); onChange(next); return }
    setError(DATE_RANGE_MESSAGE)
  }
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text')
    if (!text.trim()) return
    event.preventDefault()
    const parsed = parseDateText(text)
    if (parsed) accept(parsed)
    else setError(DATE_RANGE_MESSAGE)
  }
  return <span className="date-input-wrap">
    <span className="date-input-row">
      <input type="date" className="type-input" aria-label={label} min={min} max={max} value={value} disabled={disabled}
        aria-invalid={error || invalid ? true : undefined}
        onChange={event => accept(event.target.value)} onPaste={paste} />
      {clearable && <button type="button" className="date-input-clear" onClick={() => accept('')} disabled={disabled || !value} aria-label={`Clear ${label}`}>Clear</button>}
    </span>
    {error && <span className="field-error" role="alert">{error}</span>}
  </span>
}

/**
 * Reminder-style time field. Students can type or paste "8:30", "0830" or "8:30 pm"; the
 * value normalises to HH:MM on blur/Enter. ArrowUp moves later and ArrowDown earlier in
 * five-minute steps, wrapping around midnight.
 */
export function TimeInput({ value, onChange, label, disabled, step = 5, error }: {
  value: string
  onChange: (value: string) => void
  label: string
  disabled?: boolean
  step?: number
  error?: string
}) {
  const [text, setText] = useState(value)
  const [localError, setLocalError] = useState<string | null>(null)
  useEffect(() => { setText(value) }, [value])
  const commit = (raw: string) => {
    const parsed = parseTimeText(raw)
    if (parsed) { setLocalError(null); setText(parsed); if (parsed !== value) onChange(parsed); return true }
    setLocalError('Enter a time like 08:30 or 8:30 pm.')
    return false
  }
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const next = stepTime(parseTimeText(text) ?? value, event.key === 'ArrowUp' ? step : -step)
      setLocalError(null); setText(next); onChange(next)
    } else if (event.key === 'Enter') {
      if (!commit(text)) event.preventDefault()
    }
  }
  const shown = localError ?? error
  return <span className="date-input-wrap">
    <input type="text" inputMode="numeric" autoComplete="off" className="type-input" aria-label={label} placeholder="HH:MM" maxLength={11}
      value={text} disabled={disabled} aria-invalid={shown ? true : undefined}
      onChange={event => { setText(event.target.value); setLocalError(null); const parsed = parseTimeText(event.target.value); if (parsed && /^\d{1,2}[:.]\d{2}$/.test(event.target.value.trim())) onChange(parsed) }}
      onBlur={() => { if (text.trim()) commit(text); else setText(value) }}
      onPaste={event => { const pasted = event.clipboardData.getData('text'); if (!pasted.trim()) return; event.preventDefault(); setText(pasted.trim()); commit(pasted) }}
      onKeyDown={keyDown} />
    {shown && <span className="field-error" role="alert">{shown}</span>}
  </span>
}
