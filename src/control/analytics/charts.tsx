import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const AXIS = { fontSize: 11, fill: 'var(--cc-muted)' }
const shortDay = (day: string) => day.slice(5)

/** Daily line chart. Points are real per-day values (zero only where the day had none). */
export function DailyChart({ data, series, label }: { data: Record<string, unknown>[]; series: { key: string; name: string; color: string }[]; label: string }) {
  if (!data.length) return <p className="cc-muted">No data in this period.</p>
  return <figure className="cc-an-chart" aria-label={label}>
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="var(--cc-border-soft)" vertical={false} />
        <XAxis dataKey="day" tickFormatter={shortDay} tick={AXIS} minTickGap={16} />
        <YAxis allowDecimals={false} tick={AXIS} width={44} />
        <Tooltip contentStyle={{ background: 'var(--cc-surface)', border: '1px solid var(--cc-border)', color: 'var(--cc-text)', fontSize: 12 }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map(item => <Line key={item.key} type="monotone" dataKey={item.key} name={item.name} stroke={item.color} strokeWidth={2} dot={false} isAnimationActive={false} />)}
      </LineChart>
    </ResponsiveContainer>
    <figcaption className="cc-sr-only">{label}</figcaption>
  </figure>
}

export function BarList({ data, label, valueKey = 'count', nameKey = 'key' }: { data: Record<string, unknown>[]; label: string; valueKey?: string; nameKey?: string }) {
  if (!data.length) return <p className="cc-muted">No data in this period.</p>
  return <figure className="cc-an-chart" aria-label={label}>
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 30 + 20)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid stroke="var(--cc-border-soft)" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={AXIS} />
        <YAxis type="category" dataKey={nameKey} tick={AXIS} width={150} />
        <Tooltip contentStyle={{ background: 'var(--cc-surface)', border: '1px solid var(--cc-border)', color: 'var(--cc-text)', fontSize: 12 }} />
        <Bar dataKey={valueKey} fill="var(--cc-accent)" isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
    <figcaption className="cc-sr-only">{label}</figcaption>
  </figure>
}
