import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, Bell, Clock3, ListChecks } from 'lucide-react'
import { NotebookCard } from '../ui'
import { Meter, Pct, minutesLabel } from './shared'
import { useData } from '../../contexts/DataContext'
import { indiaToday } from '../../lib/date'
import { aggregatePractice, pyqCompletion, pyqProgressCounts } from '../../lib/jee/progress'
import { backlogDueCounts, computeReminders } from '../../lib/jee/reminders'
import { weekRange } from '../../lib/jee/study-time'
import { isJeeSettings } from '../../lib/jee/exam'
import type { ReactNode } from 'react'
import { T } from '../../lib/student-layout/T'

/**
 * One compact strip under the daily cards: the week's numbers and any reminders that apply
 * right now.
 *
 * This replaced a five-card grid that repeated the countdown, chapters covered, streak,
 * study minutes and track readiness that the hero, the study-time card and Study-now already
 * show. One statistic now appears once. What survives is what nothing else on the page says:
 * the weekly total, how many PYQ chapter-years are done, what is due in the backlog, and the
 * reminders. Everything links to the page that owns the detail.
 */
export function HomeSnapshot({ layoutAttrs, children }: { layoutAttrs?: Record<string, string>; children?: ReactNode } = {}) {
  const { data } = useData()
  const navigate = useNavigate()
  const today = indiaToday()
  const jee = isJeeSettings(data.settings)
  const week = useMemo(() => weekRange(today), [today])
  const weekMinutes = useMemo(() => data.sessions
    .filter(session => {
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(session.started_at))
      return day >= week.start && day <= today
    })
    .reduce((sum, session) => sum + session.duration_minutes, 0), [data.sessions, week.start, today])
  const practice = useMemo(() => aggregatePractice(data.practiceSessions), [data.practiceSessions])
  const pyqCounts = useMemo(() => pyqProgressCounts(data), [data])
  const pyqMain = useMemo(() => pyqCompletion(data.pyqRecords, null, 'Main', data.settings), [data.pyqRecords, data.settings])
  const backlog = useMemo(() => backlogDueCounts(data.backlogItems, today), [data.backlogItems, today])
  const reminders = computeReminders(data, today)

  return <section className="jee-snapshot jee-snapshot-line" aria-label="This week at a glance" {...layoutAttrs}>
    <NotebookCard className="jee-snap-card jee-snap-week">
      <div className="jee-snap-head"><span className="eyebrow"><T k="home:this-week">{"THIS WEEK"}</T></span><button type="button" className="jee-link" onClick={() => navigate('/analytics')}><T k="home:open">{"Open"}</T>{' '}<ArrowUpRight size={13} aria-hidden="true" /></button></div>
      <div className="jee-week-facts">
        <div><Clock3 size={13} aria-hidden="true" /><strong>{minutesLabel(weekMinutes)}</strong><span>studied</span></div>
        <div><strong>{practice.attempted.toLocaleString('en-IN')}</strong><span>questions</span><small><Pct value={practice.accuracy} /> accuracy</small></div>
        {jee && <div><strong><Pct value={pyqMain.percent} /></strong><span>Main PYQs</span></div>}
        <div><strong>{pyqCounts.doneYears.toLocaleString('en-IN')}</strong><span>PYQ chapter-years</span></div>
        <button type="button" className="jee-week-backlog" onClick={() => navigate('/backlog')}><ListChecks size={13} aria-hidden="true" /> Backlog: <strong>{backlog.dueNow}</strong> due now · <strong>{backlog.dueTomorrow}</strong> tomorrow</button>
      </div>
      <Meter value={practice.accuracy} label="Practice accuracy" tone="blue" />
    </NotebookCard>

    {children}
    {reminders.length > 0 && <NotebookCard className="jee-snap-card jee-snap-reminders">
      <div className="jee-snap-head"><span className="eyebrow"><Bell size={13} aria-hidden="true" />{' '}<T k="home:reminders">{"REMINDERS"}</T></span></div>
      <ul className="jee-reminder-list">{reminders.map(item => <li key={item.kind}><ListChecks size={14} aria-hidden="true" /><span><strong>{item.title}.</strong> {item.body}</span></li>)}</ul>
    </NotebookCard>}
  </section>
}
