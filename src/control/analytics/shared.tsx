import { type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Badge, Panel } from '../ui'
import { formatDay, type Section } from './data'

const STATUS_TONE = { live: 'ok', historical: 'info', partial: 'warn', unavailable: 'neutral' } as const
const STATUS_LABEL = { live: 'Live', historical: 'Historical', partial: 'Partial', unavailable: 'Unavailable' } as const

export function StatusBadge({ section, timeZone }: { section?: Section; timeZone?: string }) {
  if (!section) return null
  return <span className="cc-an-status">
    <Badge tone={STATUS_TONE[section.status]}>{STATUS_LABEL[section.status]}</Badge>
    {section.coverageStart && <span className="cc-muted">since {formatDay(section.coverageStart, timeZone)}</span>}
  </span>
}

/** Metric definition: keyboard-focusable and announced to screen readers. */
export function Tip({ text }: { text: string }) {
  return <span className="cc-an-tip" tabIndex={0} role="img" aria-label={`Definition: ${text}`} title={text}><Info size={13} aria-hidden="true" /></span>
}

export function SectionPanel({ title, tip, section, timeZone, actions, children }: { title: string; tip?: string; section?: Section; timeZone?: string; actions?: ReactNode; children: ReactNode }) {
  return <Panel title={title} description={<>{tip && <>{tip} </>}{section?.note && <span className="cc-muted">{section.note}</span>}</>} actions={<>{<StatusBadge section={section} timeZone={timeZone} />}{actions}</>}>
    {section?.status === 'unavailable' ? <p className="cc-muted">No data for this view yet. {section.note}</p> : children}
  </Panel>
}

export function Kpi({ label, tip, value, previous, delta, unit = '', compare }: { label: string; tip: string; value: number | null; previous?: number | null; delta?: { abs: number; pct: number | null } | null; unit?: string; compare: boolean }) {
  const shown = value === null ? 'Unavailable' : `${Number.isInteger(value) ? value.toLocaleString('en-IN') : value.toFixed(2)}${unit}`
  return <div className="cc-stat">
    <span className="cc-stat__top"><span className="cc-stat__label">{label} <Tip text={tip} /></span></span>
    <strong className={`cc-stat__value${value === null ? ' cc-stat__value--small' : ''}`}>{shown}</strong>
    {compare && <span className="cc-stat__hint">{previous === null || previous === undefined ? 'No previous value' : `Previous: ${previous.toLocaleString('en-IN')}${unit}`}{delta ? ` · ${delta.abs >= 0 ? '+' : ''}${delta.abs.toLocaleString('en-IN')}${delta.pct === null ? '' : ` (${delta.pct >= 0 ? '+' : ''}${delta.pct}%)`}` : ''}</span>}
  </div>
}

export function DataTable({ rows, columns, empty = 'No rows for these filters.', caption }: { rows: Record<string, unknown>[]; columns: { key: string; label: string; tip?: string; render?: (row: Record<string, unknown>) => ReactNode }[]; empty?: string; caption: string }) {
  if (!rows.length) return <p className="cc-muted">{empty}</p>
  return <div className="cc-table-wrap" tabIndex={0} aria-label={`${caption}, scrollable on small screens`}>
    <table className="cc-table cc-an-table">
      <caption className="cc-sr-only">{caption}</caption>
      <thead><tr>{columns.map(column => <th key={column.key} scope="col">{column.label}{column.tip && <> <Tip text={column.tip} /></>}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>{columns.map(column => <td key={column.key}>{column.render ? column.render(row) : formatCell(row[column.key])}</td>)}</tr>)}</tbody>
    </table>
  </div>
}


function formatCell(value: unknown): ReactNode {
  if (value === null || value === undefined) return <span className="cc-muted">—</span>
  if (typeof value === 'number') return value.toLocaleString('en-IN')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

