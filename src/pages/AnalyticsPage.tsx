import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import {
  Activity, BarChart3, BookOpen, CircleHelp, Clock3, Target, TrendingUp, TriangleAlert
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, PolarAngleAxis, PolarGrid,
  Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import { Button, EmptyState, NotebookCard, PageHeader, ProgressBar, ProgressRing, StatusBadge, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import {
  getAccuracy, getAttemptRate, getChapterPerformance, getMarksTrend, getMistakeCounts,
  getSubjectPerformance, testPercentage
} from '../lib/analytics'
import { prettyDate } from '../lib/date'
import { fmtDuration, fmtNumber } from '../lib/format'
import { makeStudyBars, makeStudyHeatmap } from '../lib/study-aggregation'
import type { Subject } from '../types'
import { SUBJECTS } from '../types'

const subjectColors: Record<Subject, string> = { Physics: 'var(--subject-physics)', Chemistry: 'var(--subject-chemistry)', Maths: 'var(--subject-maths)' }
const chartColors = { accent: '#526fa0', green: '#679579', orange: '#d18a47', red: '#be6861', muted: '#a9a08b' }

export default function AnalyticsPage() {
  const { data } = useData()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [range, setRange] = useState('90')
  const [hoursView, setHoursView] = useState<'day' | 'week' | 'month'>('day')
  const trends = useMemo(() => getMarksTrend(data, range === 'all' ? 5000 : Number(range)), [data, range])
  const subjects = useMemo(() => getSubjectPerformance(data), [data])
  const chapterRows = useMemo(() => getChapterPerformance(data), [data])
  const accuracy = getAccuracy(data)
  const attempt = getAttemptRate(data)
  const negativeTotal = data.tests.reduce((sum, test) => sum + (test.negative_marks ?? 0), 0)
  const totalMarksKnown = data.tests.reduce((sum, test) => {
    if (test.test_type === 'Full Mock') {
      const scores = data.testSubjectScores.filter(score => score.test_id === test.id)
      if (scores.length === SUBJECTS.length && scores.every(score => score.total_marks != null)) return sum + scores.reduce((n, score) => n + (score.total_marks ?? 0), 0)
      return sum + (test.total_marks ?? 0)
    }
    return sum + (test.total_marks ?? 0)
  }, 0)
  const negativeImpact = totalMarksKnown > 0 ? negativeTotal / totalMarksKnown * 100 : null
  const mistakeCounts = getMistakeCounts(data)
  const studyBars = useMemo(() => makeStudyBars(data.sessions, hoursView), [data.sessions, hoursView])
  const heatmap = useMemo(() => makeStudyHeatmap(data.sessions, data.settings.daily_study_goal_minutes), [data.sessions, data.settings.daily_study_goal_minutes])
  const totalChapters = data.chapters.length
  const doneChapters = data.chapters.filter(chapter => chapter.status === 'Done' || chapter.status === 'Revised').length
  const validTestScores = data.tests.map(testPercentage).filter((value): value is number => value !== null)
  const averageScore = validTestScores.length ? validTestScores.reduce((sum, value) => sum + value, 0) / validTestScores.length : null
  const targetComparison = useMemo(() => getTargetComparison(data), [data])
  const hasTestScore = trends.some(row => row.overall !== null || row.Physics !== null || row.Chemistry !== null || row.Maths !== null)
  const hasMistakes = mistakeCounts.some(item => item.count > 0)

  const downloadChartCsv = () => {
    const rows = [['Date','Overall %','Physics %','Chemistry %','Maths %'], ...trends.map(item => [item.date, item.overall ?? '', item.Physics ?? '', item.Chemistry ?? '', item.Maths ?? ''])]
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n')
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'stracker-performance.csv'; link.click(); URL.revokeObjectURL(url)
    notify('Performance trend exported as CSV.')
  }

  return <div className="content-page analytics-page">
    <PageHeader eyebrow="NOT A SCOREBOARD. A COMPASS." title="Analytics" subtitle="Real patterns from your real work. Nothing here is filled in for you." doodle={<Activity size={20} />} action={<Button variant="secondary" onClick={downloadChartCsv}><BarChart3 size={16} /> Export trend CSV</Button>} />
    <div className="analytics-kpi-grid"><NotebookCard className="analytics-kpi"><span><Activity size={15} /> TESTS LOGGED</span><strong>{data.tests.length}</strong><small>{validTestScores.length} with usable total scores</small></NotebookCard><NotebookCard className="analytics-kpi"><span><BookOpen size={15} /> SYLLABUS</span><strong>{totalChapters ? `${doneChapters}/${totalChapters}` : '—'}</strong><small>{totalChapters ? `${Math.round(doneChapters / totalChapters * 100)}% chapters completed` : 'No chapters saved'}</small></NotebookCard><NotebookCard className="analytics-kpi"><span><Clock3 size={15} /> STUDY HOURS</span><strong>{fmtNumber(data.sessions.reduce((sum, session) => sum + session.duration_minutes, 0) / 60, 1)}</strong><small>{data.sessions.length} logged focus session{data.sessions.length === 1 ? '' : 's'}</small></NotebookCard><NotebookCard className="analytics-kpi"><span><Target size={15} /> TEST AVERAGE</span><strong>{averageScore === null ? '—' : `${Math.round(averageScore)}%`}</strong><small>{validTestScores.length ? `${validTestScores.length} usable result${validTestScores.length === 1 ? '' : 's'}` : 'Add a scored test to begin'}</small></NotebookCard></div>

    <div className="analytics-grid two-col">
      <NotebookCard className="chart-card marks-trend-card"><div className="chart-card-head"><div><span className="eyebrow">PERCENTAGE, NOT RAW MARKS</span><h2>Marks trend</h2><p>Tests with actual totals, shown in the same scale.</p></div><select value={range} onChange={event => setRange(event.target.value)} aria-label="Choose marks trend range"><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="180">Last 6 months</option><option value="all">All recorded tests</option></select></div>
        {hasTestScore ? <div className="chart-frame trend-chart"><ResponsiveContainer width="100%" height={280}><LineChart data={trends} margin={{ top: 10, right: 14, left: -14, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5" /><XAxis dataKey="date" tickFormatter={value => format(parseISO(`${value}T12:00:00`), 'd MMM')} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={28} /><YAxis domain={[0, 100]} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={value => `${value}%`} /><Tooltip content={<NotebookTooltip />} /><Legend wrapperStyle={{ fontSize: 12, paddingTop: 14 }} /><Line type="monotone" dataKey="overall" name="Overall" stroke={chartColors.accent} strokeWidth={3} dot={{ r: 3, fill: chartColors.accent }} activeDot={{ r: 5 }} connectNulls={false} /><Line type="monotone" dataKey="Physics" stroke={subjectColors.Physics} strokeWidth={2} dot={false} connectNulls={false} /><Line type="monotone" dataKey="Chemistry" stroke={subjectColors.Chemistry} strokeWidth={2} dot={false} connectNulls={false} /><Line type="monotone" dataKey="Maths" stroke={subjectColors.Maths} strokeWidth={2} dot={false} connectNulls={false} /></LineChart></ResponsiveContainer></div> : <EmptyState icon={<TrendingUp size={23} />} title="Your first score starts the line." description="Log a test with marks and total to build a useful trend." />}
        <div className="chart-legend-note"><span><i style={{ background: chartColors.accent }} /> Overall</span>{SUBJECTS.map(subject => <span key={subject}><i style={{ background: subjectColors[subject] }} />{subject}</span>)}</div>
      </NotebookCard>
      <NotebookCard className="chart-card subject-radar-card"><div className="chart-card-head"><div><span className="eyebrow">THREE SUBJECTS, ONE VIEW</span><h2>Subject balance</h2><p>Average percentage where scores are recorded.</p></div></div>
        {subjects.some(item => item.average !== null) ? <><div className="chart-frame radar-chart"><ResponsiveContainer width="100%" height={260}><RadarChart data={subjects.map(item => ({ subject: item.subject, score: item.average ?? 0 }))} outerRadius="76%"><PolarGrid stroke="var(--chart-grid)" /><PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--ink-soft)', fontSize: 12, fontFamily: 'var(--font-heading)' }} /><Radar dataKey="score" name="Average %" stroke={chartColors.accent} fill={chartColors.accent} fillOpacity={0.21} /><Tooltip content={<NotebookTooltip />} /></RadarChart></ResponsiveContainer></div><div className="subject-performance-list">{subjects.map(item => <div key={item.subject}><SubjectBadge subject={item.subject} /><strong>{item.average === null ? '—' : `${Math.round(item.average)}%`}</strong><small>{item.count} result{item.count === 1 ? '' : 's'}</small></div>)}</div></> : <EmptyState icon={<Target size={23} />} title="No subject scores to compare." description="Add scores to any subject test or mock to draw a balanced picture." />}
      </NotebookCard>
    </div>

    <section className="section-heading analytics-section-title"><div><h2>How the attempts are landing</h2><p>Every calculation is based only on the fields you’ve filled in.</p></div></section>
    <div className="analytics-metric-grid">
      <NotebookCard className="metric-detail-card"><div className="metric-head"><span className="metric-icon green"><CheckMarkSmall /></span><span>ACCURACY</span></div><strong>{accuracy.rate === null ? '—' : `${Math.round(accuracy.rate)}%`}</strong><p>{accuracy.correct} correct / {accuracy.attempted || '—'} attempted</p><ProgressBar value={accuracy.rate ?? 0} color={chartColors.green} /></NotebookCard>
      <NotebookCard className="metric-detail-card"><div className="metric-head"><span className="metric-icon blue"><Activity size={16} /></span><span>ATTEMPT RATE</span></div><strong>{attempt.rate === null ? '—' : `${Math.round(attempt.rate)}%`}</strong><p>{attempt.attempted} attempted / {attempt.total || '—'} total questions</p><ProgressBar value={attempt.rate ?? 0} color={chartColors.accent} /></NotebookCard>
      <NotebookCard className="metric-detail-card"><div className="metric-head"><span className="metric-icon orange"><TriangleAlert size={16} /></span><span>NEGATIVE MARKS</span></div><strong>{data.tests.some(test => test.negative_marks !== null) ? fmtNumber(negativeTotal, 1) : '—'}</strong><p>{negativeImpact === null ? 'No comparable test total available' : `${negativeImpact.toFixed(1)}% of recorded total marks`}</p>{negativeImpact !== null && <ProgressBar value={negativeImpact} color={chartColors.orange} />}</NotebookCard>
      <NotebookCard className="metric-detail-card"><div className="metric-head"><span className="metric-icon violet"><Clock3 size={16} /></span><span>STUDY TIME</span></div><strong>{fmtDuration(data.sessions.reduce((sum, session) => sum + session.duration_minutes, 0))}</strong><p>{data.sessions.filter(item => item.completion_state === 'completed').length} completed focus sessions</p><span className="metric-inline-note">No sessions? Start the timer in Focus mode.</span></NotebookCard>
    </div>

    <div className="analytics-grid two-col analytics-lower-grid">
      <NotebookCard className="chart-card mistake-chart-card"><div className="chart-card-head"><div><span className="eyebrow">NOTICE THE REPEATS</span><h2>Mistake breakdown</h2><p>Only entries saved in your notebook appear here.</p></div><button className="chart-link" onClick={() => navigate('/mistakes')}>Open notebook ↗</button></div>
        {hasMistakes ? <div className="chart-frame bar-chart"><ResponsiveContainer width="100%" height={245}><BarChart data={mistakeCounts} margin={{ top: 8, right: 6, left: -17, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5" /><XAxis dataKey="type" tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} /><Tooltip content={<NotebookTooltip />} /><Bar dataKey="count" name="Mistakes" radius={[7, 7, 0, 0]}>{mistakeCounts.map((entry, index) => <Cell key={entry.type} fill={[chartColors.accent, chartColors.orange, chartColors.green, chartColors.red, chartColors.muted][index]} />)}</Bar></BarChart></ResponsiveContainer></div> : <EmptyState icon={<CircleHelp size={23} />} title="No mistake entries yet." description="A few honest notes will make this breakdown useful." />}
        <div className="mistake-count-list">{mistakeCounts.map(item => <span key={item.type}>{item.type}<strong>{item.count}</strong></span>)}</div>
      </NotebookCard>
      <NotebookCard className="chart-card study-chart-card"><div className="chart-card-head"><div><span className="eyebrow">SHOWING UP COUNTS</span><h2>Study hours</h2><p>Logged focus sessions only.</p></div><div className="segmented-control" role="group" aria-label="Study hours grouping">{(['day','week','month'] as const).map(item => <button className={hoursView === item ? 'active' : ''} key={item} onClick={() => setHoursView(item)}>{item}</button>)}</div></div>
        {studyBars.some(item => item.hours > 0) ? <div className="chart-frame bar-chart"><ResponsiveContainer width="100%" height={245}><BarChart data={studyBars} margin={{ top: 8, right: 7, left: -19, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5" /><XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={14} /><YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} /><Tooltip content={<NotebookTooltip />} /><Bar dataKey="hours" name="Hours" fill={chartColors.green} radius={[7, 7, 0, 0]} /></BarChart></ResponsiveContainer></div> : <EmptyState icon={<Clock3 size={23} />} title="No focus hours recorded." description="Use the focus timer to start a real study-hours log." />}
      </NotebookCard>
    </div>

    <NotebookCard className="heatmap-card"><div className="chart-card-head"><div><span className="eyebrow">A CALENDAR OF SHOWING UP</span><h2>Study-day rhythm</h2><p>Day intensity is compared with your current daily study goal.</p></div><div className="heatmap-legend"><span>Less</span>{['none','low','medium','high','goal'].map(level => <i key={level} className={`heat-cell heat-${level}`} title={level} />)}<span>Goal</span></div></div>
      <div className="heatmap-month-labels">{heatmap.months.map(item => <span key={item.key} style={{ gridColumn: item.column }}>{item.label}</span>)}</div><div className="heatmap-grid" role="img" aria-label="Study activity heatmap for the last 16 weeks">{heatmap.cells.map(cell => <span key={cell.date} className={`heat-cell heat-${cell.level}`} title={cell.future ? `${prettyDate(cell.date)} · Upcoming` : `${prettyDate(cell.date)} · ${fmtDuration(cell.minutes)}`} aria-label={cell.future ? `${prettyDate(cell.date)}, upcoming` : `${prettyDate(cell.date)}, ${fmtDuration(cell.minutes)} studied`} />)}</div>
      <div className="heatmap-caption"><span>{heatmap.daysLogged} study day{heatmap.daysLogged === 1 ? '' : 's'} shown</span><span>Consistency over intensity.</span></div>
    </NotebookCard>

    <div className="analytics-grid two-col analytics-final-grid">
      <NotebookCard className="syllabus-analytics-card"><div className="chart-card-head"><div><span className="eyebrow">CHAPTERS MOVING FORWARD</span><h2>Syllabus progress</h2><p>{doneChapters} done or revised of {totalChapters} recorded chapters.</p></div><ProgressRing value={totalChapters ? doneChapters / totalChapters * 100 : 0} size={72} label={<span className="ring-value small">{totalChapters ? Math.round(doneChapters / totalChapters * 100) : 0}<small>%</small></span>} /></div><div className="subject-syllabus-list">{SUBJECTS.map(subject => { const chapters = data.chapters.filter(item => item.subject === subject); const done = chapters.filter(item => item.status === 'Done' || item.status === 'Revised').length; return <div key={subject}><div><SubjectBadge subject={subject} /><span>{done} / {chapters.length} chapters</span></div><ProgressBar value={chapters.length ? done / chapters.length * 100 : 0} color={subjectColors[subject]} /></div> })}</div></NotebookCard>
      <NotebookCard className="target-score-card"><div className="chart-card-head"><div><span className="eyebrow">A TARGET, NOT A VERDICT</span><h2>Mock target</h2><p>Compared only when a mock has all three subject totals.</p></div><Target size={20} /></div>
        {targetComparison ? <div className="target-comparison"><div className={`target-result target-${targetComparison.state}`}><strong>{fmtNumber(targetComparison.score, 1)}</strong><span>latest mock marks</span></div><div className="target-arrow">{targetComparison.state === 'above' ? '↑' : targetComparison.state === 'near' ? '≈' : '↓'}</div><div className="target-goal"><strong>{fmtNumber(data.settings.target_score)}</strong><span>target score</span></div><StatusBadge tone={targetComparison.state === 'above' ? 'Strong' : targetComparison.state === 'near' ? 'Okay' : 'Weak'}>{targetComparison.state === 'above' ? 'Above target' : targetComparison.state === 'near' ? 'Near target' : 'Below target'} · {targetComparison.gap > 0 ? `${fmtNumber(targetComparison.gap, 1)} to go` : `${fmtNumber(Math.abs(targetComparison.gap), 1)} ahead`}</StatusBadge></div> : <EmptyState icon={<Target size={22} />} title="No comparable full mock yet." description="Add Physics, Chemistry and Maths marks and totals for one mock, then set a target in Settings." />}
      </NotebookCard>
    </div>

    <div className="analytics-insight-row"><NotebookCard className="analytics-insight-card"><span className="insight-pencil">✎</span><div><span className="eyebrow">CHAPTER SIGNALS</span><p><strong>{chapterRows.filter(item => item.classification === 'Untested').length}</strong> untested · <strong>{chapterRows.filter(item => item.classification === 'Weak').length}</strong> weak · <strong>{chapterRows.filter(item => item.dropping).length}</strong> dropping</p></div><button onClick={() => navigate('/weak-areas')}>See weak areas ↗</button></NotebookCard></div>
  </div>
}

function getTargetComparison(data: ReturnType<typeof useData>['data']): { score: number; gap: number; state: 'below' | 'near' | 'above' } | null {
  const mocks = data.tests.filter(test => test.test_type === 'Full Mock').sort((a, b) => b.test_date.localeCompare(a.test_date))
  for (const test of mocks) {
    const scores = data.testSubjectScores.filter(score => score.test_id === test.id)
    if (scores.length !== 3 || !SUBJECTS.every(subject => scores.some(score => score.subject === subject && score.marks_obtained != null && score.total_marks != null && score.total_marks > 0))) continue
    const score = scores.reduce((sum, item) => sum + (item.marks_obtained ?? 0), 0)
    const gap = data.settings.target_score - score
    const tolerance = Math.max(1, data.settings.target_score * 0.05)
    return { score, gap, state: gap <= 0 ? 'above' : gap <= tolerance ? 'near' : 'below' }
  }
  return null
}

function NotebookTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; dataKey?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return <div className="chart-tooltip"><strong>{label ?? ''}</strong>{payload.filter(item => item.value != null).map(item => <span key={item.dataKey ?? item.name}><i style={{ background: item.color }} />{item.name}: {fmtNumber(item.value, 1)}{typeof item.value === 'number' && item.value >= 0 && item.value <= 100 && item.dataKey !== 'count' && item.dataKey !== 'hours' ? '%' : ''}</span>)}</div>
}

function CheckMarkSmall() { return <span className="mini-check" aria-hidden="true">✓</span> }
