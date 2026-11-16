/* eslint-disable react-refresh/only-export-components */
import { useId } from 'react'

/**
 * Lightweight SVG charts (bar, line, pie, donut, progress) drawn from the values the owner
 * typed in. No chart library: a few paths per chart, colours from the homepage tokens, and a
 * data table for screen readers and anyone who prefers numbers.
 */

export interface ChartData {
  kind: 'bar' | 'line' | 'pie' | 'donut' | 'progress'
  title: string
  xLabel: string
  yLabel: string
  legend: boolean
  height: number
  format: 'number' | 'decimal' | 'percent' | 'compact'
  unit: string
  max: number
  labels: string[]
  series: Array<{ name: string; color: string; values: number[] }>
}

const COLOR_VARS: Record<string, string> = {
  accent: 'var(--hp-accent-solid)', blue: 'var(--hp-blue-ink)', mint: 'var(--hp-mint-ink)', orange: 'var(--hp-orange-ink)', pink: 'var(--hp-pink-ink)',
  violet: 'var(--hp-violet-ink)', sky: 'var(--hp-sky-ink)', teal: 'var(--hp-teal-ink)', yellow: 'var(--hp-yellow)', ink: 'var(--hp-ink)'
}
const PIE_ORDER = ['accent', 'mint', 'orange', 'pink', 'violet', 'sky', 'teal', 'yellow', 'blue', 'ink']
const colorOf = (name: string | undefined) => COLOR_VARS[name ?? 'accent'] ?? 'var(--hp-accent-solid)'

export function formatValue(value: number, format: ChartData['format'], unit: string): string {
  let text: string
  if (format === 'percent') text = `${Math.round(value * 10) / 10}%`
  else if (format === 'decimal') text = value.toFixed(1)
  else if (format === 'compact') text = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  else text = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)
  return unit ? `${text} ${unit}` : text
}

function niceMax(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const scaled = value / power
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10
  return step * power
}

const W = 600
const PAD = { top: 16, right: 16, bottom: 44, left: 52 }

function Axes({ max, height, data }: { max: number; height: number; data: ChartData }) {
  const innerH = height - PAD.top - PAD.bottom
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  return <g className="sb-chart-axes">
    {ticks.map(tick => {
      const y = PAD.top + innerH * (1 - tick)
      return <g key={tick}>
        <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} />
        <text x={PAD.left - 8} y={y + 4} textAnchor="end">{formatValue(max * tick, data.format, '')}</text>
      </g>
    })}
    {data.yLabel && <text className="sb-chart-axis-label" x={12} y={PAD.top + innerH / 2} transform={`rotate(-90 12 ${PAD.top + innerH / 2})`} textAnchor="middle">{data.yLabel}</text>}
    {data.xLabel && <text className="sb-chart-axis-label" x={PAD.left + (W - PAD.left - PAD.right) / 2} y={height - 4} textAnchor="middle">{data.xLabel}</text>}
  </g>
}

function BarOrLine({ data }: { data: ChartData }) {
  const height = data.height
  const innerW = W - PAD.left - PAD.right
  const innerH = height - PAD.top - PAD.bottom
  const all = data.series.flatMap(series => series.values)
  const max = niceMax(Math.max(0, ...all))
  const slot = innerW / data.labels.length
  const y = (value: number) => PAD.top + innerH * (1 - Math.max(0, value) / max)
  return <>
    <Axes max={max} height={height} data={data} />
    {data.labels.map((label, index) => <text key={index} className="sb-chart-x" x={PAD.left + slot * (index + 0.5)} y={PAD.top + innerH + 16} textAnchor="middle">{label.length > 10 ? `${label.slice(0, 9)}…` : label}</text>)}
    {data.kind === 'bar'
      ? data.series.map((series, s) => {
        const barW = Math.max(4, (slot * 0.7) / data.series.length)
        return <g key={s} fill={colorOf(series.color)}>
          {series.values.map((value, index) => {
            const x = PAD.left + slot * index + slot * 0.15 + barW * s
            return <rect key={index} x={x} y={y(value)} width={barW - 2} height={Math.max(0, PAD.top + innerH - y(value))} rx={3} />
          })}
        </g>
      })
      : data.series.map((series, s) => {
        const points = series.values.map((value, index) => `${PAD.left + slot * (index + 0.5)},${y(value)}`).join(' ')
        return <g key={s} stroke={colorOf(series.color)} fill={colorOf(series.color)}>
          <polyline points={points} fill="none" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
          {series.values.map((value, index) => <circle key={index} cx={PAD.left + slot * (index + 0.5)} cy={y(value)} r={4} />)}
        </g>
      })}
  </>
}

function arc(cx: number, cy: number, r: number, start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0
  const x1 = cx + r * Math.sin(start), y1 = cy - r * Math.cos(start)
  const x2 = cx + r * Math.sin(end), y2 = cy - r * Math.cos(end)
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
}

function Pie({ data }: { data: ChartData }) {
  const values = (data.series[0]?.values ?? []).map(value => Math.max(0, value))
  const total = values.reduce((sum, value) => sum + value, 0)
  const height = data.height
  const r = Math.min(height / 2 - 12, 140)
  const cx = W / 2, cy = height / 2
  let angle = 0
  if (total <= 0) return <text x={cx} y={cy} textAnchor="middle" className="sb-chart-x">No values yet</text>
  return <g>
    {values.map((value, index) => {
      const start = angle
      angle += (value / total) * Math.PI * 2
      const end = values.filter(v => v > 0).length === 1 && value > 0 ? start + Math.PI * 2 - 0.0001 : angle
      return <path key={index} d={arc(cx, cy, r, start, end)} fill={colorOf(PIE_ORDER[index % PIE_ORDER.length])} stroke="var(--hp-card)" strokeWidth={2} />
    })}
    {data.kind === 'donut' && <circle cx={cx} cy={cy} r={r * 0.58} fill="var(--hp-card)" />}
    {data.kind === 'donut' && <text x={cx} y={cy + 6} textAnchor="middle" className="sb-chart-total">{formatValue(total, data.format, data.unit)}</text>}
  </g>
}

function Progress({ data }: { data: ChartData }) {
  const values = data.series[0]?.values ?? []
  const color = colorOf(data.series[0]?.color ?? 'accent')
  return <div className="sb-progress-list">
    {data.labels.map((label, index) => {
      const value = values[index] ?? 0
      const ratio = Math.min(1, Math.max(0, value / (data.max || 100)))
      return <div className="sb-progress" key={index}>
        <div className="sb-progress-head"><span>{label}</span><strong>{formatValue(value, data.format, data.unit)}</strong></div>
        <div className="sb-progress-track" aria-hidden="true"><span style={{ width: `${ratio * 100}%`, background: color }} /></div>
      </div>
    })}
  </div>
}

export function Chart({ data }: { data: ChartData }) {
  const id = useId()
  const summary = `${data.title || 'Chart'}: ${data.labels.map((label, index) => `${label} ${data.series.map(series => formatValue(series.values[index] ?? 0, data.format, data.unit)).join(' / ')}`).join(', ')}`
  const legendItems = data.kind === 'pie' || data.kind === 'donut'
    ? data.labels.map((label, index) => ({ name: label, color: PIE_ORDER[index % PIE_ORDER.length] }))
    : data.series.map(series => ({ name: series.name, color: series.color }))
  return <figure className="sb-chart" aria-labelledby={`${id}-t`}>
    {data.title && <figcaption id={`${id}-t`} className="sb-chart-title">{data.title}</figcaption>}
    {data.kind === 'progress'
      ? <Progress data={data} />
      : <svg className="sb-chart-svg" viewBox={`0 0 ${W} ${data.height}`} role="img" aria-label={summary} preserveAspectRatio="xMidYMid meet">
        {data.kind === 'pie' || data.kind === 'donut' ? <Pie data={data} /> : <BarOrLine data={data} />}
      </svg>}
    {data.legend && data.kind !== 'progress' && <ul className="sb-chart-legend">
      {legendItems.map((item, index) => <li key={index}><span style={{ background: colorOf(item.color) }} aria-hidden="true" />{item.name || `Series ${index + 1}`}</li>)}
    </ul>}
    <details className="sb-chart-data">
      <summary>View data</summary>
      <div className="sb-table-scroll"><table className="sb-table is-bordered">
        <thead><tr><th scope="col">{data.xLabel || 'Label'}</th>{data.series.map((series, index) => <th scope="col" key={index}>{series.name || `Series ${index + 1}`}</th>)}</tr></thead>
        <tbody>{data.labels.map((label, index) => <tr key={index}><th scope="row">{label}</th>{data.series.map((series, s) => <td key={s}>{formatValue(series.values[index] ?? 0, data.format, data.unit)}</td>)}</tr>)}</tbody>
      </table></div>
    </details>
  </figure>
}
