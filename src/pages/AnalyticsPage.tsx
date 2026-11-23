import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { loadHiddenSeries, saveHiddenSeries } from '../lib/analytics-legend'
import { useNavigate } from 'react-router-dom'
import {
  Activity, BarChart3, BookOpen, CircleHelp, Clock3, Pin, PinOff, Plus, Sparkles, Target
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, PolarAngleAxis, PolarGrid,
  Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import { Button, NotebookCard, PageHeader, ProgressBar, ProgressRing, StatusBadge, SubjectBadge } from '../components/ui'
import { Meter } from '../components/jee/shared'
import type { Subject } from '../types'
import { WeeklyReportCard } from '../components/jee/WeeklyReportCard'
import { LearningPipelineCard } from '../components/jee/LearningPipelineCard'
import { loadHoursView, saveHoursView, type HoursView } from '../lib/analytics-prefs'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import {
  getAccuracy, getAttemptRate, getChapterPerformance, getMarksTrend, getMistakeCounts,
  getNegativeMarkImpact, getOverallTestAverage, getOverallTestScore, getSubjectPerformance
} from '../lib/analytics'
import { cachedDateFormat, prettyDate } from '../lib/date'
import { fmtDuration, fmtNumber } from '../lib/format'
import { makeStudyBars, makeStudyHeatmap } from '../lib/study-aggregation'
import { subjectColor } from '../lib/exams/subjects'
import { T } from '../lib/student-layout/T'
import { usePageSlots } from '../lib/student-layout/use-layout'


/** Calendar ticks for the time-based trend axis, in the Indian format Stracker uses. */
function chartDate(value: number | string): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(`${String(value).slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return cachedDateFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(date)
}
function chartDateLong(value: number | string): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(`${String(value).slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return cachedDateFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(date)
}
const chartColors = { accent: 'var(--accent)', overall: 'var(--chart-overall)', green: 'var(--green)', orange: 'var(--subject-maths)', red: 'var(--red)', muted: 'var(--muted)' }

/* ------------------------------------------------------------ pinned charts */

const PIN_LIMIT = 3
const CHART_IDS = ['performance', 'mistakes', 'study-hours', 'heatmap', 'syllabus', 'target'] as const
type ChartId = typeof CHART_IDS[number]

const CHART_TITLES: Record<ChartId, string> = {
  performance: 'Marks & subjects',
  mistakes: 'Mistake breakdown',
  'study-hours': 'Study hours',
  heatmap: 'Study-day rhythm',
  syllabus: 'Syllabus progress',
  target: 'Mock target'
}

function pinnedStorageKey(userId: string) { return `stracker-pinned-charts:${userId}` }

/** Pinned charts are a device-level UI preference, stored beside the focus-timer state. */
function loadPinned(userId: string): ChartId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(pinnedStorageKey(userId)) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((id): id is ChartId => CHART_IDS.includes(id)).slice(0, PIN_LIMIT)
  } catch { return [] }
}

function savePinned(userId: string, pinned: ChartId[]) {
  try { localStorage.setItem(pinnedStorageKey(userId), JSON.stringify(pinned)) } catch { /* a blocked store does not stop pinning in-session */ }
}

const TREND_RANGES = ['30', '90', '180', 'all'] as const
function trendRangeKey(userId: string) { return `stracker-analytics-range:${userId}` }

/** The marks-trend range is a device-level UI preference, stored beside pinned charts. */
function loadTrendRange(userId: string): string {
  try {
    const raw = localStorage.getItem(trendRangeKey(userId))
    return raw && (TREND_RANGES as readonly string[]).includes(raw) ? raw : '90'
  } catch { return '90' }
}

function saveTrendRange(userId: string, range: string) {
  try { localStorage.setItem(trendRangeKey(userId), range) } catch { /* a blocked store keeps the range for this visit only */ }
}

export default function AnalyticsPage() {
  const sl = usePageSlots('analytics')
  const { data } = useData()
  const { user } = useAuth()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [pinned, setPinned] = useState<ChartId[]>(() => loadPinned(user?.id ?? 'session'))
  const [favFlash, setFavFlash] = useState(false)
  const favouritesRef = useRef<HTMLElement | null>(null)

  useEffect(() => { savePinned(user?.id ?? 'session', pinned) }, [pinned, user?.id])

  const togglePin = (id: ChartId) => {
    setPinned(current => {
      if (current.includes(id)) return current.filter(item => item !== id)
      if (current.length >= PIN_LIMIT) {
        notify(`You can pin up to ${PIN_LIMIT} charts. Unpin one first — try the pin button on “${CHART_TITLES[current[0] ?? id]}”.`, 'error')
        return current
      }
      notify(`${CHART_TITLES[id]} pinned to your favourites.`)
      window.requestAnimationFrame(() => {
        favouritesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        setFavFlash(true)
        window.setTimeout(() => setFavFlash(false), 1200)
      })
      return [...current, id]
    })
  }

  const trends = useMemo(() => getMarksTrend(data, 5000), [data])

  const subjects = useMemo(() => getSubjectPerformance(data), [data])
  const chapterRows = useMemo(() => getChapterPerformance(data), [data])
  const accuracy = getAccuracy(data)
  const attempt = getAttemptRate(data)
  const negativeMetrics = getNegativeMarkImpact(data)
  const negativeImpact = negativeMetrics.percentage
  const mistakeCounts = getMistakeCounts(data)
  const heatmap = useMemo(() => makeStudyHeatmap(data.sessions, data.settings.daily_study_goal_minutes), [data.sessions, data.settings.daily_study_goal_minutes])
  const totalChapters = data.chapters.length
  const doneChapters = data.chapters.filter(chapter => chapter.status === 'Done' || chapter.status === 'Revised').length
  const overallAverage = getOverallTestAverage(data)
  const averageScore = overallAverage.average
  const targetComparison = useMemo(() => getTargetComparison(data), [data])
  const hasTestScore = trends.some(row => Object.entries(row).some(([key, value]) => key !== 'date' && value !== null))
  const hasSubjectScores = subjects.some(item => item.average !== null)
  const hasMistakes = mistakeCounts.some(item => item.count > 0)
  const hasSessions = data.sessions.some(session => session.duration_minutes > 0)
  const hasAttemptData = accuracy.rate !== null || attempt.rate !== null || negativeMetrics.totalNegativeMarks > 0 || data.sessions.length > 0

  const downloadChartCsv = () => {
    const subjectNames = subjects.map(item => item.subject)
    const rows = [['Date', 'Overall %', ...subjectNames.map(subject => `${subject} %`)], ...trends.map(item => [item.date, item.overall ?? '', ...subjectNames.map(subject => item[subject] ?? '')])]
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n')
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'stracker-performance.csv'; link.click(); URL.revokeObjectURL(url)
    notify('Performance trend exported as CSV.')
  }

  const chartProps = { data, trends, subjects, mistakeCounts, heatmap, chapterRows, totalChapters, doneChapters, targetComparison, hasTestScore, hasSubjectScores, hasMistakes, hasSessions, accuracy, attempt, negativeMetrics, negativeImpact, onPin: togglePin, pinned }

  const inMainGrid = (id: ChartId) => !pinned.includes(id)
  const renderCard = (id: ChartId, key?: string) => {
    switch (id) {
      case 'performance': return <PerformanceCard key={key ?? id} {...chartProps} />
      case 'mistakes': return <MistakeBreakdownCard key={key ?? id} {...chartProps} />
      case 'study-hours': return <StudyHoursCard key={key ?? id} {...chartProps} />
      case 'heatmap': return <HeatmapCard key={key ?? id} {...chartProps} />
      case 'syllabus': return <SyllabusProgressCard key={key ?? id} {...chartProps} />
      case 'target': return <MockTargetCard key={key ?? id} {...chartProps} />
    }
  }

  return <div className="content-page analytics-page">
    <PageHeader layoutId="analytics.header" title="Analytics" subtitle="Based on your records." doodle={<Activity size={20} />} action={<Button variant="secondary" onClick={downloadChartCsv}><BarChart3 size={16} />{' '}<T k="analytics:export-trend-csv">{"Export trend CSV"}</T></Button>} />
    <WeeklyReportCard />
    <LearningPipelineCard />
    <div {...sl.attrs('kpis')} className="analytics-kpi-grid"><NotebookCard className="analytics-kpi"><span><Activity size={15} />{' '}<T k="analytics:tests-logged">{"TESTS LOGGED"}</T></span><strong>{data.tests.length}</strong><small>{overallAverage.count} with usable test results</small></NotebookCard><NotebookCard className="analytics-kpi"><span><BookOpen size={15} />{' '}<T k="analytics:syllabus">{"SYLLABUS"}</T></span><strong>{totalChapters ? <>{doneChapters}<span className="kpi-denominator">/{totalChapters}</span></> : '—'}</strong><small>{totalChapters ? `${Math.round(doneChapters / totalChapters * 100)}% chapters completed` : 'No chapters saved'}</small></NotebookCard><NotebookCard className="analytics-kpi"><span><Clock3 size={15} />{' '}<T k="analytics:study-hours">{"STUDY HOURS"}</T></span><strong>{fmtNumber(data.sessions.reduce((sum, session) => sum + session.duration_minutes, 0) / 60, 1)}</strong><small>{data.sessions.length} logged focus session{data.sessions.length === 1 ? '' : 's'}</small></NotebookCard><NotebookCard className="analytics-kpi"><span><Target size={15} />{' '}<T k="analytics:test-average">{"TEST AVERAGE"}</T></span><strong>{averageScore === null ? '—' : `${Math.round(averageScore)}%`}</strong><small>{overallAverage.count ? `Mean of ${overallAverage.count} usable test result${overallAverage.count === 1 ? '' : 's'}; one test counts once` : 'Add a scored test to begin'}</small></NotebookCard></div>

    {data.tests.length === 0 && <SamplePreviewCard onAddTest={() => navigate('/tests?add=1')} />}

    {pinned.length > 0 && <section ref={favouritesRef} className={`favourites-section${favFlash ? ' is-flash' : ''}`} aria-label="Favourite charts">
      <div className="section-heading favourites-heading"><div><h2><T k="analytics:favourites">{"Favourites"}</T></h2><p>Pinned charts stay on top. Pin up to {PIN_LIMIT}.</p></div><StatusBadge tone="muted">{pinned.length}/{PIN_LIMIT} pinned</StatusBadge></div>
      <div className="analytics-grid two-col favourites-grid">{pinned.map(id => renderCard(id, `fav-${id}`))}</div>
    </section>}

    {inMainGrid('performance') && renderCard('performance')}

    <section className="section-heading analytics-section-title"><div><h2><T k="analytics:how-the-attempts-are-landing">{"How the attempts are landing"}</T></h2><p><T k="analytics:every-calculation-is-based-only-on-the-f">{"Based on the fields you filled in."}</T></p></div></section>
    {hasAttemptData ? <div className="analytics-metric-grid">
      <NotebookCard className="metric-detail-card"><div className="metric-head"><span className="metric-icon green"><CheckMarkSmall /></span><span><T k="analytics:accuracy">{"ACCURACY"}</T></span></div><strong>{accuracy.rate === null ? '—' : `${Math.round(accuracy.rate)}%`}</strong><p>{accuracy.correct} correct / {accuracy.attempted || '—'} attempted</p><ProgressBar value={accuracy.rate ?? 0} color={chartColors.green} /></NotebookCard>
      <NotebookCard className="metric-detail-card"><div className="metric-head"><span className="metric-icon blue"><Activity size={16} /></span><span><T k="analytics:attempt-rate">{"ATTEMPT RATE"}</T></span></div><strong>{attempt.rate === null ? '—' : `${Math.round(attempt.rate)}%`}</strong><p>{attempt.attempted} attempted / {attempt.total || '—'} total questions</p><ProgressBar value={attempt.rate ?? 0} color={chartColors.accent} /></NotebookCard>
      <NotebookCard className="metric-detail-card"><div className="metric-head"><span className="metric-icon orange"><CircleHelp size={16} /></span><span><T k="analytics:negative-marks">{"NEGATIVE MARKS"}</T></span></div><strong>{negativeMetrics.totalNegativeMarks > 0 || data.tests.some(test => test.negative_marks === 0) ? fmtNumber(negativeMetrics.totalNegativeMarks, 1) : '—'}</strong><p>{negativeImpact === null ? 'No test has both recorded negative marks and a usable total' : `${negativeImpact.toFixed(1)}% of totals from ${negativeMetrics.testsIncluded} comparable test${negativeMetrics.testsIncluded === 1 ? '' : 's'}`}</p>{negativeImpact !== null && <ProgressBar value={negativeImpact} color={chartColors.orange} />}</NotebookCard>
      <NotebookCard className="metric-detail-card"><div className="metric-head"><span className="metric-icon violet"><Clock3 size={16} /></span><span><T k="analytics:study-time">{"STUDY TIME"}</T></span></div><strong>{fmtDuration(data.sessions.reduce((sum, session) => sum + session.duration_minutes, 0))}</strong><p>{data.sessions.filter(item => item.completion_state === 'completed').length} completed focus sessions</p><span className="metric-inline-note"><T k="analytics:no-sessions-start-the-timer-in-focus-mod">{"No sessions yet. Start one in Focus."}</T></span></NotebookCard>
    </div> : <NotebookCard className="chart-card chart-card-flat"><NoDataLine label="Attempt metrics" hint="Log correct and wrong counts with a test." /></NotebookCard>}

    <div className="analytics-grid two-col analytics-lower-grid">
      {inMainGrid('mistakes') && renderCard('mistakes')}
      {inMainGrid('study-hours') && renderCard('study-hours')}
    </div>

    {inMainGrid('heatmap') && renderCard('heatmap')}

    {hasSessions && <section className="section-heading analytics-section-title"><div><h2><T k="analytics:where-the-hours-go">{"Where the hours go"}</T></h2><p>Study time and marks, side by side, from your own records.</p></div></section>}
    {hasSessions && <div className="analytics-grid two-col analytics-alloc-grid">
      <SubjectTimeCard data={data} />
      <TimeVersusMarksCard data={data} subjects={subjects} />
    </div>}

    <div className="analytics-grid two-col analytics-final-grid">
      {inMainGrid('syllabus') && renderCard('syllabus')}
      {inMainGrid('target') && renderCard('target')}
    </div>

    {!sl.hidden('insights') && <div {...sl.attrs('insights')} className="analytics-insight-row"><NotebookCard className="analytics-insight-card"><span className="insight-pencil">✎</span><div><span className="eyebrow"><T k="analytics:chapter-signals">{"CHAPTER SIGNALS"}</T></span><p><strong>{chapterRows.filter(item => item.classification === 'Untested').length}</strong>{' '}<T k="analytics:untested">{"untested ·"}</T>{' '}<strong>{chapterRows.filter(item => item.classification === 'Weak').length}</strong>{' '}<T k="analytics:weak">{"weak ·"}</T>{' '}<strong>{chapterRows.filter(item => item.dropping).length}</strong>{' '}<T k="analytics:dropping">{"dropping"}</T></p></div><button onClick={() => navigate('/weak-areas')}><T k="analytics:see-weak-areas">{"See weak areas ↗"}</T></button></NotebookCard></div>}
  </div>
}

/* ------------------------------------------------------------ shared pieces */

interface ChartCardProps {
  data: ReturnType<typeof useData>['data']
  trends: ReturnType<typeof getMarksTrend>
  subjects: ReturnType<typeof getSubjectPerformance>
  mistakeCounts: ReturnType<typeof getMistakeCounts>
  heatmap: ReturnType<typeof makeStudyHeatmap>
  chapterRows: ReturnType<typeof getChapterPerformance>
  totalChapters: number
  doneChapters: number
  targetComparison: { score: number; gap: number; state: 'below' | 'near' | 'above' } | null
  hasTestScore: boolean
  hasSubjectScores: boolean
  hasMistakes: boolean
  hasSessions: boolean
  accuracy: ReturnType<typeof getAccuracy>
  attempt: ReturnType<typeof getAttemptRate>
  negativeMetrics: ReturnType<typeof getNegativeMarkImpact>
  negativeImpact: number | null
  pinned: ChartId[]
  onPin: (id: ChartId) => void
}

/** Compact single-line state for a section with nothing to draw yet. */
function NoDataLine({ label, hint, action }: { label: string; hint?: string; action?: ReactNode }) {
  return <div className="chart-empty-line">
    <span className="chart-empty-title">{label} — No data yet</span>
    {hint && <span className="chart-empty-hint">{hint}</span>}
    {action}
  </div>
}

function PinButton({ id, pinned, onPin }: { id: ChartId; pinned: boolean; onPin: (id: ChartId) => void }) {
  const title = CHART_TITLES[id]
  return <button
    type="button"
    className={`chart-pin ${pinned ? 'pinned' : ''}`}
    onClick={() => onPin(id)}
    aria-pressed={pinned}
    aria-label={pinned ? `Unpin ${title} from favourites` : `Pin ${title} to favourites (up to 3)`}
    title={pinned ? `Unpin ${title}` : `Pin ${title} to favourites`}
  >
    {pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
  </button>
}

/** Teaches the value of the page without inventing data: a clearly-marked example. */
function SamplePreviewCard({ onAddTest }: { onAddTest: () => void }) {
  return <NotebookCard className="analytics-preview-card">
    <div className="preview-head">
      <span className="preview-chip"><Sparkles size={13} aria-hidden="true" />{' '}<T k="analytics:example-not-your-data">{"EXAMPLE · NOT YOUR DATA"}</T></span>
      <span className="preview-eyebrow"><T k="analytics:what-3-tests-unlock">{"PREVIEW"}</T></span>
    </div>
    <div className="preview-body">
      <div className="preview-copy">
        <p><T k="analytics:after">{"After"}</T>{' '}<strong><T k="analytics:l-3-tests">{"3 tests"}</T></strong><T k="analytics:youll-see-your-marks-trend-subject-balan">{", you’ll see your performance trends here."}</T></p>
        <Button variant="secondary" size="sm" onClick={onAddTest}><Plus size={15} />{' '}<T k="analytics:log-your-first-test">{"Log your first test"}</T></Button>
      </div>
      <div className="preview-illustration" aria-hidden="true">
        <svg viewBox="0 0 240 104" role="presentation">
          <polyline points="6,86 52,70 98,76 144,52 190,44 234,18" fill="none" stroke={chartColors.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="52" cy="70" r="3.5" fill={chartColors.accent} /><circle cx="98" cy="76" r="3.5" fill={chartColors.accent} /><circle cx="144" cy="52" r="3.5" fill={chartColors.accent} /><circle cx="190" cy="44" r="3.5" fill={chartColors.accent} />
          <rect x="10" y="58" width="16" height="40" rx="4" fill="var(--subject-physics)" opacity=".55" />
          <rect x="34" y="44" width="16" height="54" rx="4" fill="var(--subject-chemistry)" opacity=".55" />
          <rect x="58" y="66" width="16" height="32" rx="4" fill="var(--subject-maths)" opacity=".55" />
        </svg>
        <span className="preview-caption"><T k="analytics:marks-trend-subject-balance">{"Marks trend + subject balance"}</T></span>
      </div>
    </div>
  </NotebookCard>
}

/* ------------------------------------------------------------ chart cards */

function PerformanceCard({ data, trends, subjects, hasTestScore, hasSubjectScores, pinned, onPin }: ChartCardProps) {
  const { user } = useAuth()
  const rangeOwner = user?.id ?? 'session'
  // The chosen range is remembered on this device (like pinned charts), so a reload keeps it.
  const [range, setRangeState] = useState(() => loadTrendRange(rangeOwner))
  const setRange = (value: string) => { setRangeState(value); saveTrendRange(rangeOwner, value) }
  // Legend entries toggle their line on the chart; at least one series always stays visible.
  const [storedHidden, setStoredHidden] = useState<string[]>(() => loadHiddenSeries(rangeOwner))
  const seriesKeys = ['overall', ...subjects.map(item => item.subject)]
  // Unknown keys are ignored, and if a stored choice would hide every line, all lines show.
  const knownHidden = storedHidden.filter(item => seriesKeys.includes(item))
  const hiddenSeries = knownHidden.length >= seriesKeys.length ? [] : knownHidden
  const setHiddenSeries = (update: (current: string[]) => string[]) => {
    const next = update(hiddenSeries)
    setStoredHidden(next)
    saveHiddenSeries(rangeOwner, next)
  }
  const toggleSeries = (key: string) => setHiddenSeries(current => current.includes(key)
    ? current.filter(item => item !== key)
    : seriesKeys.filter(item => item !== key && !current.includes(item)).length === 0 ? current : [...current, key])
  const rangedTrends = useMemo(() => getMarksTrend(data, range === 'all' ? 5000 : Number(range)), [data, range])
  // The X-axis is a real time scale: each row carries its epoch so a 13-day gap
  // occupies 13 days of space and a 2-day gap occupies two.
  const timeTrends = useMemo(() => rangedTrends.map(row => ({ ...row, t: new Date(`${row.date}T12:00:00`).getTime() })), [rangedTrends])
  // Screen-reader equivalent of the trend chart (plain concatenation, no JSX template trick).
  const trendRows = useMemo(() => {
    const head: (string | number | null)[] = ['Date', 'Overall %']
    for (const item of subjects) head.push(item.subject + ' %')
    return [head, ...trends.slice(-12).map(row => {
      const out: (string | number | null)[] = [prettyDate(row.date), row.overall === null ? null : Math.round(row.overall)]
      for (const item of subjects) {
        const value = row[item.subject]
        out.push(value === null || value === undefined ? null : Math.round(Number(value)))
      }
      return out
    })]
  }, [trends, subjects])
  const nothingAtAll = !hasTestScore && !hasSubjectScores
  return <NotebookCard className={`chart-card performance-card ${nothingAtAll ? 'chart-card-flat' : ''}`}>
    <div className="chart-card-head">
      <div><span className="eyebrow"><T k="analytics:percentage-not-raw-marks">{"PERFORMANCE"}</T></span><h2>{CHART_TITLES.performance}</h2><p><T k="analytics:the-trend-of-your-comparable-results-wit">{"Your score trend and subject balance."}</T></p></div>
      <div className="chart-head-actions">
        {hasTestScore && <select value={range} onChange={event => setRange(event.target.value)} aria-label="Choose marks trend range"><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="180">Last 6 months</option><option value="all">All recorded tests</option></select>}
        <PinButton id="performance" pinned={pinned.includes('performance')} onPin={onPin} />
      </div>
    </div>
    {nothingAtAll ? <NoDataLine label="Marks & subjects" hint="Log a test to start the trend." /> : <>
      {hasTestScore ? <>
        <div className="chart-frame trend-chart"><ResponsiveContainer width="100%" height={280}><LineChart data={timeTrends} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5" /><XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={value => chartDate(Number(value))} tick={{ fill: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-body)' }} tickLine={false} axisLine={false} minTickGap={34} tickMargin={8} padding={{ left: 14, right: 8 }} /><YAxis domain={[0, 100]} width={44} tickMargin={6} tick={{ fill: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-body)' }} tickLine={false} axisLine={false} tickFormatter={value => `${value}%`} /><Tooltip content={<NotebookTooltip />} labelFormatter={value => chartDateLong(Number(value))} /><Line type="monotone" dataKey="overall" name="Overall" hide={hiddenSeries.includes('overall')} stroke={chartColors.overall} strokeWidth={2.5} strokeDasharray="7 5" dot={{ r: 3.5, fill: chartColors.overall, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} />{subjects.map(({ subject }) => <Line key={subject} type="monotone" dataKey={subject} name={subject} hide={hiddenSeries.includes(subject)} stroke={subjectColor(subject)} strokeWidth={2} dot={{ r: 3, fill: subjectColor(subject), strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} />)}</LineChart></ResponsiveContainer>
        <ChartTable caption="Marks trend by test date" rows={trendRows} />
      </div>
      <div className="chart-legend-note chart-legend-toggles" role="group" aria-label="Show or hide trend series"><button type="button" className={`legend-toggle ${hiddenSeries.includes('overall') ? 'is-off' : ''}`} aria-pressed={!hiddenSeries.includes('overall')} onClick={() => toggleSeries('overall')} title={hiddenSeries.includes('overall') ? 'Show Overall' : 'Hide Overall'}><i className="swatch-dashed" style={{ background: `repeating-linear-gradient(90deg, ${chartColors.overall} 0 6px, transparent 6px 9px)` }} />{' '}<T k="analytics:overall">{"Overall"}</T></button>{subjects.map(({ subject }) => <button type="button" key={subject} className={`legend-toggle ${hiddenSeries.includes(subject) ? 'is-off' : ''}`} aria-pressed={!hiddenSeries.includes(subject)} onClick={() => toggleSeries(subject)} title={hiddenSeries.includes(subject) ? `Show ${subject}` : `Hide ${subject}`}><i style={{ background: subjectColor(subject) }} />{subject}</button>)}</div>
      </> : <NoDataLine label="Marks trend" hint="No comparable test result in this range yet." />}
      <div className="performance-subjects">
        {hasSubjectScores ? <>
          <div className="chart-frame radar-chart performance-radar"><ResponsiveContainer width="100%" height={230}><RadarChart data={subjects.map(item => ({ subject: item.subject, score: item.average ?? 0 }))} outerRadius="76%"><PolarGrid stroke="var(--chart-grid)" strokeWidth={1.2} /><PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--ink-soft)', fontSize: 13, fontFamily: 'var(--font-body)' }} /><Radar dataKey="score" name="Average %" stroke={chartColors.accent} strokeWidth={2.5} fill={chartColors.accent} fillOpacity={0.32} /><Tooltip content={<NotebookTooltip />} /></RadarChart></ResponsiveContainer>
        <ChartTable caption="Average marks by subject" rows={[['Subject', 'Average %'], ...subjects.map(item => [item.subject, item.average === null ? null : Math.round(item.average)])]} />
      </div>
          <div className="subject-performance-list performance-subject-list">{subjects.map(item => <div key={item.subject}><SubjectBadge subject={item.subject} /><strong>{item.average === null ? '—' : `${Math.round(item.average)}%`}</strong><small>{item.count} result{item.count === 1 ? '' : 's'}</small></div>)}</div>
        </> : <NoDataLine label="Subject balance" hint="Add subject scores to compare subjects." />}
      </div>
    </>}
  </NotebookCard>
}

function MistakeBreakdownCard({ mistakeCounts, hasMistakes, pinned, onPin }: ChartCardProps) {
  const navigate = useNavigate()
  return <NotebookCard className={`chart-card mistake-chart-card ${hasMistakes ? '' : 'chart-card-flat'}`}>
    <div className="chart-card-head"><div><span className="eyebrow"><T k="analytics:notice-the-repeats">{"MISTAKES"}</T></span><h2>{CHART_TITLES.mistakes}</h2><p><T k="analytics:only-entries-saved-in-your-notebook-appe">{"From your mistake notebook."}</T></p></div><div className="chart-head-actions"><button className="chart-link" onClick={() => navigate('/mistakes')}><T k="analytics:open-notebook">{"Open notebook ↗"}</T></button><PinButton id="mistakes" pinned={pinned.includes('mistakes')} onPin={onPin} /></div></div>
    {hasMistakes ? <>
      <div className="chart-frame bar-chart"><ResponsiveContainer width="100%" height={245}><BarChart data={mistakeCounts} margin={{ top: 8, right: 6, left: -17, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5" /><XAxis dataKey="type" tick={{ fill: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-body)' }} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-body)' }} tickLine={false} axisLine={false} /><Tooltip content={<NotebookTooltip />} /><Bar dataKey="count" name="Mistakes" radius={[7, 7, 0, 0]}>{mistakeCounts.map((entry, index) => <Cell key={entry.type} fill={[chartColors.accent, chartColors.orange, chartColors.green, chartColors.red, chartColors.muted][index]} />)}</Bar></BarChart></ResponsiveContainer>
      <ChartTable caption="Mistakes by type" rows={[['Type', 'Count'], ...mistakeCounts.map(item => [item.type, item.count])]} />
    </div>
      <div className="mistake-count-list">{mistakeCounts.map(item => <span key={item.type}>{item.type}<strong>{item.count}</strong></span>)}</div>
    </> : <NoDataLine label="Mistake breakdown" hint="Add mistakes to see the pattern." />}
  </NotebookCard>
}

function StudyHoursCard({ data, hasSessions, pinned, onPin }: ChartCardProps) {
  const { user } = useAuth()
  const owner = user?.id ?? 'session'
  const [hoursView, setHoursViewState] = useState<HoursView>(() => loadHoursView(owner))
  const setHoursView = (view: HoursView) => { setHoursViewState(view); saveHoursView(owner, view) }
  const studyBars = useMemo(() => makeStudyBars(data.sessions, hoursView), [data.sessions, hoursView])
  return <NotebookCard className={`chart-card study-chart-card ${hasSessions ? '' : 'chart-card-flat'}`}>
    <div className="chart-card-head"><div><span className="eyebrow"><T k="analytics:showing-up-counts">{"STUDY TIME"}</T></span><h2>{CHART_TITLES['study-hours']}</h2><p><T k="analytics:logged-focus-sessions-only">{"Logged focus sessions only."}</T></p></div><div className="chart-head-actions"><div className="segmented-control" role="group" aria-label="Study hours grouping">{(['day','week','month'] as const).map(item => <button className={hoursView === item ? 'active' : ''} key={item} onClick={() => setHoursView(item)}>{item}</button>)}</div><PinButton id="study-hours" pinned={pinned.includes('study-hours')} onPin={onPin} /></div></div>
    {hasSessions ? <div className="chart-frame bar-chart"><ResponsiveContainer width="100%" height={245}><BarChart data={studyBars} margin={{ top: 8, right: 7, left: -19, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5" /><XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-body)' }} tickLine={false} axisLine={false} minTickGap={14} /><YAxis tick={{ fill: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-body)' }} tickLine={false} axisLine={false} /><Tooltip content={<NotebookTooltip />} /><Bar dataKey="hours" name="Hours" fill={chartColors.green} radius={[7, 7, 0, 0]} /></BarChart></ResponsiveContainer>
      <ChartTable caption={`Study hours by ${hoursView}`} rows={[['Period', 'Hours'], ...studyBars.slice(-12).map(row => [row.label, row.hours])]} />
    </div> : <NoDataLine label="Study hours" hint="Run a focus session to log study time." />}
  </NotebookCard>
}

function HeatmapCard({ heatmap, hasSessions, pinned, onPin }: ChartCardProps) {
  return <NotebookCard className={`heatmap-card ${hasSessions ? '' : 'chart-card-flat'}`}>
    <div className="chart-card-head"><div><span className="eyebrow"><T k="analytics:a-calendar-of-showing-up">{"CONSISTENCY"}</T></span><h2>{CHART_TITLES.heatmap}</h2><p><T k="analytics:day-intensity-is-compared-with-your-curr">{"Darker days are closer to your daily goal."}</T></p></div><div className="chart-head-actions"><div className="heatmap-legend"><span><T k="analytics:less">{"Less"}</T></span>{['none','low','medium','high','goal'].map(level => <i key={level} className={`heat-cell heat-${level}`} title={level} />)}<span><T k="analytics:goal">{"Goal"}</T></span></div><PinButton id="heatmap" pinned={pinned.includes('heatmap')} onPin={onPin} /></div></div>
    {hasSessions ? <>
      <div className="heatmap-month-labels">{heatmap.months.map(item => <span key={item.key} style={{ gridColumn: item.column }}>{item.label}</span>)}</div>
      <div className="heatmap-grid" role="img" aria-label="Study activity heatmap for the last 16 weeks">{heatmap.cells.map(cell => <span key={cell.date} className={`heat-cell heat-${cell.level}`} title={cell.future ? `${prettyDate(cell.date)} · Upcoming` : `${prettyDate(cell.date)} · ${fmtDuration(cell.minutes)}`} aria-label={cell.future ? `${prettyDate(cell.date)}, upcoming` : `${prettyDate(cell.date)}, ${fmtDuration(cell.minutes)} studied`} />)}</div>
      <div className="heatmap-caption"><span>{heatmap.daysLogged} study day{heatmap.daysLogged === 1 ? '' : 's'} shown</span><span><T k="analytics:consistency-over-intensity">{"Days you studied."}</T></span></div>
    </> : <NoDataLine label="Study-day rhythm" hint="Finish a focus block to start." />}
  </NotebookCard>
}

function SyllabusProgressCard({ data, subjects, totalChapters, doneChapters, pinned, onPin }: ChartCardProps) {
  return <NotebookCard className={`syllabus-analytics-card ${totalChapters ? '' : 'chart-card-flat'}`}>
    <div className="chart-card-head"><div><span className="eyebrow"><T k="analytics:chapters-moving-forward">{"SYLLABUS"}</T></span><h2>{CHART_TITLES.syllabus}</h2><p>{doneChapters} done or revised of {totalChapters} recorded chapters.</p></div><div className="chart-head-actions"><ProgressRing value={totalChapters ? doneChapters / totalChapters * 100 : 0} size={72} label={<span className="ring-value small">{totalChapters ? Math.round(doneChapters / totalChapters * 100) : 0}<small>%</small></span>} /><PinButton id="syllabus" pinned={pinned.includes('syllabus')} onPin={onPin} /></div></div>
    {totalChapters ? <div className="subject-syllabus-list">{subjects.map(({ subject }) => { const chapters = data.chapters.filter(item => item.subject === subject); const done = chapters.filter(item => item.status === 'Done' || item.status === 'Revised').length; return <div key={subject}><div><SubjectBadge subject={subject} /><span>{done} / {chapters.length} chapters</span></div><ProgressBar value={chapters.length ? done / chapters.length * 100 : 0} color={subjectColor(subject)} /></div> })}</div> : <NoDataLine label="Syllabus progress" hint="Add chapters to see progress." />}
  </NotebookCard>
}

function MockTargetCard({ data, targetComparison, pinned, onPin }: ChartCardProps) {
  return <NotebookCard className={`target-score-card ${targetComparison ? '' : 'chart-card-flat'}`}>
    <div className="chart-card-head"><div><span className="eyebrow"><T k="analytics:a-target-not-a-verdict">{"TARGET"}</T></span><h2>{CHART_TITLES.target}</h2><p><T k="analytics:new-mocks-need-all-three-subject-scores">{"Uses full mocks with every subject score."}</T></p></div><div className="chart-head-actions"><Target size={20} /><PinButton id="target" pinned={pinned.includes('target')} onPin={onPin} /></div></div>
    {targetComparison ? <div className="target-comparison"><div className={`target-result target-${targetComparison.state}`}><strong>{fmtNumber(targetComparison.score, 1)}</strong><span><T k="analytics:latest-mock-marks">{"latest mock marks"}</T></span></div><div className="target-arrow">{targetComparison.state === 'above' ? '↑' : targetComparison.state === 'near' ? '≈' : '↓'}</div><div className="target-goal"><strong>{fmtNumber(data.settings.target_score)}</strong><span><T k="analytics:target-score">{"target score"}</T></span></div><StatusBadge tone={targetComparison.state === 'above' ? 'Strong' : targetComparison.state === 'near' ? 'Okay' : 'Weak'}>{targetComparison.state === 'above' ? 'Above target' : targetComparison.state === 'near' ? 'Near target' : 'Below target'} · {targetComparison.gap > 0 ? `${fmtNumber(targetComparison.gap, 1)} to go` : `${fmtNumber(Math.abs(targetComparison.gap), 1)} ahead`}</StatusBadge></div> : <NoDataLine label="Mock target" hint="Log a full mock with every subject score to compare." />}
  </NotebookCard>
}

function getTargetComparison(data: ReturnType<typeof useData>['data']): { score: number; gap: number; state: 'below' | 'near' | 'above' } | null {
  const mocks = data.tests.filter(test => test.test_type === 'Full Mock').sort((a, b) => b.test_date.localeCompare(a.test_date))
  for (const test of mocks) {
    const aggregate = getOverallTestScore(test, data.testSubjectScores)
    if (!aggregate) continue
    const gap = data.settings.target_score - aggregate.marks
    const tolerance = Math.max(1, data.settings.target_score * 0.05)
    return { score: aggregate.marks, gap, state: gap <= 0 ? 'above' : gap <= tolerance ? 'near' : 'below' }
  }
  return null
}

/**
 * Study minutes per subject, joined through the chapter a session was filed under.
 *
 * Sessions with no chapter cannot be attributed, so they are reported as "Unfiled" rather
 * than being silently dropped or spread across subjects.
 */
function SubjectTimeAllocation({ data }: { data: ReturnType<typeof useData>['data'] }) {
  return useMemo(() => {
    const byId = new Map(data.chapters.map(chapter => [chapter.id, chapter.subject]))
    const totals = new Map<string, number>()
    for (const session of data.sessions) {
      const minutes = session.duration_minutes ?? 0
      if (!minutes) continue
      const key = session.chapter_id ? byId.get(session.chapter_id) ?? 'Unfiled' : 'Unfiled'
      totals.set(key, (totals.get(key) ?? 0) + minutes)
    }
    const rows = [...totals.entries()].map(([subject, minutes]) => ({ subject, minutes })).sort((a, b) => b.minutes - a.minutes)
    const total = rows.reduce((sum, row) => sum + row.minutes, 0)
    return { rows, total }
  }, [data.sessions, data.chapters])
}

function SubjectTimeCard({ data }: { data: ReturnType<typeof useData>['data'] }) {
  const { rows, total } = SubjectTimeAllocation({ data })
  return <NotebookCard className="chart-card subject-time-card">
    <div className="chart-card-head"><div><span className="eyebrow"><T k="analytics:time-by-subject">{"TIME BY SUBJECT"}</T></span><h2>Where your hours went</h2><p>{rows.length ? `${fmtDuration(total)} across ${rows.length} subject${rows.length === 1 ? '' : 's'}` : 'No time logged yet.'}</p></div></div>
    {rows.length === 0 ? <NoDataLine label="Time by subject" hint="File focus sessions under a chapter to see this." /> : <>
      <div className="subject-time-bars">{rows.map(row => <div key={row.subject} className="subject-time-row">
        <span className="subject-time-name">{row.subject === 'Unfiled' ? 'Unfiled' : <SubjectBadge subject={row.subject as Subject} />}</span>
        <div className="subject-time-meter"><Meter value={total ? (row.minutes / total) * 100 : 0} label={`${row.subject} share of study time`} tone={row.subject === 'Unfiled' ? 'orange' : 'blue'} /></div>
        <b>{fmtDuration(row.minutes)}</b>
        <small>{total ? `${Math.round((row.minutes / total) * 100)}%` : '—'}</small>
      </div>)}</div>
      {rows.some(row => row.subject === 'Unfiled') && <p className="subject-time-note">Sessions without a chapter are counted as Unfiled. Pick a chapter in Focus to sort them.</p>}
    </>}
  </NotebookCard>
}

/**
 * Study time against marks, per subject: does more time actually move the score?
 * Points are the mean mark per subject; the x-axis is the hours recorded for it.
 */
function TimeVersusMarksCard({ data, subjects }: { data: ReturnType<typeof useData>['data']; subjects: ReturnType<typeof getSubjectPerformance> }) {
  const { rows } = SubjectTimeAllocation({ data })
  const points = rows.filter(row => row.subject !== 'Unfiled').map(row => ({
    subject: row.subject,
    hours: Math.round((row.minutes / 60) * 10) / 10,
    average: subjects.find(item => item.subject === row.subject)?.average ?? null
  })).filter(point => point.average !== null)
  return <NotebookCard className="chart-card time-marks-card">
    <div className="chart-card-head"><div><span className="eyebrow"><T k="analytics:hours-versus-marks">{"HOURS VS MARKS"}</T></span><h2>Does the time show up?</h2><p>Mean marks per subject against the hours recorded for it.</p></div></div>
    {points.length < 2 ? <NoDataLine label="Hours vs marks" hint="Needs at least two subjects with both time and test results." /> : <div className="time-marks-list">{points.sort((a, b) => (b.average ?? 0) - (a.average ?? 0)).map(point => <div key={point.subject} className="time-marks-row">
      <SubjectBadge subject={point.subject as Subject} />
      <span className="time-marks-avg">{Math.round(point.average ?? 0)}%</span>
      <span className="time-marks-hours">{point.hours}h logged</span>
    </div>)}</div>}
  </NotebookCard>
}

/**
 * Charts are canvas-like SVG with no accessible text, so each one gets a small table that
 * assistive tech reads instead. The table is visible only to screen readers.
 */
function ChartTable({ caption, rows }: { caption: string; rows: (string | number | null)[][] }) {
  if (rows.length < 2) return null
  const [head = [], ...body] = rows
  return <table className="visually-hidden chart-data-table">
    <caption>{caption}</caption>
    <thead><tr>{head.map((cell, index) => <th key={index} scope="col">{cell}</th>)}</tr></thead>
    <tbody>{body.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => cellIndex === 0 ? <th key={cellIndex} scope="row">{cell}</th> : <td key={cellIndex}>{cell ?? '—'}</td>)}</tr>)}</tbody>
  </table>
}

function NotebookTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; dataKey?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return <div className="chart-tooltip"><strong>{label ?? ''}</strong>{payload.filter(item => item.value != null).map(item => <span key={item.dataKey ?? item.name}><i style={{ background: item.color }} />{item.name}: {fmtNumber(item.value, 1)}{typeof item.value === 'number' && item.value >= 0 && item.value <= 100 && item.dataKey !== 'count' && item.dataKey !== 'hours' ? '%' : ''}</span>)}</div>
}

function CheckMarkSmall() { return <span className="mini-check" aria-hidden="true">✓</span> }
