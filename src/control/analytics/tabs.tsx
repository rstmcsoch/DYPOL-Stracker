import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { QueryFrame } from '../pageParts'
import { Badge, Button, Panel } from '../ui'
import { controlFetch, type AuditResponse } from '../api'
import { CONSOLE_BASE } from '../policy'
import { describeAuditEvent } from '../../lib/control-audit-catalog'
import { BUILT_IN_FUNNELS, DIMENSIONS, MEASURES, WIDGETS, type ConfigKey } from '../../lib/telemetry/report-config'
import { EVENT_NAMES } from '../../lib/telemetry/taxonomy'
import { BarList, DailyChart } from './charts'
import { DataTable, Kpi, SectionPanel, Tip } from './shared'
import { formatTime, rankedColumns, useReport, type Ranked, type ReportResponse } from './data'

type Point = { day: string; value: number }
type KpiValue = { value: number | null; previous: number | null; delta: { abs: number; pct: number | null } | null }
const tz = (r: ReportResponse<unknown>) => r.period.timeZone
const periodLabel = (r: ReportResponse<unknown>) => `${r.period.fromDay} → ${r.period.toDay} (${r.period.timeZone})`

function useSaveConfig() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { key: ConfigKey; value: unknown }) => controlFetch('analytics', { method: 'PUT', body: { kind: 'config', ...input } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['control', 'analytics'] })
  })
}
const problem = (error: unknown) => error instanceof Error ? error.message : null

// ---------------------------------------------------------------- Overview
const WIDGET_LABEL: Record<(typeof WIDGETS)[number], string> = {
  kpi_visitors: 'Visitors', kpi_sessions: 'Sessions', kpi_page_views: 'Page views', kpi_signups: 'Signups', kpi_writes: 'Student saves', kpi_errors: 'App errors', kpi_lcp: 'LCP p75',
  chart_traffic: 'Traffic chart', chart_writes: 'Student saves chart', top_pages: 'Top pages', top_channels: 'Channels', historical_activity: 'Historical activity'
}
type OverviewData = { widgets: (typeof WIDGETS)[number][]; kpis: Record<string, KpiValue>; traffic: { day: string; value: number; visitors: number }[]; writes: Point[]; topPages: Ranked[]; channels: Ranked[]; historical: { feature: string; created: number }[] }

export function Overview() {
  const query = useReport<OverviewData>('overview')
  const save = useSaveConfig()
  const [editing, setEditing] = useState<string[] | null>(null)
  return <QueryFrame query={query}>{r => {
    const on = new Set(r.data.widgets ?? [])
    const compare = r.filters.compare
    const k = r.data.kpis ?? {}
    const kpi = (id: (typeof WIDGETS)[number], key: string, label: string, tip: string, unit = '') => on.has(id) && k[key] ? <Kpi key={id} label={label} tip={tip} compare={compare} unit={unit} {...k[key]!} /> : null
    return <>
      <Panel title="Overview" description={<>Period {periodLabel(r)}. <span className="cc-muted">Updated {formatTime(r.generatedAt, tz(r))}.</span></>} actions={<>
        <span className="cc-an-status"><Badge tone={r.sections.live?.status === 'unavailable' ? 'neutral' : 'ok'}>Live: {r.sections.live?.status}</Badge><Badge tone="info">Historical: {r.sections.historical?.status}</Badge></span>
        <Button size="sm" onClick={() => setEditing(editing ? null : [...on])}>{editing ? 'Cancel' : 'Customize widgets'}</Button>
      </>}>
        {editing && <fieldset className="cc-an-widgets"><legend>Show these widgets</legend>
          {WIDGETS.map(id => <label key={id}><input type="checkbox" checked={editing.includes(id)} onChange={event => setEditing(event.target.checked ? [...editing, id] : editing.filter(item => item !== id))} /> {WIDGET_LABEL[id]}</label>)}
          <Button variant="primary" size="sm" disabled={save.isPending} onClick={() => save.mutate({ key: 'overview.widgets', value: WIDGETS.filter(id => editing.includes(id)) }, { onSuccess: () => setEditing(null) })}>Save layout</Button>
          {save.isError && <p className="cc-note cc-note--warn" role="alert">{problem(save.error)}</p>}
        </fieldset>}
        <div className="cc-kpis">
          {kpi('kpi_visitors', 'visitors', 'Visitors', 'Distinct signed-in accounts plus anonymous browser sessions with any event.')}
          {kpi('kpi_sessions', 'sessions', 'Sessions', 'Distinct tab sessions (a session ends when the tab closes).')}
          {kpi('kpi_page_views', 'page_views', 'Page views', 'Route changes recorded by page_view.')}
          {kpi('kpi_signups', 'signups_tracked', 'Signups (tracked)', 'signup_completed events. Coverage starts when tracking went live.')}
          {on.has('kpi_signups') && k.signups_accounts && <Kpi label="New accounts (historical)" tip="Accounts created in the period, from Supabase Auth. Includes signups before tracking existed." compare={false} {...k.signups_accounts} />}
          {kpi('kpi_writes', 'writes', 'Student saves', 'Rows saved to the cloud successfully (student_record_write_succeeded × rows). Failed or offline-queued saves are excluded.')}
          {kpi('kpi_errors', 'errors', 'App errors', 'Client errors, unhandled rejections and failed API calls (one per fingerprint per page load).')}
          {kpi('kpi_lcp', 'lcp_p75', 'LCP p75', '75th percentile Largest Contentful Paint from real visitors. Good ≤ 2500 ms.', ' ms')}
        </div>
      </Panel>
      <div className="cc-grid cc-grid--main">
        {on.has('chart_traffic') && <SectionPanel title="Traffic" tip="Page views and visitors per day." section={r.sections.live} timeZone={tz(r)}><DailyChart label="Page views and visitors per day" data={r.data.traffic ?? []} series={[{ key: 'value', name: 'Page views', color: 'var(--cc-accent)' }, { key: 'visitors', name: 'Visitors', color: 'var(--cc-info)' }]} /></SectionPanel>}
        {on.has('chart_writes') && <SectionPanel title="Student saves" tip="Successful save events per day." section={r.sections.live} timeZone={tz(r)}><DailyChart label="Successful student saves per day" data={r.data.writes ?? []} series={[{ key: 'value', name: 'Save events', color: 'var(--cc-ok)' }]} /></SectionPanel>}
        {on.has('top_pages') && <SectionPanel title="Top pages" section={r.sections.live} timeZone={tz(r)}><DataTable caption="Top pages" rows={r.data.topPages ?? []} columns={rankedColumns('Route')} /></SectionPanel>}
        {on.has('top_channels') && <SectionPanel title="Channels" tip="Where sessions came from." section={r.sections.live} timeZone={tz(r)}><DataTable caption="Channels" rows={r.data.channels ?? []} columns={rankedColumns('Channel')} /></SectionPanel>}
        {on.has('historical_activity') && <SectionPanel title="Student records created" tip="Rows created in student tables in the period." section={r.sections.historical} timeZone={tz(r)}><DataTable caption="Student records created" rows={r.data.historical ?? []} columns={[{ key: 'feature', label: 'Kind' }, { key: 'created', label: 'Rows created' }]} /></SectionPanel>}
      </div>
    </>
  }}</QueryFrame>
}

// ---------------------------------------------------------------- Real-time
type RealtimeData = { active5: number; active30: number; events30: number; routes: Ranked[]; sources: Ranked[]; recent: { ts: string; name: string; route: string; source: string; device: string | null }[] }
export function Realtime() {
  const query = useReport<RealtimeData>('realtime', {}, 30_000)
  return <QueryFrame query={query}>{r => <>
    <Panel title="Real-time" description={<>Auto-refreshes every 30 seconds. Last updated {formatTime(r.generatedAt, tz(r))} ({tz(r)}).</>} actions={<Button size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={14} aria-hidden="true" /> Refresh now</Button>}>
      {r.sections.realtime?.status === 'unavailable' ? <p className="cc-muted">{r.sections.realtime.note}</p> : <div className="cc-kpis">
        <Kpi label="Active now (5 min)" tip="Visitors with at least one event in the last 5 minutes." value={r.data.active5} compare={false} />
        <Kpi label="Active (30 min)" tip="Visitors with at least one event in the last 30 minutes." value={r.data.active30} compare={false} />
        <Kpi label="Events (30 min)" tip="All tracked events in the last 30 minutes." value={r.data.events30} compare={false} />
      </div>}
    </Panel>
    <div className="cc-grid cc-grid--main">
      <Panel title="Recent events"><DataTable caption="Recent events" rows={r.data.recent ?? []} columns={[{ key: 'ts', label: 'When', render: row => formatTime(String(row.ts), tz(r)) }, { key: 'name', label: 'Event' }, { key: 'route', label: 'Route' }, { key: 'source', label: 'Area' }, { key: 'device', label: 'Device' }]} empty="No events in the last 30 minutes." /></Panel>
      <Panel title="Pages being viewed"><DataTable caption="Pages in the last 30 minutes" rows={r.data.routes ?? []} columns={rankedColumns('Route')} empty="No page views in the last 30 minutes." /></Panel>
    </div>
  </>}</QueryFrame>
}

// ---------------------------------------------------------------- Traffic
type TrafficData = { channels: { channel: string; sessions: number; visitors: number }[]; referrers: Ranked[]; utmSource: Ranked[]; utmMedium: Ranked[]; utmCampaign: Ranked[]; sessionsByDay: Point[]; previousSessions: number | null }
export function Traffic() {
  const query = useReport<TrafficData>('traffic')
  return <QueryFrame query={query}>{r => <>
    <SectionPanel title="Sessions per day" tip="New sessions (session_started) by day." section={r.sections.main} timeZone={tz(r)}>
      <DailyChart label="Sessions per day" data={r.data.sessionsByDay ?? []} series={[{ key: 'value', name: 'Sessions', color: 'var(--cc-accent)' }]} />
      {r.data.previousSessions !== null && r.data.previousSessions !== undefined && <p className="cc-muted">Previous period: {r.data.previousSessions} sessions.</p>}
    </SectionPanel>
    <div className="cc-grid cc-grid--main">
      <SectionPanel title="Channels" tip="Direct, Organic search, Social, Referral, Email, Paid or Campaign, from the referrer domain and UTM tags." section={r.sections.main} timeZone={tz(r)}><BarList label="Sessions by channel" data={r.data.channels ?? []} nameKey="channel" valueKey="sessions" /></SectionPanel>
      <SectionPanel title="Referring sites" section={r.sections.main} timeZone={tz(r)}><DataTable caption="Referring domains" rows={r.data.referrers ?? []} columns={rankedColumns('Domain')} empty="No external referrers in this period." /></SectionPanel>
      <SectionPanel title="UTM source" section={r.sections.main} timeZone={tz(r)}><DataTable caption="UTM source" rows={r.data.utmSource ?? []} columns={rankedColumns('utm_source')} empty="No tagged campaigns in this period." /></SectionPanel>
      <SectionPanel title="UTM medium / campaign" section={r.sections.main} timeZone={tz(r)}><DataTable caption="UTM medium" rows={[...(r.data.utmMedium ?? []).map(row => ({ ...row, key: `medium: ${row.key}` })), ...(r.data.utmCampaign ?? []).map(row => ({ ...row, key: `campaign: ${row.key}` }))]} columns={rankedColumns('Tag')} empty="No tagged campaigns in this period." /></SectionPanel>
    </div>
    <Panel title="Not collected"><p className="cc-muted">Country/city (no IP addresses are stored by design) and search queries (needs Google Search Console, not connected) are Unavailable.</p></Panel>
  </>}</QueryFrame>
}

// ---------------------------------------------------------------- Pages
type PagesData = { pages: { route: string; views: number; visitors: number }[]; sections: Ranked[]; ctas: Ranked[]; video: { key: string; count: number }[]; landing: Ranked[] }
export function Pages() {
  const query = useReport<PagesData>('pages')
  return <QueryFrame query={query}>{r => <div className="cc-grid cc-grid--main">
    <SectionPanel title="Pages" tip="Page views and visitors per route (ids are removed from routes)." section={r.sections.main} timeZone={tz(r)}><DataTable caption="Pages" rows={r.data.pages ?? []} columns={[{ key: 'route', label: 'Route' }, { key: 'views', label: 'Views' }, { key: 'visitors', label: 'Visitors' }]} /></SectionPanel>
    <SectionPanel title="Landing pages" tip="Route where each session started." section={r.sections.main} timeZone={tz(r)}><DataTable caption="Landing pages" rows={r.data.landing ?? []} columns={rankedColumns('Route')} /></SectionPanel>
    <SectionPanel title="Homepage sections seen" tip="Sections at least half visible, once per page view." section={r.sections.main} timeZone={tz(r)}><BarList label="Homepage sections seen" data={r.data.sections ?? []} /></SectionPanel>
    <SectionPanel title="Calls to action" tip="Clicks on Sign up / Log in links, by placement." section={r.sections.main} timeZone={tz(r)}><DataTable caption="CTA clicks" rows={r.data.ctas ?? []} columns={rankedColumns('CTA · placement')} /></SectionPanel>
    <SectionPanel title="Promo video" tip="Only deliberate plays or unmutes count; the muted ambient autoplay never does." section={r.sections.main} timeZone={tz(r)}><DataTable caption="Promo video engagement" rows={r.data.video ?? []} columns={[{ key: 'key', label: 'Milestone' }, { key: 'count', label: 'Events' }]} /></SectionPanel>
  </div>}</QueryFrame>
}

// ---------------------------------------------------------------- Audience
type AudienceData = { visitors: number; signedIn: number; anonymous: number; newVisitors: number | null; returningVisitors: number | null; devices: { device: string; events: number; visitors: number }[]; browsers: Ranked[]; sources: Ranked[] }
export function Audience() {
  const query = useReport<AudienceData>('audience')
  return <QueryFrame query={query}>{r => <>
    <SectionPanel title="Audience" section={r.sections.main} timeZone={tz(r)}>
      <div className="cc-kpis">
        <Kpi label="Visitors" tip="Distinct accounts + anonymous sessions." value={r.data.visitors ?? null} compare={false} />
        <Kpi label="Signed in" tip="Distinct signed-in accounts (pseudonymous)." value={r.data.signedIn ?? null} compare={false} />
        <Kpi label="Not signed in" tip="Anonymous sessions." value={r.data.anonymous ?? null} compare={false} />
        <Kpi label="New" tip="Not seen in the 90 days before the period. Pick New or Returning in the filter to compute." value={r.data.newVisitors ?? null} compare={false} />
        <Kpi label="Returning" tip="Seen in the 90 days before the period." value={r.data.returningVisitors ?? null} compare={false} />
      </div>
    </SectionPanel>
    <div className="cc-grid cc-grid--main">
      <SectionPanel title="Devices" tip="By viewport width: mobile < 640px, tablet < 1024px." section={r.sections.main} timeZone={tz(r)}><DataTable caption="Devices" rows={r.data.devices ?? []} columns={[{ key: 'device', label: 'Device' }, { key: 'events', label: 'Events' }, { key: 'visitors', label: 'Visitors' }]} /></SectionPanel>
      <SectionPanel title="Browsers" section={r.sections.main} timeZone={tz(r)}><DataTable caption="Browsers" rows={r.data.browsers ?? []} columns={rankedColumns('Browser family')} /></SectionPanel>
      <SectionPanel title="Areas" tip="Public site, login/signup, notebook or Control Center." section={r.sections.main} timeZone={tz(r)}><DataTable caption="Areas" rows={r.data.sources ?? []} columns={rankedColumns('Area')} /></SectionPanel>
    </div>
  </>}</QueryFrame>
}

// ---------------------------------------------------------------- Funnels
type FunnelStepResult = { step: string; count: number; conversion: number | null; fromPrevious: number | null; medianSecondsFromPrevious: number | null }
type FunnelsData = { funnels: { id: string; name: string; builtIn: boolean; steps: FunnelStepResult[]; previous: FunnelStepResult[] | null; definition: { name: string }[] }[] }
const duration = (seconds: number | null) => seconds === null ? '—' : seconds < 90 ? `${Math.round(seconds)} s` : seconds < 5400 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds / 3600)} h`
export function Funnels() {
  const query = useReport<FunnelsData>('funnels')
  const save = useSaveConfig()
  const [draft, setDraft] = useState<{ name: string; steps: string[] } | null>(null)
  return <QueryFrame query={query}>{r => {
    const custom = (r.data.funnels ?? []).filter(item => !item.builtIn).map(item => ({ id: item.id, name: item.name, steps: item.definition }))
    return <>
      {(r.data.funnels ?? []).map(item => <SectionPanel key={item.id} title={item.name} tip={item.builtIn ? 'Built-in funnel.' : 'Your funnel.'} section={r.sections.main} timeZone={tz(r)} actions={!item.builtIn ? <Button size="sm" variant="ghost" onClick={() => save.mutate({ key: 'funnels', value: custom.filter(f => f.id !== item.id) })}>Delete</Button> : undefined}>
        <DataTable caption={item.name} rows={item.steps.map((step, index) => ({ ...step, previous: item.previous?.[index]?.count ?? null }))} columns={[
          { key: 'step', label: 'Step' }, { key: 'count', label: 'Reached', tip: 'Visitors who completed this step after all earlier steps, in order.' },
          { key: 'conversion', label: 'Of step 1', tip: '% of visitors who started the funnel.', render: row => row.conversion === null ? '—' : `${String(row.conversion)}%` },
          { key: 'fromPrevious', label: 'From previous', render: row => row.fromPrevious === null ? '—' : `${String(row.fromPrevious)}%` },
          { key: 'medianSecondsFromPrevious', label: 'Median time from previous', render: row => duration(row.medianSecondsFromPrevious as number | null) },
          ...(r.filters.compare ? [{ key: 'previous', label: 'Previous period' }] : [])
        ]} />
      </SectionPanel>)}
      <Panel title="Build a funnel" description="Pick 2–8 tracked events in order." actions={!draft ? <Button size="sm" onClick={() => setDraft({ name: '', steps: ['page_view', 'signup_completed'] })}>New funnel</Button> : undefined}>
        {draft ? <div className="cc-an-builder">
          <label>Name<input className="cc-input" value={draft.name} maxLength={60} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
          {draft.steps.map((step, index) => <label key={index}>Step {index + 1}<select className="cc-input" value={step} onChange={event => setDraft({ ...draft, steps: draft.steps.map((value, i) => i === index ? event.target.value : value) })}>{EVENT_NAMES.map(name => <option key={name}>{name}</option>)}</select></label>)}
          <div className="cc-badges">
            <Button size="sm" disabled={draft.steps.length >= 8} onClick={() => setDraft({ ...draft, steps: [...draft.steps, 'page_view'] })}>Add step</Button>
            <Button size="sm" disabled={draft.steps.length <= 2} onClick={() => setDraft({ ...draft, steps: draft.steps.slice(0, -1) })}>Remove last</Button>
            <Button size="sm" variant="primary" disabled={!draft.name.trim() || save.isPending || custom.length >= 10} onClick={() => save.mutate({ key: 'funnels', value: [...custom, { id: `f-${Date.now().toString(36)}`, name: draft.name.trim(), steps: draft.steps.map(name => ({ name })) }] }, { onSuccess: () => setDraft(null) })}>Save funnel</Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
          {save.isError && <p className="cc-note cc-note--warn" role="alert">{problem(save.error)}</p>}
        </div> : <p className="cc-muted">{BUILT_IN_FUNNELS.length} built-in funnels above; up to 10 of your own.</p>}
      </Panel>
    </>
  }}</QueryFrame>
}

// ---------------------------------------------------------------- Student activity
type StudentData = { historical: { feature: string; created: number }[]; byDay: Point[]; outcomes: { feature: string; op: string; succeeded: number; failed: number; attempted: number; failureRate: number | null }[]; writesByDay: Point[] }
export function Student() {
  const query = useReport<StudentData>('student')
  return <QueryFrame query={query}>{r => <>
    <div className="cc-grid cc-grid--main">
      <SectionPanel title="Records created per day" tip="Rows created in student tables (historical, from created_at)." section={r.sections.historical} timeZone={tz(r)}><DailyChart label="Student records created per day" data={r.data.byDay ?? []} series={[{ key: 'value', name: 'Rows created', color: 'var(--cc-info)' }]} /></SectionPanel>
      <SectionPanel title="By kind" section={r.sections.historical} timeZone={tz(r)}><DataTable caption="Rows created by kind" rows={r.data.historical ?? []} columns={[{ key: 'feature', label: 'Kind' }, { key: 'created', label: 'Rows created' }]} /></SectionPanel>
    </div>
    <SectionPanel title="Save outcomes (live)" tip="Cloud saves from the app by feature and operation. Failed and offline-queued saves are never counted as activity." section={r.sections.live} timeZone={tz(r)}>
      <DailyChart label="Successful saves per day" data={r.data.writesByDay ?? []} series={[{ key: 'value', name: 'Successful saves', color: 'var(--cc-ok)' }]} />
      <DataTable caption="Save outcomes" rows={r.data.outcomes ?? []} columns={[{ key: 'feature', label: 'Feature' }, { key: 'op', label: 'Operation' }, { key: 'succeeded', label: 'Rows saved' }, { key: 'failed', label: 'Rows failed' }, { key: 'failureRate', label: 'Failure rate', render: row => row.failureRate === null ? '—' : `${String(row.failureRate)}%` }]} />
    </SectionPanel>
  </>}</QueryFrame>
}

// ---------------------------------------------------------------- Adoption
type AdoptionData = { denominator: number; table: { feature: string; opened_by: number; active_signed_in_users: number; adoption_pct: number | null; saved_by: number }[]; historical: { feature: string; accounts: number; total: number; pct: number | null }[] }
export function Adoption() {
  const query = useReport<AdoptionData>('adoption')
  return <QueryFrame query={query}>{r => <div className="cc-grid cc-grid--main">
    <SectionPanel title="Features opened (live)" tip={`Denominator: ${r.data.denominator ?? 0} signed-in users active in the period.`} section={r.sections.live} timeZone={tz(r)}>
      <DataTable caption="Feature adoption" rows={r.data.table ?? []} columns={[{ key: 'feature', label: 'Feature' }, { key: 'opened_by', label: 'Opened by' }, { key: 'active_signed_in_users', label: 'Of active users' }, { key: 'adoption_pct', label: 'Adoption', render: row => row.adoption_pct === null ? '—' : `${String(row.adoption_pct)}%` }, { key: 'saved_by', label: 'Saved something' }]} />
    </SectionPanel>
    <SectionPanel title="Features used (historical)" tip="Accounts that created at least one row of each kind in the period ÷ all accounts." section={r.sections.historical} timeZone={tz(r)}>
      <DataTable caption="Historical feature use" rows={r.data.historical ?? []} columns={[{ key: 'feature', label: 'Kind' }, { key: 'accounts', label: 'Accounts' }, { key: 'total', label: 'Of all accounts' }, { key: 'pct', label: 'Share', render: row => row.pct === null ? '—' : `${String(row.pct)}%` }]} />
    </SectionPanel>
  </div>}</QueryFrame>
}

// ---------------------------------------------------------------- Retention
type RetentionData = { dau: number; wau: number; mau: number; stickiness: number | null; dauSeries: Point[]; cohorts: { cohort: string; size: number; cells: (number | null)[] }[] }
export function Retention() {
  const query = useReport<RetentionData>('retention')
  return <QueryFrame query={query}>{r => <>
    <SectionPanel title="Active users" tip="Active = saved study work or any signed-in event that day." section={r.sections.main} timeZone={tz(r)}>
      <div className="cc-kpis">
        <Kpi label="DAU" tip="Active on the last day of the period." value={r.data.dau ?? null} compare={false} />
        <Kpi label="WAU" tip="Active in the 7 days ending on the last day." value={r.data.wau ?? null} compare={false} />
        <Kpi label="MAU" tip="Active in the 30 days ending on the last day." value={r.data.mau ?? null} compare={false} />
        <Kpi label="Stickiness" tip="DAU ÷ MAU." value={r.data.stickiness ?? null} unit="%" compare={false} />
      </div>
      <DailyChart label="Daily active users" data={r.data.dauSeries ?? []} series={[{ key: 'value', name: 'Active users', color: 'var(--cc-accent)' }]} />
    </SectionPanel>
    <SectionPanel title="Weekly cohorts" tip="Cohort = week of first activity (Monday start). Cells are % of the cohort active that week; weeks not finished yet are blank." section={r.sections.main} timeZone={tz(r)}>
      <DataTable caption="Weekly retention cohorts" rows={(r.data.cohorts ?? []).map(row => ({ cohort: row.cohort, size: row.size, ...Object.fromEntries(row.cells.map((cell, k) => [`w${k}`, cell])) }))} columns={[{ key: 'cohort', label: 'Cohort week' }, { key: 'size', label: 'Users' }, ...Array.from({ length: 8 }, (_, k) => ({ key: `w${k}`, label: `Wk ${k}`, render: (row: Record<string, unknown>) => row[`w${k}`] === null || row[`w${k}`] === undefined ? '' : `${String(row[`w${k}`])}%` }))]} />
    </SectionPanel>
  </>}</QueryFrame>
}

// ---------------------------------------------------------------- Journeys
type JourneysData = { pivot: string; before: { key: string; count: number }[]; after: { key: string; count: number }[]; sessions: { session: string; events: number; start: string | null; source: string | null; device: string | null; signedIn: boolean }[]; timeline: { ts: string; name: string; route: string; detail: string }[] }
export function Journeys() {
  const [params, setParams] = useSearchParams()
  const pivot = params.get('pivot') ?? 'signup_started'
  const session = params.get('session')
  const query = useReport<JourneysData>('journeys', { pivot, session })
  const setParam = (key: string, value: string | null) => setParams(current => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next }, { replace: true })
  return <QueryFrame query={query}>{r => <>
    <SectionPanel title="Before and after an event" tip="What happened immediately before and after the chosen event, within the same session." section={r.sections.main} timeZone={tz(r)} actions={<select className="cc-input" aria-label="Pivot event" value={pivot} onChange={event => setParam('pivot', event.target.value)}>{EVENT_NAMES.map(name => <option key={name}>{name}</option>)}</select>}>
      <div className="cc-grid cc-grid--main">
        <DataTable caption="Before" rows={r.data.before ?? []} columns={[{ key: 'key', label: 'Before' }, { key: 'count', label: 'Times' }]} />
        <DataTable caption="After" rows={r.data.after ?? []} columns={[{ key: 'key', label: 'After' }, { key: 'count', label: 'Times' }]} />
      </div>
    </SectionPanel>
    <div className="cc-grid cc-grid--main">
      <SectionPanel title="Sessions" tip="Most active sessions. Session ids are random per tab and not linked to names or emails." section={r.sections.main} timeZone={tz(r)}>
        <DataTable caption="Sessions" rows={r.data.sessions ?? []} columns={[{ key: 'start', label: 'Started', render: row => formatTime(row.start as string | null, tz(r)) }, { key: 'events', label: 'Events' }, { key: 'source', label: 'Area' }, { key: 'device', label: 'Device' }, { key: 'signedIn', label: 'Signed in' }, { key: 'session', label: '', render: row => <Button size="sm" variant="ghost" onClick={() => setParam('session', String(row.session))}>Timeline</Button> }]} />
      </SectionPanel>
      <Panel title="Session timeline" description="Event names, routes and allowlisted properties only.">
        {session ? <DataTable caption="Session timeline" rows={r.data.timeline ?? []} columns={[{ key: 'ts', label: 'When', render: row => formatTime(String(row.ts), tz(r)) }, { key: 'name', label: 'Event' }, { key: 'route', label: 'Route' }, { key: 'detail', label: 'Details' }]} empty="This session has no events in the selected period." /> : <p className="cc-muted">Choose a session to see its timeline.</p>}
      </Panel>
    </div>
  </>}</QueryFrame>
}

// ---------------------------------------------------------------- Performance
type PerfData = { metrics: { metric: string; samples: number; p75: number | null; previousP75: number | null; rating: string | null; good: number; poor: number; needsImprovement: number; unit: string }[]; byRoute: { route: string; samples: number; lcp_p75: number | null }[] }
export function Performance() {
  const query = useReport<PerfData>('performance')
  return <QueryFrame query={query}>{r => <>
    <SectionPanel title="Core Web Vitals (real users)" tip="Thresholds: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, FCP ≤ 1.8 s, TTFB ≤ 0.8 s are good." section={r.sections.main} timeZone={tz(r)}>
      <DataTable caption="Web vitals" rows={r.data.metrics ?? []} columns={[
        { key: 'metric', label: 'Metric' }, { key: 'samples', label: 'Samples' },
        { key: 'p75', label: 'p75', render: row => row.p75 === null ? '—' : `${Number(row.p75).toFixed(row.metric === 'CLS' ? 3 : 0)} ${String(row.unit)}` },
        { key: 'rating', label: 'Rating', render: row => row.rating ? <Badge tone={row.rating === 'good' ? 'ok' : row.rating === 'poor' ? 'crit' : 'warn'}>{String(row.rating)}</Badge> : '—' },
        { key: 'good', label: 'Good' }, { key: 'needsImprovement', label: 'Needs work' }, { key: 'poor', label: 'Poor' },
        ...(r.filters.compare ? [{ key: 'previousP75', label: 'Previous p75' }] : [])
      ]} />
    </SectionPanel>
    <SectionPanel title="LCP by route" section={r.sections.main} timeZone={tz(r)}><DataTable caption="LCP by route" rows={r.data.byRoute ?? []} columns={[{ key: 'route', label: 'Route' }, { key: 'samples', label: 'Samples' }, { key: 'lcp_p75', label: 'LCP p75 (ms)' }]} /></SectionPanel>
    <Panel title="Vercel Speed Insights"><p className="cc-muted">Not enabled on the Vercel project (and not needed): these figures come from Stracker’s own real-user measurements.</p></Panel>
  </>}</QueryFrame>
}

// ---------------------------------------------------------------- Errors
type ErrorGroup = { fingerprint: string; kind: string; message: string; first_seen: string; last_seen: string; occurrences: number; last_route: string | null; status: string; note: string }
type ErrorsData = { groups: ErrorGroup[]; total: number; page: number; pageSize: number; byDay: Point[]; byKind: Ranked[] }
export function Errors() {
  const [status, setStatus] = useState('open')
  const [page, setPage] = useState(1)
  const query = useReport<ErrorsData>('errors', { status, page: String(page) })
  const client = useQueryClient()
  const update = useMutation({
    mutationFn: (input: { fingerprint: string; status: string; note: string }) => controlFetch('analytics', { method: 'PUT', body: { kind: 'error', ...input } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['control', 'analytics'] })
  })
  const [notes, setNotes] = useState<Record<string, string>>({})
  return <QueryFrame query={query}>{r => <>
    <SectionPanel title="Errors per day" section={r.sections.main} timeZone={tz(r)}><DailyChart label="App errors per day" data={r.data.byDay ?? []} series={[{ key: 'value', name: 'Errors', color: 'var(--cc-crit)' }]} /></SectionPanel>
    <SectionPanel title="Error groups" tip="Grouped by fingerprint (kind + normalised message). A resolved group that happens again reopens." section={r.sections.main} timeZone={tz(r)} actions={<select className="cc-input" aria-label="Status" value={status} onChange={event => { setStatus(event.target.value); setPage(1) }}><option value="open">Open</option><option value="resolved">Resolved</option><option value="ignored">Ignored</option><option value="">All</option></select>}>
      {update.isError && <p className="cc-note cc-note--warn" role="alert">{problem(update.error)}</p>}
      <DataTable caption="Error groups" rows={(r.data.groups ?? []) as unknown as Record<string, unknown>[]} empty="No error groups with this status." columns={[
        { key: 'message', label: 'Error', render: row => <><strong>{String(row.message)}</strong><span className="cc-muted"> · {String(row.kind)} · {String(row.last_route ?? '')}</span></> },
        { key: 'occurrences', label: 'Count' },
        { key: 'last_seen', label: 'Last seen', render: row => formatTime(String(row.last_seen), tz(r)) },
        { key: 'status', label: 'Status', render: row => <Badge tone={row.status === 'open' ? 'crit' : row.status === 'resolved' ? 'ok' : 'neutral'}>{String(row.status)}</Badge> },
        { key: 'note', label: 'Note', render: row => { const fp = String(row.fingerprint); return <span className="cc-an-note">
          <input className="cc-input" aria-label="Note" maxLength={1000} value={notes[fp] ?? String(row.note ?? '')} onChange={event => setNotes({ ...notes, [fp]: event.target.value })} />
          <select className="cc-input" aria-label="Set status" value={String(row.status)} onChange={event => update.mutate({ fingerprint: fp, status: event.target.value, note: notes[fp] ?? String(row.note ?? '') })}><option value="open">Open</option><option value="resolved">Resolved</option><option value="ignored">Ignored</option></select>
          <Button size="sm" disabled={update.isPending} onClick={() => update.mutate({ fingerprint: fp, status: String(row.status), note: notes[fp] ?? String(row.note ?? '') })}>Save</Button>
        </span> } }
      ]} />
      {(r.data.total ?? 0) > (r.data.pageSize ?? 25) && <div className="cc-badges"><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="cc-muted">Page {page} of {Math.ceil((r.data.total ?? 0) / (r.data.pageSize ?? 25))}</span><Button size="sm" disabled={page * (r.data.pageSize ?? 25) >= (r.data.total ?? 0)} onClick={() => setPage(page + 1)}>Next</Button></div>}
    </SectionPanel>
  </>}</QueryFrame>
}

// ---------------------------------------------------------------- Data operations
type DataOpsData = { lastStudentWrite: string | null; lastWriteByTable: Record<string, string>; rowCounts: Record<string, number>; outcomes: StudentData['outcomes']; ingest: { day: string; kind: string; detail: string; count: number }[] }
export function DataOps() {
  const query = useReport<DataOpsData>('dataops')
  return <QueryFrame query={query}>{r => <>
    <div className="cc-grid cc-grid--main">
      <SectionPanel title="Student data" tip="Latest updated_at across student tables, and current row counts." section={r.sections.historical} timeZone={tz(r)}>
        <p>Last student write: <strong>{formatTime(r.data.lastStudentWrite ?? null, tz(r))}</strong></p>
        <DataTable caption="Student tables" rows={Object.keys({ ...(r.data.lastWriteByTable ?? {}), ...(r.data.rowCounts ?? {}) }).map(table => ({ table, rows: r.data.rowCounts?.[table] ?? null, last_write: r.data.lastWriteByTable?.[table] ?? null }))} columns={[{ key: 'table', label: 'Table' }, { key: 'rows', label: 'Rows now' }, { key: 'last_write', label: 'Last write', render: row => formatTime(row.last_write as string | null, tz(r)) }]} />
      </SectionPanel>
      <SectionPanel title="Save outcomes (live)" section={r.sections.live} timeZone={tz(r)}><DataTable caption="Save outcomes" rows={r.data.outcomes ?? []} columns={[{ key: 'feature', label: 'Feature' }, { key: 'op', label: 'Operation' }, { key: 'succeeded', label: 'Saved' }, { key: 'failed', label: 'Failed' }]} /></SectionPanel>
    </div>
    <SectionPanel title="Supabase usage" section={r.sections.supabase}><p /></SectionPanel>
  </>}</QueryFrame>
}

// ---------------------------------------------------------------- Custom reports
type CustomDef = { id: string; name: string; event: string | null; measure: (typeof MEASURES)[number]; dimension: (typeof DIMENSIONS)[number]; limit: number }
type CustomData = { reports: CustomDef[]; definition: CustomDef | null }
export function Custom() {
  const [params, setParams] = useSearchParams()
  const id = params.get('report_id')
  const query = useReport<CustomData>('custom', { id })
  const save = useSaveConfig()
  const [draft, setDraft] = useState<Omit<CustomDef, 'id'> | null>(null)
  const choose = (value: string | null) => setParams(current => { const next = new URLSearchParams(current); if (value) next.set('report_id', value); else next.delete('report_id'); return next }, { replace: true })
  return <QueryFrame query={query}>{r => {
    const reports = r.data.reports ?? []
    return <>
      <Panel title="Saved reports" description="Built from a closed list of events, measures and dimensions — no raw SQL." actions={<Button size="sm" onClick={() => setDraft({ name: '', event: 'page_view', measure: 'events', dimension: 'route', limit: 20 })}>New report</Button>}>
        {reports.length ? <div className="cc-badges">{reports.map(item => <span key={item.id} className="cc-badges"><Button size="sm" variant={item.id === id ? 'primary' : 'default'} onClick={() => choose(item.id)}>{item.name}</Button><Button size="sm" variant="ghost" aria-label={`Delete ${item.name}`} onClick={() => save.mutate({ key: 'reports', value: reports.filter(x => x.id !== item.id) }, { onSuccess: () => item.id === id && choose(null) })}>×</Button></span>)}</div> : <p className="cc-muted">No saved reports yet.</p>}
        {draft && <div className="cc-an-builder">
          <label>Name<input className="cc-input" maxLength={60} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>Event<select className="cc-input" value={draft.event ?? ''} onChange={event => setDraft({ ...draft, event: event.target.value || null })}><option value="">Any event</option>{EVENT_NAMES.map(name => <option key={name}>{name}</option>)}</select></label>
          <label>Measure<select className="cc-input" value={draft.measure} onChange={event => setDraft({ ...draft, measure: event.target.value as CustomDef['measure'] })}>{MEASURES.map(m => <option key={m}>{m}</option>)}</select></label>
          <label>Group by<select className="cc-input" value={draft.dimension} onChange={event => setDraft({ ...draft, dimension: event.target.value as CustomDef['dimension'] })}>{DIMENSIONS.map(d => <option key={d}>{d}</option>)}</select></label>
          <label>Rows<input className="cc-input" type="number" min={1} max={100} value={draft.limit} onChange={event => setDraft({ ...draft, limit: Math.max(1, Math.min(100, Number(event.target.value) || 1)) })} /></label>
          <div className="cc-badges">
            <Button size="sm" variant="primary" disabled={!draft.name.trim() || save.isPending || reports.length >= 20} onClick={() => { const next = { ...draft, name: draft.name.trim(), id: `r-${Date.now().toString(36)}` }; save.mutate({ key: 'reports', value: [...reports, next] }, { onSuccess: () => { setDraft(null); choose(next.id) } }) }}>Save report</Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
          {save.isError && <p className="cc-note cc-note--warn" role="alert">{problem(save.error)}</p>}
        </div>}
      </Panel>
      {r.data.definition && <SectionPanel title={r.data.definition.name} tip={`${r.data.definition.measure} of ${r.data.definition.event ?? 'any event'} by ${r.data.definition.dimension}.`} section={r.sections.main} timeZone={tz(r)}>
        {r.data.definition.dimension === 'day' ? <DailyChart label={r.data.definition.name} data={r.table.map(row => ({ day: String(row.day), value: Number(row.value) }))} series={[{ key: 'value', name: r.data.definition.measure, color: 'var(--cc-accent)' }]} /> : <BarList label={r.data.definition.name} data={r.table} nameKey={r.data.definition.dimension} valueKey="value" />}
        <DataTable caption={r.data.definition.name} rows={r.table} columns={[{ key: r.data.definition.dimension, label: r.data.definition.dimension }, { key: 'value', label: r.data.definition.measure }]} />
      </SectionPanel>}
    </>
  }}</QueryFrame>
}

// ---------------------------------------------------------------- Alerts
type Rule = { id: string; label: string; metric: string; comparator: 'above' | 'below'; threshold: number; windowMinutes: number; muted?: boolean }
type AlertsData = { rules: Rule[]; evaluations: { id: string; value: number; breached: boolean }[]; events: { id: string; rule_id: string; status: string; triggered_at: string; last_seen_at: string; value: number; threshold: number; message: string }[] }
const METRICS = ['errors', 'write_failures', 'page_views', 'signups', 'poor_lcp_share', 'no_events_minutes']
export function Alerts() {
  const query = useReport<AlertsData>('alerts')
  const save = useSaveConfig()
  const client = useQueryClient()
  const update = useMutation({ mutationFn: (input: { id: string; status: string }) => controlFetch('analytics', { method: 'PUT', body: { kind: 'alert', ...input } }), onSuccess: () => void client.invalidateQueries({ queryKey: ['control', 'analytics'] }) })
  const [draft, setDraft] = useState<Rule | null>(null)
  return <QueryFrame query={query}>{r => {
    const rules = r.data.rules ?? []
    const value = (id: string) => r.data.evaluations?.find(item => item.id === id)
    return <>
      <SectionPanel title="Alert rules" tip="Checked when this view or Overview loads. In-app only: no email or push delivery is configured." section={r.sections.main} timeZone={tz(r)} actions={<Button size="sm" onClick={() => setDraft({ id: `a-${Date.now().toString(36)}`, label: '', metric: 'errors', comparator: 'above', threshold: 10, windowMinutes: 60 })}>New rule</Button>}>
        <DataTable caption="Alert rules" rows={rules as unknown as Record<string, unknown>[]} columns={[
          { key: 'label', label: 'Rule' }, { key: 'metric', label: 'Metric' },
          { key: 'threshold', label: 'Condition', render: row => `${String(row.comparator)} ${String(row.threshold)} in ${String(row.windowMinutes)} min` },
          { key: 'now', label: 'Now', render: row => { const v = value(String(row.id)); return v ? <Badge tone={v.breached ? 'crit' : 'ok'}>{v.value}</Badge> : '—' } },
          { key: 'muted', label: '', render: row => <span className="cc-badges">
            <Button size="sm" variant="ghost" onClick={() => save.mutate({ key: 'alerts.rules', value: rules.map(rule => rule.id === row.id ? { ...rule, muted: !rule.muted } : rule) })}>{row.muted ? 'Unmute' : 'Mute'}</Button>
            <Button size="sm" variant="ghost" onClick={() => save.mutate({ key: 'alerts.rules', value: rules.filter(rule => rule.id !== row.id) })}>Delete</Button>
          </span> }
        ]} />
        {draft && <div className="cc-an-builder">
          <label>Label<input className="cc-input" maxLength={60} value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} /></label>
          <label>Metric<select className="cc-input" value={draft.metric} onChange={event => setDraft({ ...draft, metric: event.target.value })}>{METRICS.map(m => <option key={m}>{m}</option>)}</select></label>
          <label>Comparator<select className="cc-input" value={draft.comparator} onChange={event => setDraft({ ...draft, comparator: event.target.value as Rule['comparator'] })}><option>above</option><option>below</option></select></label>
          <label>Threshold<input className="cc-input" type="number" min={0} value={draft.threshold} onChange={event => setDraft({ ...draft, threshold: Math.max(0, Number(event.target.value) || 0) })} /></label>
          <label>Window (minutes)<input className="cc-input" type="number" min={5} max={10080} value={draft.windowMinutes} onChange={event => setDraft({ ...draft, windowMinutes: Math.max(5, Math.min(10080, Number(event.target.value) || 60)) })} /></label>
          <div className="cc-badges"><Button size="sm" variant="primary" disabled={!draft.label.trim() || save.isPending || rules.length >= 20} onClick={() => save.mutate({ key: 'alerts.rules', value: [...rules, { ...draft, label: draft.label.trim() }] }, { onSuccess: () => setDraft(null) })}>Save rule</Button><Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button></div>
        </div>}
        {(save.isError || update.isError) && <p className="cc-note cc-note--warn" role="alert">{problem(save.error ?? update.error)}</p>}
      </SectionPanel>
      <Panel title="Alert history" description="One active alert per rule (duplicates are merged into it).">
        <DataTable caption="Alerts" rows={(r.data.events ?? []) as unknown as Record<string, unknown>[]} empty="No alerts have fired." columns={[
          { key: 'message', label: 'Alert' }, { key: 'value', label: 'Value' },
          { key: 'triggered_at', label: 'First', render: row => formatTime(String(row.triggered_at), tz(r)) },
          { key: 'last_seen_at', label: 'Last', render: row => formatTime(String(row.last_seen_at), tz(r)) },
          { key: 'status', label: 'Status', render: row => <Badge tone={row.status === 'open' ? 'crit' : row.status === 'resolved' ? 'ok' : 'warn'}>{String(row.status)}</Badge> },
          { key: 'actions', label: '', render: row => row.status === 'resolved' ? null : <span className="cc-badges">
            {row.status !== 'acknowledged' && <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: String(row.id), status: 'acknowledged' })}>Acknowledge</Button>}
            {row.status !== 'muted' && <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: String(row.id), status: 'muted' })}>Mute</Button>}
            <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: String(row.id), status: 'resolved' })}>Resolve</Button>
          </span> }
        ]} />
      </Panel>
    </>
  }}</QueryFrame>
}

// ---------------------------------------------------------------- Tracking health
type HealthData = { lastEvent: string | null; coverageStart: string | null; eventsLast7d: number; testShare: number | null; unknownEvents: { day: string; detail: string; count: number }[]; duplicates: number; invalidBatches: number; rateLimited: number; byName: { event: string; last7d: number; lastSeen: string | null; missingProps: number; droppedProps: number }[]; reportStatus: { report: string; status: string; source: string }[] }
export function Health() {
  const query = useReport<HealthData>('health')
  return <QueryFrame query={query}>{r => <>
    <SectionPanel title="Tracking health" tip="Last 7 days, all environments, including test traffic." section={r.sections.main} timeZone={tz(r)}>
      <div className="cc-kpis">
        <div className="cc-stat"><span className="cc-stat__label">Last event <Tip text="Most recent event received." /></span><strong className="cc-stat__value cc-stat__value--small">{formatTime(r.data.lastEvent ?? null, tz(r))}</strong></div>
        <div className="cc-stat"><span className="cc-stat__label">Coverage start <Tip text="First non-test event ever stored. Live figures before this date are unavailable." /></span><strong className="cc-stat__value cc-stat__value--small">{formatTime(r.data.coverageStart ?? null, tz(r))}</strong></div>
        <Kpi label="Events (7 days)" tip="All stored events." value={r.data.eventsLast7d ?? null} compare={false} />
        <Kpi label="Test traffic" tip="Share of events tagged test (preview deployments or ?analytics_test=1). Excluded from reports unless included in the filter." value={r.data.testShare ?? null} unit="%" compare={false} />
        <Kpi label="Duplicates dropped" tip="Re-sent events ignored by id (idempotency)." value={r.data.duplicates ?? null} compare={false} />
        <Kpi label="Rejected batches" tip="Malformed batches + rate-limited batches." value={(r.data.invalidBatches ?? 0) + (r.data.rateLimited ?? 0)} compare={false} />
      </div>
    </SectionPanel>
    <div className="cc-grid cc-grid--main">
      <Panel title="Events"><DataTable caption="Event health" rows={r.data.byName ?? []} columns={[{ key: 'event', label: 'Event' }, { key: 'last7d', label: '7 days' }, { key: 'lastSeen', label: 'Last seen', render: row => row.lastSeen ? formatTime(String(row.lastSeen), tz(r)) : <Badge tone="warn">Not seen</Badge> }, { key: 'missingProps', label: 'Missing props', tip: 'Events missing an expected property.' }, { key: 'droppedProps', label: 'Dropped props', tip: 'Events that sent a property outside the allowlist (dropped).' }]} /></Panel>
      <div className="cc-stack">
        <Panel title="Unknown events"><DataTable caption="Unknown events" rows={r.data.unknownEvents ?? []} columns={[{ key: 'day', label: 'Day (UTC)' }, { key: 'detail', label: 'Name' }, { key: 'count', label: 'Count' }]} empty="None — every event received was in the taxonomy." /></Panel>
        <Panel title="Data status by section"><DataTable caption="Report status" rows={r.data.reportStatus ?? []} columns={[{ key: 'report', label: 'Section' }, { key: 'status', label: 'Status', render: row => <Badge tone={row.status === 'live' ? 'ok' : row.status === 'historical' ? 'info' : row.status === 'partial' ? 'warn' : 'neutral'}>{String(row.status)}</Badge> }, { key: 'source', label: 'Source' }]} /></Panel>
      </div>
    </div>
  </>}</QueryFrame>
}

// ---------------------------------------------------------------- Admin audit (read-only view of the existing trail)
export function AdminAudit() {
  const query = useQuery({ queryKey: ['control', 'audit', 'analytics-tab'], queryFn: () => controlFetch<AuditResponse>('audit?page=1&pageSize=25&tz=Asia/Kolkata') })
  return <QueryFrame query={query}>{data => <Panel title="Admin audit" description="Read-only: the 25 most recent privileged Control Center actions, from the existing audit trail (kept separate from product analytics)." actions={<><Badge tone="info">Historical</Badge><Link className="cc-link" to={`${CONSOLE_BASE}/audit`}>Open the full audit log</Link></>}>
    <DataTable caption="Recent admin actions" rows={data.events.map(event => { const d = describeAuditEvent(event); return { when: event.occurred_at, what: d.title, who: d.actor, outcome: event.outcome } })} empty="No audit events yet." columns={[
      { key: 'when', label: 'When (IST)', render: row => formatTime(String(row.when)) }, { key: 'what', label: 'Action' }, { key: 'who', label: 'By' },
      { key: 'outcome', label: 'Outcome', render: row => <Badge tone={row.outcome === 'success' ? 'ok' : row.outcome === 'denied' ? 'warn' : 'crit'}>{String(row.outcome)}</Badge> }
    ]} />
    <p className="cc-muted">Total events: {data.total.toLocaleString('en-IN')}.</p>
  </Panel>}</QueryFrame>
}
