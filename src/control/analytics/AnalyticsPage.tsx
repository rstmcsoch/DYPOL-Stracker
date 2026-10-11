import { Suspense, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, RefreshCw } from 'lucide-react'
import { PageHeader } from '../pageParts'
import { Button, Skeleton } from '../ui'
import { controlDownload } from '../api'
import { useSensitiveAction } from '../reauth'
import { useToast } from '../../contexts/ToastContext'
import { useFilterQuery } from './data'
import * as Tabs from './tabs'


const TABS = [
  ['overview', 'Overview'], ['realtime', 'Real-time'], ['traffic', 'Traffic & Acquisition'], ['pages', 'Pages & Content'],
  ['audience', 'Users & Audience'], ['funnels', 'Signup & Conversion'], ['student', 'Student Activity'], ['adoption', 'Feature Adoption'],
  ['retention', 'Engagement & Retention'], ['journeys', 'Journeys'], ['performance', 'Performance'], ['errors', 'Errors & Diagnostics'],
  ['dataops', 'Data Operations'], ['audit', 'Admin Audit'], ['custom', 'Custom Reports'], ['alerts', 'Alerts'], ['health', 'Tracking Health']
] as const
type Tab = (typeof TABS)[number][0]
const EXPORTABLE = new Set<Tab>(['traffic', 'pages', 'audience', 'funnels', 'student', 'adoption', 'retention', 'journeys', 'performance', 'errors', 'dataops', 'custom', 'alerts', 'health'])

const ZONES = ['Asia/Kolkata', 'UTC', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore']

/** Control Center › Analytics. Every filter lives in the URL, so it is kept across subtabs. */
export default function AnalyticsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.find(([id]) => id === params.get('tab'))?.[0] ?? 'overview') as Tab
  const set = (key: string, value: string | null) => setParams(current => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next }, { replace: true })
  const preset = params.get('preset') ?? '7d'
  const query = useFilterQuery(tab === 'custom' ? { id: params.get('report_id') } : {})
  const sensitive = useSensitiveAction()
  const toast = useToast()
  const [exporting, setExporting] = useState(false)

  const exportCsv = async () => {
    setExporting(true)
    try {
      const { blob, filename } = await sensitive(() => controlDownload(`analytics?report=${tab}&${query}&format=csv`))
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = filename
      document.body.appendChild(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : 'Export failed.', 'error')
    } finally { setExporting(false) }
  }

  return <div className="cc-stack cc-an">
    <PageHeader title="Analytics" description="First-party, privacy-friendly analytics. Every figure is labelled Live (new events), Historical (existing student tables), Partial or Unavailable, with its coverage start." actions={EXPORTABLE.has(tab) ? <Button onClick={() => void exportCsv()} disabled={exporting}><Download size={15} aria-hidden="true" /> {exporting ? 'Exporting…' : 'Export CSV'}</Button> : undefined} />

    {tab !== 'audit' && <form className="cc-an-filters" aria-label="Analytics filters" onSubmit={event => event.preventDefault()}>
      <label>Period
        <select className="cc-input" value={preset} onChange={event => set('preset', event.target.value)}>
          <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7d">Last 7 days</option><option value="28d">Last 28 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="custom">Custom…</option>
        </select>
      </label>
      {preset === 'custom' && <>
        <label>From<input className="cc-input" type="date" value={params.get('from') ?? ''} onChange={event => set('from', event.target.value)} /></label>
        <label>To<input className="cc-input" type="date" value={params.get('to') ?? ''} onChange={event => set('to', event.target.value)} /></label>
      </>}
      <label>Time zone
        <select className="cc-input" value={params.get('tz') ?? 'Asia/Kolkata'} onChange={event => set('tz', event.target.value === 'Asia/Kolkata' ? null : event.target.value)}>
          {ZONES.map(zone => <option key={zone} value={zone}>{zone === 'Asia/Kolkata' ? 'Asia/Kolkata (IST, default)' : zone}</option>)}
        </select>
      </label>
      <label>Environment
        <select className="cc-input" value={params.get('env') ?? 'production'} onChange={event => set('env', event.target.value === 'production' ? null : event.target.value)}>
          <option value="production">Production</option><option value="preview">Preview</option><option value="all">All</option>
        </select>
      </label>
      <label>Visitors
        <select className="cc-input" value={params.get('audience') ?? 'all'} onChange={event => set('audience', event.target.value === 'all' ? null : event.target.value)}>
          <option value="all">Everyone</option><option value="public">Not signed in</option><option value="signed_in">Signed in</option>
        </select>
      </label>
      <label>New / returning
        <select className="cc-input" value={params.get('visitor') ?? 'all'} onChange={event => set('visitor', event.target.value === 'all' ? null : event.target.value)}>
          <option value="all">All</option><option value="new">New</option><option value="returning">Returning</option>
        </select>
      </label>
      <label>Device
        <select className="cc-input" value={params.get('device') ?? ''} onChange={event => set('device', event.target.value || null)}>
          <option value="">All</option><option value="mobile">Mobile</option><option value="tablet">Tablet</option><option value="desktop">Desktop</option>
        </select>
      </label>
      <label>Area
        <select className="cc-input" value={params.get('source') ?? ''} onChange={event => set('source', event.target.value || null)}>
          <option value="">All</option><option value="public">Public site</option><option value="auth">Login/signup</option><option value="app">Notebook</option><option value="control">Control Center</option>
        </select>
      </label>
      <label>Route
        <input className="cc-input" placeholder="/syllabus" defaultValue={params.get('path') ?? ''} onBlur={event => set('path', /^\/[a-z0-9_:/-]*$/i.test(event.target.value) ? event.target.value : null)} />
      </label>
      <label className="cc-an-check"><input type="checkbox" checked={params.get('compare') === '1'} onChange={event => set('compare', event.target.checked ? '1' : null)} /> Compare with previous period</label>
      <label className="cc-an-check"><input type="checkbox" checked={params.get('test') === '1'} onChange={event => set('test', event.target.checked ? '1' : null)} /> Include test traffic</label>
    </form>}

    <nav className="cc-an-tabs" aria-label="Analytics sections">
      {TABS.map(([id, label]) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'is-active' : ''} onClick={() => set('tab', id === 'overview' ? null : id)}>{label}</button>)}
    </nav>

    <Suspense fallback={<Skeleton rows={6} />}>
      {tab === 'overview' && <Tabs.Overview />}
      {tab === 'realtime' && <Tabs.Realtime />}
      {tab === 'traffic' && <Tabs.Traffic />}
      {tab === 'pages' && <Tabs.Pages />}
      {tab === 'audience' && <Tabs.Audience />}
      {tab === 'funnels' && <Tabs.Funnels />}
      {tab === 'student' && <Tabs.Student />}
      {tab === 'adoption' && <Tabs.Adoption />}
      {tab === 'retention' && <Tabs.Retention />}
      {tab === 'journeys' && <Tabs.Journeys />}
      {tab === 'performance' && <Tabs.Performance />}
      {tab === 'errors' && <Tabs.Errors />}
      {tab === 'dataops' && <Tabs.DataOps />}
      {tab === 'audit' && <Tabs.AdminAudit />}
      {tab === 'custom' && <Tabs.Custom />}
      {tab === 'alerts' && <Tabs.Alerts />}
      {tab === 'health' && <Tabs.Health />}
    </Suspense>
    <p className="cc-muted cc-an-foot"><RefreshCw size={12} aria-hidden="true" /> Figures are aggregated on the server and cached for up to 30 seconds (Real-time and Alerts are never cached).</p>
  </div>
}
