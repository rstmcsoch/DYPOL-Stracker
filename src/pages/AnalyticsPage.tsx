import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity, BarChart3, BookOpen, CircleHelp, Clock3, Pin, PinOff, Plus, Sparkles, Target
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, PolarAngleAxis, PolarGrid,
  Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import { Button, NotebookCard, PageHeader, ProgressBar, ProgressRing, StatusBadge, SubjectBadge } from '../components/ui'
import { WeeklyReportCard } from '../components/jee/WeeklyReportCard'
import { LearningPipelineCard } from '../components/jee/LearningPipelineCard'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import {
  getAccuracy, getAttemptRate, getChapterPerformance, getMarksTrend, getMistakeCounts,
  getNegativeMarkImpact, getOverallTestAverage, getOverallTestScore, getSubjectPerformance
} from '../lib/analytics'
import { prettyDate } from '../lib/date'
import { fmtDuration, fmtNumber } from '../lib/format'
import { makeStudyBars, makeStudyHeatmap } from '../lib/study-aggregation'
import type { Subject } from '../types'
import { SUBJECTS } from '../types'

const subjectColors: Record<Subject, string> = { Physics: 'var(--subject-physics)', Chemistry: 'var(--subject-chemistry)', Maths: 'var(--subject-maths)' }

/** Calendar ticks for the time-based trend axis, in the Indian format Stracker uses. */
function chartDate(value: number | string): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(`${String(value).slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(date)
}
function chartDateLong(value: number | string): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(`${String(value).slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(date)
}
const chartColors = { accent: 'var(--accent)', green: 'var(--green)', orange: 'var(--subject-maths)', red: 'var(--red)', muted: 'var(--muted)' }

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

export default function AnalyticsPage() {
  const { data } = useData()
  const { user } = useAuth()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [pinned, setPinned] = useState<ChartId[]>(() => loadPinned(user?.id ?? 'session'))

  useEffect(() => { savePinned(user?.id ?? 'session', pinned) }, [pinned, user?.id])

  const togglePin = (id: ChartId) => {
    setPinned(current => {
      if (current.includes(id)) return current.filter(item => item !== id)
      if (current.length >= PIN_LIMIT) {
        notify(`You can pin up to ${PIN_LIMIT} charts. Unpin one first — try the pin button on “${CHART_TITLES[current[0] ?? id]}”.`, 'error')
        return current
      }
      notify(`${CHART_TITLES[id]} pinned to your favourites.`)
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
  const hasTestScore = trends.some(row => row.overall !== null || row.Physics !== null || row.Chemistry !== null || row.Maths !== null)
  const hasSubjectScores = subjects.some(item => item.average !== null)
  const hasMistakes = mistakeCounts.some(item => item.count > 0)
  const hasSessions = data.sessions.some(session => session.duration_minutes > 0)
  const hasAttemptData = accuracy.rate !== null || attempt.rate !== null || negativeMetrics.totalNegativeMarks > 0 || data.sessions.length > 0

  const downloadChartCsv = () => {
    const rows = [['Date','Overall %','Physics %','Chemistry %','Maths %'], ...trends.map(item => [item.date, item.overall ?? '', item.Physics ?? '', item.Chemistry ?? '', item.Maths ?? ''])]
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n')
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'stracker-performance.csv'; link.click(); URL.revokeObjectURL(url)
    notify('Performance trend exported as CSV.')
  }

  const chartProps = { data, trends, subjects, mistakeCounts, heatmap, chapterRows, totalChapters, doneChapters, targetComparison, hasTestScore, hasSubjectScores, hasMistakes, hasSessions, accuracy, attempt, negativeMetrics, negativeImpact, onPin: togglePin, pinned }

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
    <PageHeader eyebrow="NOT A SCOREBOARD. A COMPASS." title="Analytics" subtitle="Real patterns from your real work. Nothing here is filled in for you." doodle={<Activity size={20} />} action={<Button variant="secondary" onClick={downloadChartCsv}><BarChart3 size={16} /> Export trend CSV</Button>} />
    <WeeklyReportCard />
    <LearningPipelineCard />
    <div className="analytics-kpi-grid"><NotebookCard className="analytics-kpi"><span><Activity size={15} /> TESTS LOGGED</span><strong>{data.tests.length}</strong><small>{overallAverage.count} with usable test results</small></NotebookCard><NotebookCard className="analytics-kpi"><span><BookOpen size={15} /> SYLLABUS</span><strong>{totalChapters ? `${doneChapters}/${totalChapters}` : '—'}</strong><small>{totalChapters ? `${Math.round(doneChapters / totalChapters * 100)}% chapters completed` : 'No chapters saved'}</small></NotebookCard><NotebookCard className="analytics-kpi"><span><Clock3 size={15} /> STUDY HOURS</span><strong>{fmtNumber(data.sessions.reduce((sum, session) => sum + session.duration_minutes, 0) / 60, 1)}</strong><small>{data.sessions.length} logged focus session{data.sessions.length === 1 ? '' : 's'}</small></NotebookCard><NotebookCard className="analytics-kpi"><span><Target size={15} /> TEST AVERAGE</span><strong>{averageScore === null ? '—' : `${Math.round(averageScore)}%`}</strong><small>{overallAverage.count ? `Mean of ${overallAverage.count} usable test result${overallAverage.count === 1 ? '' : 's'}; one test counts once` : 'Add a scored test to begin'}</small></NotebookCard></div>

    {data.tests.length === 0 && <SamplePreviewCard onAddTest={() => navigate('/tests?add=1')} />}

    {pinned.length > 0 && <section className="favourites-section" aria-label="Favourite charts">
      <div className="section-heading favourites-heading"><div><h2>Favourites</h2><p>Your pinned charts stay at the top. Pin or unpin from any chart’s header — up to {PIN_LIMIT}.</p></div><StatusBadge tone="muted">{pinned.length}/{PIN_LIMIT} pinned</StatusBadge></div>
      <div className="analytics-grid two-col favourites-grid">{pinned.map(id => renderCard(id, `fav-${id}`))}</div>
    </section>}

    {renderCard('performance')}

    <section className="section-heading analytics-section-title"><div><h2>How the attempts are landing</h2><p>Every calculation is based only on the fields you’ve filled in.</p></div></section>
    {hasAttemptData ? <div className="analytics-metric-grid">
      <NotebookCard className="metric-detail-card"><div className="metric-head"><span className="metric-icon green"><CheckMarkSmall /></span><span>ACCURACY</span></div><strong>{accuracy.rate === null ? '—' : `${Math.round(accuracy.rate)}%`}</strong><p>{accuracy.correct} correct / {accuracy.attempted || '—'} attempted</p><ProgressBar value={accuracy.rate ?? 0} color={chartColors.green} /></NotebookCard>
      <NotebookCard className="metric-detail-card"><div className="metric-head"><span className="metric-icon blue"><Activity size={16} /></span><span>ATTEMPT RATE</span></div><strong>{attempt.rate === null ? '—' : `${Math.round(attempt.rate)}%`}</strong><p>{attempt.attempted} attempted / {attempt.total || '—'} total questions</p><ProgressBar value={attempt.rate ?? 0} color={chartColors.accent} /></NotebookCard>
      <NotebookCard className="metric-detail-card"><div className="metric-head"><span className="metric-icon orange"><CircleHelp size={16} /></span><span>NEGATIVE MARKS</span></div><strong>{negativeMetrics.totalNegativeMarks > 0 || data.tests.some(test => test.negative_marks === 0) ? fmtNumber(negativeMetrics.totalNegativeMarks, 1) : '—'}</strong><p>{negativeImpact === null ? 'No test has both recorded negative marks and a usable total' : `${negativeImpact.toFixed(1)}% of totals from ${negativeMetrics.testsIncluded} comparable test${negativeMetrics.testsIncluded === 1 ? '' : 's'}`}</p>{negativeImpact !== null && <ProgressBar value={negativeImpact} color={chartColors.orange} />}</NotebookCard>
      <NotebookCard className="metric-detail-card"><div className="metric-head"><span className="metric-icon violet"><Clock3 size={16} /></span><span>STUDY TIME</span></div><strong>{fmtDuration(data.sessions.reduce((sum, session) => sum + session.duration_minutes, 0))}</strong><p>{data.sessions.filter(item => item.completion_state === 'completed').length} completed focus sessions</p><span className="metric-inline-note">No sessions? Start the timer in Focus mode.</span></NotebookCard>
    </div> : <NotebookCard className="chart-card chart-card-flat"><NoDataLine label="Attempt metrics" hint="Log correct/wrong counts with a test, or run a focus session." /></NotebookCard>}

    <div className="analytics-grid two-col analytics-lower-grid">
      {renderCard('mistakes')}
      {renderCard('study-hours')}
    </div>

    {renderCard('heatmap')}

    <div className="analytics-grid two-col analytics-final-grid">
      {renderCard('syllabus')}
      {renderCard('target')}
    </div>

    <div className="analytics-insight-row"><NotebookCard className="analytics-insight-card"><span className="insight-pencil">✎</span><div><span className="eyebrow">CHAPTER SIGNALS</span><p><strong>{chapterRows.filter(item => item.classification === 'Untested').length}</strong> untested · <strong>{chapterRows.filter(item => item.classification === 'Weak').length}</strong> weak · <strong>{chapterRows.filter(item => item.dropping).length}</strong> dropping</p></div><button onClick={() => navigate('/weak-areas')}>See weak areas ↗</button></NotebookCard></div>
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
      <span className="preview-chip"><Sparkles size={13} aria-hidden="true" /> EXAMPLE · NOT YOUR DATA</span>
      <span className="preview-eyebrow">WHAT 3 TESTS UNLOCK</span>
    </div>
    <div className="preview-body">
      <div className="preview-copy">
        <p>After <strong>3 tests</strong>, you’ll see your marks trend, subject balance, weak areas, and performance patterns here — built only from what you actually log.</p>
        <Button variant="secondary" size="sm" onClick={onAddTest}><Plus size={15} /> Log your first test</Button>
      </div>
      <div className="preview-illustration" aria-hidden="true">
        <svg viewBox="0 0 240 104" role="presentation">
          <polyline points="6,86 52,70 98,76 144,52 190,44 234,18" fill="none" stroke={chartColors.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="52" cy="70" r="3.5" fill={chartColors.accent} /><circle cx="98" cy="76" r="3.5" fill={chartColors.accent} /><circle cx="144" cy="52" r="3.5" fill={chartColors.accent} /><circle cx="190" cy="44" r="3.5" fill={chartColors.accent} />
          <rect x="10" y="58" width="16" height="40" rx="4" fill="var(--subject-physics)" opacity=".55" />
          <rect x="34" y="44" width="16" height="54" rx="4" fill="var(--subject-chemistry)" opacity=".55" />
          <rect x="58" y="66" width="16" height="32" rx="4" fill="var(--subject-maths)" opacity=".55" />
        </svg>
        <span className="preview-caption">Marks trend + subject balance</span>
      </div>
    </div>
  </NotebookCard>
}

/* ------------------------------------------------------------ chart cards */

function PerformanceCard({ data, subjects, hasTestScore, hasSubjectScores, pinned, onPin }: ChartCardProps) {
  const [range, setRange] = useState('90')
  const rangedTrends = useMemo(() => getMarksTrend(data, range === 'all' ? 5000 : Number(range)), [data, range])
  // The X-axis is a real time scale: each row carries its epoch so a 13-day gap
  // occupies 13 days of space and a 2-day gap occupies two.
  const timeTrends = useMemo(() => rangedTrends.map(row => ({ ...row, t: new Date(`${row.date}T12:00:00`).getTime() })), [rangedTrends])
  const nothingAtAll = !hasTestScore && !hasSubjectScores
  return <NotebookCard className={`chart-card performance-card ${nothingAtAll ? 'chart-card-flat' : ''}`}>
    <div className="chart-card-head">
      <div><span className="eyebrow">PERCENTAGE, NOT RAW MARKS</span><h2>{CHART_TITLES.performance}</h2><p>The trend of your comparable results, with the subject balance beside it.</p></div>
      <div className="chart-head-actions">
        {hasTestScore && <select value={range} onChange={event => setRange(event.target.value)} aria-label="Choose marks trend range"><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="180">Last 6 months</option><option value="all">All recorded tests</option></select>}
        <PinButton id="performance" pinned={pinned.includes('performance')} onPin={onPin} />
      </div>
    </div>
    {nothingAtAll ? <NoDataLine label="Marks & subjects" hint="Log a test with marks and a total to start the trend." /> : <>
      {hasTestScore ? <>
        <div className="chart-frame trend-chart"><ResponsiveContainer width="100%" height={280}><LineChart data={timeTrends} margin={{ top: 10, right: 14, left: -14, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5" /><XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={value => chartDate(Number(value))} tick={{ fill: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-body)' }} tickLine={false} axisLine={false} minTickGap={34} /><YAxis domain={[0, 100]} tick={{ fill: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-body)' }} tickLine={false} axisLine={false} tickFormatter={value => `${value}%`} /><Tooltip content={<NotebookTooltip />} labelFormatter={value => chartDateLong(Number(value))} /><Line type="monotone" dataKey="overall" name="Overall" stroke={chartColors.accent} strokeWidth={2.5} strokeDasharray="7 5" dot={{ r: 3.5, fill: chartColors.accent, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} /><Line type="monotone" dataKey="Physics" name="Physics" stroke={subjectColors.Physics} strokeWidth={2} dot={{ r: 3, fill: subjectColors.Physics, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} /><Line type="monotone" dataKey="Chemistry" name="Chemistry" stroke={subjectColors.Chemistry} strokeWidth={2} dot={{ r: 3, fill: subjectColors.Chemistry, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} /><Line type="monotone" dataKey="Maths" name="Maths" stroke={subjectColors.Maths} strokeWidth={2} dot={{ r: 3, fill: subjectColors.Maths, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} /></LineChart></ResponsiveContainer></div>
        <div className="chart-legend-note" role="list" aria-label="Trend series"><span role="listitem"><i className="swatch-dashed" style={{ background: `repeating-linear-gradient(90deg, ${chartColors.accent} 0 6px, transparent 6px 9px)` }} /> Overall</span>{SUBJECTS.map(subject => <span key={subject} role="listitem"><i style={{ background: subjectColors[subject] }} />{subject}</span>)}</div>
      </> : <NoDataLine label="Marks trend" hint="No comparable test result in this range yet." />}
      <div className="performance-subjects">
        {hasSubjectScores ? <>
          <div className="chart-frame radar-chart performance-radar"><ResponsiveContainer width="100%" height={230}><RadarChart data={subjects.map(item => ({ subject: item.subject, score: item.average ?? 0 }))} outerRadius="76%"><PolarGrid stroke="var(--chart-grid)" strokeWidth={1.2} /><PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--ink-soft)', fontSize: 13, fontFamily: 'var(--font-body)' }} /><Radar dataKey="score" name="Average %" stroke={chartColors.accent} strokeWidth={2.5} fill={chartColors.accent} fillOpacity={0.32} /><Tooltip content={<NotebookTooltip />} /></RadarChart></ResponsiveContainer></div>
          <div className="subject-performance-list performance-subject-list">{subjects.map(item => <div key={item.subject}><SubjectBadge subject={item.subject} /><strong>{item.average === null ? '—' : `${Math.round(item.average)}%`}</strong><small>{item.count} result{item.count === 1 ? '' : 's'}</small></div>)}</div>
        </> : <NoDataLine label="Subject balance" hint="Add scores to any subject test or mock to compare subjects." />}
      </div>
    </>}
  </NotebookCard>
}

function MistakeBreakdownCard({ mistakeCounts, hasMistakes, pinned, onPin }: ChartCardProps) {
  const navigate = useNavigate()
  return <NotebookCard className={`chart-card mistake-chart-card ${hasMistakes ? '' : 'chart-card-flat'}`}>
    <div className="chart-card-head"><div><span className="eyebrow">NOTICE THE REPEATS</span><h2>{CHART_TITLES.mistakes}</h2><p>Only entries saved in your notebook appear here.</p></div><div className="chart-head-actions"><button className="chart-link" onClick={() => navigate('/mistakes')}>Open notebook ↗</button><PinButton id="mistakes" pinned={pinned.includes('mistakes')} onPin={onPin} /></div></div>
    {hasMistakes ? <>
      <div className="chart-frame bar-chart"><ResponsiveContainer width="100%" height={245}><BarChart data={mistakeCounts} margin={{ top: 8, right: 6, left: -17, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5" /><XAxis dataKey="type" tick={{ fill: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-body)' }} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-body)' }} tickLine={false} axisLine={false} /><Tooltip content={<NotebookTooltip />} /><Bar dataKey="count" name="Mistakes" radius={[7, 7, 0, 0]}>{mistakeCounts.map((entry, index) => <Cell key={entry.type} fill={[chartColors.accent, chartColors.orange, chartColors.green, chartColors.red, chartColors.muted][index]} />)}</Bar></BarChart></ResponsiveContainer></div>
      <div className="mistake-count-list">{mistakeCounts.map(item => <span key={item.type}>{item.type}<strong>{item.count}</strong></span>)}</div>
    </> : <NoDataLine label="Mistake breakdown" hint="A few honest notes in the mistake notebook make this useful." />}
  </NotebookCard>
}

function StudyHoursCard({ data, hasSessions, pinned, onPin }: ChartCardProps) {
  const [hoursView, setHoursView] = useState<'day' | 'week' | 'month'>('day')
  const studyBars = useMemo(() => makeStudyBars(data.sessions, hoursView), [data.sessions, hoursView])
  return <NotebookCard className={`chart-card study-chart-card ${hasSessions ? '' : 'chart-card-flat'}`}>
    <div className="chart-card-head"><div><span className="eyebrow">SHOWING UP COUNTS</span><h2>{CHART_TITLES['study-hours']}</h2><p>Logged focus sessions only.</p></div><div className="chart-head-actions"><div className="segmented-control" role="group" aria-label="Study hours grouping">{(['day','week','month'] as const).map(item => <button className={hoursView === item ? 'active' : ''} key={item} onClick={() => setHoursView(item)}>{item}</button>)}</div><PinButton id="study-hours" pinned={pinned.includes('study-hours')} onPin={onPin} /></div></div>
    {hasSessions ? <div className="chart-frame bar-chart"><ResponsiveContainer width="100%" height={245}><BarChart data={studyBars} margin={{ top: 8, right: 7, left: -19, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5" /><XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-body)' }} tickLine={false} axisLine={false} minTickGap={14} /><YAxis tick={{ fill: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-body)' }} tickLine={false} axisLine={false} /><Tooltip content={<NotebookTooltip />} /><Bar dataKey="hours" name="Hours" fill={chartColors.green} radius={[7, 7, 0, 0]} /></BarChart></ResponsiveContainer></div> : <NoDataLine label="Study hours" hint="Run a focus session — the timer logs your study time." />}
  </NotebookCard>
}

function HeatmapCard({ heatmap, hasSessions, pinned, onPin }: ChartCardProps) {
  return <NotebookCard className={`heatmap-card ${hasSessions ? '' : 'chart-card-flat'}`}>
    <div className="chart-card-head"><div><span className="eyebrow">A CALENDAR OF SHOWING UP</span><h2>{CHART_TITLES.heatmap}</h2><p>Day intensity is compared with your current daily study goal.</p></div><div className="chart-head-actions"><div className="heatmap-legend"><span>Less</span>{['none','low','medium','high','goal'].map(level => <i key={level} className={`heat-cell heat-${level}`} title={level} />)}<span>Goal</span></div><PinButton id="heatmap" pinned={pinned.includes('heatmap')} onPin={onPin} /></div></div>
    {hasSessions ? <>
      <div className="heatmap-month-labels">{heatmap.months.map(item => <span key={item.key} style={{ gridColumn: item.column }}>{item.label}</span>)}</div>
      <div className="heatmap-grid" role="img" aria-label="Study activity heatmap for the last 16 weeks">{heatmap.cells.map(cell => <span key={cell.date} className={`heat-cell heat-${cell.level}`} title={cell.future ? `${prettyDate(cell.date)} · Upcoming` : `${prettyDate(cell.date)} · ${fmtDuration(cell.minutes)}`} aria-label={cell.future ? `${prettyDate(cell.date)}, upcoming` : `${prettyDate(cell.date)}, ${fmtDuration(cell.minutes)} studied`} />)}</div>
      <div className="heatmap-caption"><span>{heatmap.daysLogged} study day{heatmap.daysLogged === 1 ? '' : 's'} shown</span><span>Consistency over intensity.</span></div>
    </> : <NoDataLine label="Study-day rhythm" hint="Complete a focus block to light up your first day." />}
  </NotebookCard>
}

function SyllabusProgressCard({ data, totalChapters, doneChapters, pinned, onPin }: ChartCardProps) {
  return <NotebookCard className={`syllabus-analytics-card ${totalChapters ? '' : 'chart-card-flat'}`}>
    <div className="chart-card-head"><div><span className="eyebrow">CHAPTERS MOVING FORWARD</span><h2>{CHART_TITLES.syllabus}</h2><p>{doneChapters} done or revised of {totalChapters} recorded chapters.</p></div><div className="chart-head-actions"><ProgressRing value={totalChapters ? doneChapters / totalChapters * 100 : 0} size={72} label={<span className="ring-value small">{totalChapters ? Math.round(doneChapters / totalChapters * 100) : 0}<small>%</small></span>} /><PinButton id="syllabus" pinned={pinned.includes('syllabus')} onPin={onPin} /></div></div>
    {totalChapters ? <div className="subject-syllabus-list">{SUBJECTS.map(subject => { const chapters = data.chapters.filter(item => item.subject === subject); const done = chapters.filter(item => item.status === 'Done' || item.status === 'Revised').length; return <div key={subject}><div><SubjectBadge subject={subject} /><span>{done} / {chapters.length} chapters</span></div><ProgressBar value={chapters.length ? done / chapters.length * 100 : 0} color={subjectColors[subject]} /></div> })}</div> : <NoDataLine label="Syllabus progress" hint="Chapters appear here as soon as your syllabus has rows." />}
  </NotebookCard>
}

function MockTargetCard({ data, targetComparison, pinned, onPin }: ChartCardProps) {
  return <NotebookCard className={`target-score-card ${targetComparison ? '' : 'chart-card-flat'}`}>
    <div className="chart-card-head"><div><span className="eyebrow">A TARGET, NOT A VERDICT</span><h2>{CHART_TITLES.target}</h2><p>New mocks need all three subject scores; valid saved legacy totals remain comparable.</p></div><div className="chart-head-actions"><Target size={20} /><PinButton id="target" pinned={pinned.includes('target')} onPin={onPin} /></div></div>
    {targetComparison ? <div className="target-comparison"><div className={`target-result target-${targetComparison.state}`}><strong>{fmtNumber(targetComparison.score, 1)}</strong><span>latest mock marks</span></div><div className="target-arrow">{targetComparison.state === 'above' ? '↑' : targetComparison.state === 'near' ? '≈' : '↓'}</div><div className="target-goal"><strong>{fmtNumber(data.settings.target_score)}</strong><span>target score</span></div><StatusBadge tone={targetComparison.state === 'above' ? 'Strong' : targetComparison.state === 'near' ? 'Okay' : 'Weak'}>{targetComparison.state === 'above' ? 'Above target' : targetComparison.state === 'near' ? 'Near target' : 'Below target'} · {targetComparison.gap > 0 ? `${fmtNumber(targetComparison.gap, 1)} to go` : `${fmtNumber(Math.abs(targetComparison.gap), 1)} ahead`}</StatusBadge></div> : <NoDataLine label="Mock target" hint="Add all three subject scores on a full mock to compare it with your target." />}
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

function NotebookTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; dataKey?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return <div className="chart-tooltip"><strong>{label ?? ''}</strong>{payload.filter(item => item.value != null).map(item => <span key={item.dataKey ?? item.name}><i style={{ background: item.color }} />{item.name}: {fmtNumber(item.value, 1)}{typeof item.value === 'number' && item.value >= 0 && item.value <= 100 && item.dataKey !== 'count' && item.dataKey !== 'hours' ? '%' : ''}</span>)}</div>
}

function CheckMarkSmall() { return <span className="mini-check" aria-hidden="true">✓</span> }
