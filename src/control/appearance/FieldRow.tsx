import { useId } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '../ui'
import { INTERNAL_ROUTE_TARGETS, HOMEPAGE_ANCHOR_TARGETS, type FieldDefinition } from '../../lib/site-content/registry'
import { useContentEditor } from './ContentEditor'
import { OrderField } from './OrderField'

/** Suggestions for destination fields. They are hints only: the server accepts this list and nothing else internal. */
const LINK_SUGGESTIONS = [...INTERNAL_ROUTE_TARGETS, ...HOMEPAGE_ANCHOR_TARGETS]

/** Rendered once per screen; destination inputs point at it. */
export function LinkSuggestions() {
  return <datalist id="cc-link-suggestions">{LINK_SUGGESTIONS.map(target => <option key={target} value={target} />)}</datalist>
}

/** Sticky bar for a screen's unsaved edits: counts, validation summary, and the save and revert actions. */
export function SaveBar({ notice, onNotice }: { notice: { tone: 'ok' | 'crit'; text: string } | null; onNotice: (notice: { tone: 'ok' | 'crit'; text: string } | null) => void }) {
  const { dirtyKeys, errors, save, revertEdits, saving, draftExists } = useContentEditor()
  const count = dirtyKeys.length
  const invalid = Object.keys(errors).length
  return <div className="cc-savebar" role="region" aria-label="Draft actions">
    <div className="cc-savebar__status">
      {count === 0
        ? <span>{draftExists ? 'All edits are saved as draft.' : 'No unsaved edits.'}</span>
        : <span><strong>{count}</strong> unsaved {count === 1 ? 'edit' : 'edits'}{invalid ? ` · ${invalid} need${invalid === 1 ? 's' : ''} attention` : ''}</span>}
      {notice && <span className={`cc-savebar__notice is-${notice.tone}`} role="status">{notice.text}</span>}
    </div>
    <div className="cc-savebar__actions">
      <Button variant="ghost" onClick={() => { revertEdits(); onNotice(null) }} disabled={count === 0 || saving}>Revert edits</Button>
      <Button variant="primary" disabled={count === 0 || invalid > 0 || saving} onClick={async () => {
        const result = await save()
        onNotice(result.ok ? { tone: 'ok', text: result.message } : { tone: 'crit', text: result.message })
      }}>{saving ? 'Saving…' : 'Save draft'}</Button>
    </div>
  </div>
}

function preview(value: string, length = 140): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat
}

/**
 * One editable item: label, where it appears, the input (plain, multiline or destination),
 * the live value for comparison, the default, and validation. Used by every editor screen so
 * saving, validation and the "published vs draft" cue behave identically everywhere.
 */
export function FieldRow({ definition, showContext = true }: { definition: FieldDefinition; showContext?: boolean }) {
  const { values, savedValues, publishedValues, errors, setValue, resetToDefault, saving } = useContentEditor()
  const id = useId()
  const value = values[definition.key] ?? definition.defaultValue
  const live = publishedValues[definition.key] ?? definition.defaultValue
  const saved = savedValues[definition.key] ?? definition.defaultValue
  const changed = value !== saved
  const error = errors[definition.key] ?? null
  const isDefault = value === definition.defaultValue
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const inputId = `${id}-input`
  const describedBy = [hintId, error ? errorId : null].filter(Boolean).join(' ')
  const inputClass = `cc-input cc-field__input${error ? ' is-invalid' : ''}`

  return <div className={`cc-copy-field${changed ? ' is-changed' : ''}`} data-field-key={definition.key}>
    <div className="cc-copy-field__head">
      <label htmlFor={inputId} className="cc-copy-field__label">{definition.label}</label>
      <div className="cc-copy-field__badges">
        {changed && <span className="cc-badge cc-badge--info">Unsaved</span>}
        {!changed && value !== live && <span className="cc-badge cc-badge--warn">Draft differs from live</span>}
        {!isDefault && <Button size="sm" variant="ghost" onClick={() => resetToDefault(definition.key)} disabled={saving} aria-label={`Use the default for ${definition.label}`}>
          <RotateCcw size={13} aria-hidden="true" /> Default
        </Button>}
      </div>
    </div>
    {showContext && <p className="cc-copy-field__context">{definition.page} · {definition.section} · <code>{definition.key}</code></p>}

    {definition.type === 'order' ? (
      <OrderField definition={definition} value={value} values={values} disabled={saving} onChange={next => setValue(definition.key, next)} describedBy={describedBy} />
    ) : definition.type === 'select' ? (
      <select id={inputId} className={inputClass} value={value} onChange={event => setValue(definition.key, event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={describedBy} disabled={saving}>
        {(definition.options ?? []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    ) : definition.type === 'multiline' ? (
      <textarea id={inputId} className={`${inputClass} cc-copy-field__multiline`} rows={Math.min(8, Math.max(2, value.split('\n').length + 1))} value={value} onChange={event => setValue(definition.key, event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={describedBy} disabled={saving} />
    ) : definition.type === 'link' ? (
      <input id={inputId} type="text" className={inputClass} list="cc-link-suggestions" value={value} onChange={event => setValue(definition.key, event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={describedBy} autoComplete="off" spellCheck={false} disabled={saving} />
    ) : (
      <input id={inputId} type="text" className={inputClass} value={value} onChange={event => setValue(definition.key, event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={describedBy} disabled={saving} />
    )}

    <div className="cc-copy-field__foot">
      <span id={hintId} className="cc-field__hint">
        {error
          ? <span id={errorId} className="cc-field__error" role="alert">{error}</span>
          : <>{definition.help ? `${definition.help} ` : ''}{definition.type !== 'select' && definition.type !== 'order' && <span className="cc-copy-field__count">{value.length}/{definition.maxLength}</span>}</>}
      </span>
      {value !== live && <span className="cc-copy-field__live">Live: <span>{preview(definition.options?.find(option => option.value === live)?.label ?? live, 90)}</span></span>}
    </div>
  </div>
}
