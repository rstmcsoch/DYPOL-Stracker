import { ArrowLeft, ArrowRight, Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui'
import { CHART_COLORS, CHART_KINDS, CHART_LIMITS, TABLE_LIMITS, VALUE_FORMATS } from '../../lib/site-editor/blocks-spec'
import { FieldShell, RowActions } from './PropFields'

type Column = { label: string; align: string; width: string; hidden: boolean }
export interface TableValue { caption: string; header: boolean; striped: boolean; bordered: boolean; scroll: boolean; padding: string; columns: Column[]; rows: string[][] }
export interface ChartValue { kind: string; title: string; xLabel: string; yLabel: string; legend: boolean; height: number; format: string; unit: string; max: number; labels: string[]; series: Array<{ name: string; color: string; values: number[] }> }

type Change<T> = (next: T, coalesce?: string) => void

function swap<T>(items: T[], a: number, b: number): T[] {
  if (b < 0 || b >= items.length) return items
  const next = [...items]
  ;[next[a], next[b]] = [next[b] as T, next[a] as T]
  return next
}

/** Visual table builder: headings, cells, rows/columns (add, remove, reorder), widths, alignment, styling. */
export function TableEditor({ value, onChange }: { value: TableValue; onChange: Change<TableValue> }) {
  const set = (patch: Partial<TableValue>, coalesce?: string) => onChange({ ...value, ...patch }, coalesce)
  const setColumn = (index: number, patch: Partial<Column>, coalesce?: string) => set({ columns: value.columns.map((column, i) => (i === index ? { ...column, ...patch } : column)) }, coalesce)
  const addColumn = () => set({ columns: [...value.columns, { label: `Column ${value.columns.length + 1}`, align: 'left', width: 'auto', hidden: false }], rows: value.rows.map(row => [...row, '']) })
  const removeColumn = (index: number) => set({ columns: value.columns.filter((_, i) => i !== index), rows: value.rows.map(row => row.filter((_, i) => i !== index)) })
  const moveColumn = (index: number, to: number) => set({ columns: swap(value.columns, index, to), rows: value.rows.map(row => swap(row, index, to)) })
  const setCell = (r: number, c: number, text: string) => set({ rows: value.rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? text : cell)) : row)) }, `cell.${r}.${c}`)

  return <div className="le-table-editor">
    <FieldShell label="Caption (optional)" htmlFor="le-table-caption"><input id="le-table-caption" className="cc-input" value={value.caption} onChange={event => set({ caption: event.target.value }, 'caption')} /></FieldShell>
    <div className="le-toggles">
      {(['header', 'striped', 'bordered', 'scroll'] as const).map(key => <label key={key} className="le-check"><input type="checkbox" checked={value[key]} onChange={event => set({ [key]: event.target.checked })} /> {{ header: 'Header row', striped: 'Alternating rows', bordered: 'Borders', scroll: 'Scroll sideways on phones' }[key]}</label>)}
      <label className="le-inline">Cell padding <select className="cc-input" value={value.padding} onChange={event => set({ padding: event.target.value })}><option value="sm">Small</option><option value="md">Medium</option><option value="lg">Large</option></select></label>
    </div>

    <h4 className="le-subhead">Columns ({value.columns.length}/{TABLE_LIMITS.columns})</h4>
    <ol className="le-cards">
      {value.columns.map((column, index) => <li key={index} className="le-card">
        <div className="le-card__head">
          <input className="cc-input" aria-label={`Column ${index + 1} heading`} value={column.label} onChange={event => setColumn(index, { label: event.target.value }, `col.${index}`)} />
          <span className="le-row-actions">
            <button type="button" className="le-icon-btn" disabled={index === 0} onClick={() => moveColumn(index, index - 1)} aria-label="Move column left" title="Move left"><ArrowLeft size={14} /></button>
            <button type="button" className="le-icon-btn" disabled={index === value.columns.length - 1} onClick={() => moveColumn(index, index + 1)} aria-label="Move column right" title="Move right"><ArrowRight size={14} /></button>
            <button type="button" className="le-icon-btn is-danger" disabled={value.columns.length <= 1} onClick={() => removeColumn(index)} aria-label="Remove column" title="Remove column"><Trash2 size={14} /></button>
          </span>
        </div>
        <div className="le-inline-row">
          <label className="le-inline">Align <select className="cc-input" value={column.align} onChange={event => setColumn(index, { align: event.target.value })}><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>
          <label className="le-inline">Width <select className="cc-input" value={column.width} onChange={event => setColumn(index, { width: event.target.value })}><option value="auto">Auto</option><option value="narrow">Narrow</option><option value="medium">Medium</option><option value="wide">Wide</option></select></label>
          <label className="le-check"><input type="checkbox" checked={column.hidden} onChange={event => setColumn(index, { hidden: event.target.checked })} /> Hidden</label>
        </div>
      </li>)}
    </ol>
    <Button size="sm" disabled={value.columns.length >= TABLE_LIMITS.columns} onClick={addColumn}><Plus size={14} aria-hidden="true" /> Add column</Button>

    <h4 className="le-subhead">Rows ({value.rows.length}/{TABLE_LIMITS.rows})</h4>
    <ol className="le-cards">
      {value.rows.map((row, r) => <li key={r} className="le-card">
        <div className="le-card__head"><strong>Row {r + 1}</strong><RowActions index={r} count={value.rows.length} label={`row ${r + 1}`} onMove={to => set({ rows: swap(value.rows, r, to) })} onRemove={() => set({ rows: value.rows.filter((_, i) => i !== r) })} /></div>
        {value.columns.map((column, c) => <label key={c} className="le-cell"><span>{column.label || `Column ${c + 1}`}</span><input className="cc-input" value={row[c] ?? ''} onChange={event => setCell(r, c, event.target.value)} /></label>)}
      </li>)}
    </ol>
    <Button size="sm" disabled={value.rows.length >= TABLE_LIMITS.rows} onClick={() => set({ rows: [...value.rows, value.columns.map(() => '')] })}><Plus size={14} aria-hidden="true" /> Add row</Button>
  </div>
}

/** Chart builder: type, data points (labels), series values and colours, titles, axes, format, size. */
export function ChartEditor({ value, onChange }: { value: ChartValue; onChange: Change<ChartValue> }) {
  const set = (patch: Partial<ChartValue>, coalesce?: string) => onChange({ ...value, ...patch }, coalesce)
  const single = value.kind === 'pie' || value.kind === 'donut' || value.kind === 'progress'
  const series = single ? value.series.slice(0, 1) : value.series
  const setSeries = (index: number, patch: Partial<ChartValue['series'][number]>, coalesce?: string) => set({ series: value.series.map((item, i) => (i === index ? { ...item, ...patch } : item)) }, coalesce)

  return <div className="le-chart-editor">
    <div className="le-inline-row">
      <label className="le-inline">Type <select className="cc-input" value={value.kind} onChange={event => set({ kind: event.target.value })}>{CHART_KINDS.map(kind => <option key={kind} value={kind}>{kind}</option>)}</select></label>
      <label className="le-inline">Format <select className="cc-input" value={value.format} onChange={event => set({ format: event.target.value })}>{VALUE_FORMATS.map(format => <option key={format} value={format}>{format}</option>)}</select></label>
      <label className="le-inline">Unit <input className="cc-input le-narrow" value={value.unit} maxLength={8} onChange={event => set({ unit: event.target.value }, 'unit')} /></label>
    </div>
    <FieldShell label="Title" htmlFor="le-chart-title"><input id="le-chart-title" className="cc-input" value={value.title} onChange={event => set({ title: event.target.value }, 'title')} /></FieldShell>
    {!single && <div className="le-inline-row">
      <label className="le-inline">X axis <input className="cc-input" value={value.xLabel} onChange={event => set({ xLabel: event.target.value }, 'x')} /></label>
      <label className="le-inline">Y axis <input className="cc-input" value={value.yLabel} onChange={event => set({ yLabel: event.target.value }, 'y')} /></label>
    </div>}
    <div className="le-inline-row">
      <label className="le-check"><input type="checkbox" checked={value.legend} onChange={event => set({ legend: event.target.checked })} /> Legend</label>
      {value.kind !== 'progress' && <label className="le-inline">Height <input className="cc-input le-narrow" type="number" min={140} max={600} step={10} value={value.height} onChange={event => set({ height: Number(event.target.value) || 260 }, 'height')} /></label>}
      {value.kind === 'progress' && <label className="le-inline">Max value <input className="cc-input le-narrow" type="number" min={1} value={value.max} onChange={event => set({ max: Number(event.target.value) || 100 }, 'max')} /></label>}
    </div>

    <h4 className="le-subhead">Data points ({value.labels.length}/{CHART_LIMITS.labels})</h4>
    <div className="le-chart-grid" role="table" aria-label="Chart data">
      <div className="le-chart-grid__row is-head" role="row">
        <span role="columnheader">Label</span>
        {series.map((item, s) => <span key={s} role="columnheader">{item.name || `Series ${s + 1}`}</span>)}
        <span role="columnheader"><span className="cc-sr-only">Actions</span></span>
      </div>
      {value.labels.map((label, index) => <div key={index} className="le-chart-grid__row" role="row">
        <input role="cell" className="cc-input" aria-label={`Label ${index + 1}`} value={label} onChange={event => set({ labels: value.labels.map((item, i) => (i === index ? event.target.value : item)) }, `label.${index}`)} />
        {series.map((item, s) => <input key={s} role="cell" className="cc-input" type="number" inputMode="decimal" step="any" aria-label={`${item.name || `Series ${s + 1}`} value for ${label}`} value={item.values[index] ?? 0}
          onChange={event => setSeries(s, { values: value.labels.map((_, i) => (i === index ? Number(event.target.value) || 0 : item.values[i] ?? 0)) }, `v.${s}.${index}`)} />)}
        <button type="button" role="cell" className="le-icon-btn is-danger" disabled={value.labels.length <= 1} aria-label={`Remove ${label}`} title="Remove data point"
          onClick={() => set({ labels: value.labels.filter((_, i) => i !== index), series: value.series.map(item => ({ ...item, values: item.values.filter((_, i) => i !== index) })) })}><Trash2 size={14} /></button>
      </div>)}
    </div>
    <Button size="sm" disabled={value.labels.length >= CHART_LIMITS.labels} onClick={() => set({ labels: [...value.labels, `Item ${value.labels.length + 1}`], series: value.series.map(item => ({ ...item, values: [...item.values, 0] })) })}><Plus size={14} aria-hidden="true" /> Add data point</Button>

    <h4 className="le-subhead">{single ? 'Colour' : `Series (${value.series.length}/${CHART_LIMITS.series})`}</h4>
    <ol className="le-cards">
      {series.map((item, s) => <li key={s} className="le-card">
        <div className="le-inline-row">
          {!single && <input className="cc-input" aria-label={`Series ${s + 1} name`} value={item.name} onChange={event => setSeries(s, { name: event.target.value }, `name.${s}`)} />}
          <select className="cc-input" aria-label={`Series ${s + 1} colour`} value={item.color} onChange={event => setSeries(s, { color: event.target.value })}>{CHART_COLORS.map(color => <option key={color} value={color}>{color}</option>)}</select>
          {!single && <button type="button" className="le-icon-btn is-danger" disabled={value.series.length <= 1} onClick={() => set({ series: value.series.filter((_, i) => i !== s) })} aria-label="Remove series" title="Remove series"><Trash2 size={14} /></button>}
        </div>
      </li>)}
    </ol>
    {!single && <Button size="sm" disabled={value.series.length >= CHART_LIMITS.series} onClick={() => set({ series: [...value.series, { name: `Series ${value.series.length + 1}`, color: CHART_COLORS[value.series.length % CHART_COLORS.length]!, values: value.labels.map(() => 0) }] })}><Plus size={14} aria-hidden="true" /> Add series</Button>}
    {single && <p className="le-hint">{value.kind === 'progress' ? 'Each data point is one bar out of the max value.' : 'Pie and donut charts use the first series; each data point is one slice.'}</p>}
  </div>
}
