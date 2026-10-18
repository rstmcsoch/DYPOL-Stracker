import { ArrowDown, ArrowUp, EyeOff, Plus } from 'lucide-react'
import { Button } from '../ui'
import { parseOrder } from '../../lib/site-content/content'
import type { FieldDefinition } from '../../lib/site-content/registry'

/**
 * Editor for `order` fields: reorder, hide and restore numbered items (e.g. feature cards).
 * The stored value stays a plain "3,1,2" string, validated by the shared content rules.
 */
export function OrderField({ definition, value, values, disabled, onChange, describedBy }: {
  definition: FieldDefinition
  value: string
  values: Record<string, string>
  disabled: boolean
  onChange: (next: string) => void
  describedBy: string
}) {
  const count = definition.itemCount ?? 0
  const fallback = parseOrder(definition.defaultValue, count) ?? []
  const order = parseOrder(value, count) ?? fallback
  const hidden = Array.from({ length: count }, (_, index) => index + 1).filter(n => !order.includes(n))
  const minItems = definition.minItems ?? 1
  const labelFor = (n: number) => {
    const key = definition.itemLabelKey?.replace('{n}', String(n))
    return (key && values[key]) || `Item ${n}`
  }
  const commit = (next: number[]) => onChange(next.join(','))
  const move = (index: number, delta: number) => {
    const next = order.slice()
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const moved = next[index]
    const swapped = next[target]
    if (moved === undefined || swapped === undefined) return
    next[index] = swapped
    next[target] = moved
    commit(next)
  }

  return <div className="cc-order-field" aria-describedby={describedBy}>
    <ol className="cc-order-list" aria-label={`${definition.label}: shown, in order`}>
      {order.map((n, index) => <li key={n} className="cc-order-item">
        <span className="cc-order-pos">{String(index + 1).padStart(2, '0')}</span>
        <span className="cc-order-label">{labelFor(n)}</span>
        <span className="cc-order-actions">
          <Button size="sm" variant="ghost" onClick={() => move(index, -1)} disabled={disabled || index === 0} aria-label={`Move ${labelFor(n)} up`}><ArrowUp size={13} aria-hidden="true" /></Button>
          <Button size="sm" variant="ghost" onClick={() => move(index, 1)} disabled={disabled || index === order.length - 1} aria-label={`Move ${labelFor(n)} down`}><ArrowDown size={13} aria-hidden="true" /></Button>
          <Button size="sm" variant="ghost" onClick={() => commit(order.filter(item => item !== n))} disabled={disabled || order.length <= minItems} aria-label={`Hide ${labelFor(n)}`}><EyeOff size={13} aria-hidden="true" /> Hide</Button>
        </span>
      </li>)}
    </ol>
    {hidden.length > 0 && <div className="cc-order-hidden">
      <p className="cc-muted">Hidden</p>
      <ul>
        {hidden.map(n => <li key={n} className="cc-order-item">
          <span className="cc-order-label">{labelFor(n)}</span>
          <Button size="sm" variant="ghost" onClick={() => commit([...order, n])} disabled={disabled} aria-label={`Show ${labelFor(n)}`}><Plus size={13} aria-hidden="true" /> Show</Button>
        </li>)}
      </ul>
    </div>}
  </div>
}
