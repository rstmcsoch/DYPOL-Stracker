import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, Bell, Clock3, ListChecks } from 'lucide-react'
import { NotebookCard } from '../ui'
import { Meter, Pct, minutesLabel } from './shared'
import { useData } from '../../contexts/DataContext'
import { indiaToday } from '../../lib/date'
import { aggregatePractice, pyqCompletion, syllabusProgress } from '../../lib/jee/progress'
import { currentExamMode, trackReadiness, TRACK_LABEL } from '../../lib/jee/exam'
import { PRIMARY_ACTIVITIES, studyMinutesByActivity, weekRange } from '../../lib/jee/study-time'
import { computeReminders, isAwake } from '../../lib/jee/reminders'
import type { ActivityMinutes } from '../../lib/jee/study-time'

/**
 * Dashboard strip that exposes the new study system without a wall of cards: today's
 * split, streak with its rule, raw vs weighted progress, PYQ and practice numbers, the
 * exam countdown for the active track, and any reminders that apply right now.
 */
export function HomeSnapshot() {
  const { data } = useData()
  const navigate = useNavigate()
  const today = indiaToday()
  const todayMinutes = useMemo(() => studyMinutesByActivity(data, today, today), [data, today])
  const week = useMemo(() => studyMinutesByActivity(data, weekRange(today).start, today), [data, today])
  const progress = useMemo(() => syllabusProgress(data.chapters, data.settings), [data.chapters, data.settings])
  const practice = useMemo(() => aggregatePractice(data.practiceSessions), [data.practiceSessions])
  const pyqMain = useMemo(() => pyqCompletion(data.pyqRecords, null, 'Main', data.settings), [data.pyqRecords, data.settings])
  const pyqAdv = useMemo(() => pyqCompletion(data.pyqRecords, null, 'Advanced', data.settings), [data.pyqRecords, data.settings])
  const backlogDue = data.backlogItems.filter(item => isAwake(item, today) && item.due_on !== null && item.due_on <= today).length
  const mode = currentExamMode(data, today)
  const track = trackReadiness(data, data.settings.active_track, today)
  const reminders = computeReminders(data, today)

  return <section className="jee-snapshot" aria-label="Study snapshot">
    <NotebookCard className="jee-snap-card jee-snap-study">
      <div className="jee-snap-head"><span className="eyebrow">TODAY</span><button type="button" className="jee-link" onClick={() => navigate('/focus')}>Focus <ArrowUpRight size={13} aria-hidden="true" /></button></div>
      <SplitRow minutes={todayMinutes} empty="Nothing recorded yet today" />
      <div className="jee-snap-head sub"><span className="eyebrow">THIS WEEK</span><small className="jee-muted">{minutesLabel(week.total)} total</small></div>
      <SplitRow minutes={week} compact />
    </NotebookCard>

    {/* Streak and the exam countdown live in the hero cards above; repeating the
        same numbers here was removed so every statistic renders exactly once. */}
    <NotebookCard className="jee-snap-card jee-snap-progress">
      <div className="jee-snap-head"><span className="eyebrow">SYLLABUS</span><button type="button" className="jee-link" onClick={() => navigate('/syllabus')}>Open <ArrowUpRight size={13} aria-hidden="true" /></button></div>
      <ProgressLine label="Raw completion" value={progress.raw} detail={`${progress.completedChapters}/${progress.totalChapters} chapters`} />
      <ProgressLine label="Weighted completion" value={progress.weighted} detail="by chapter importance" />
      <p className="jee-small jee-muted">Raw is the plain count. Weighted gives high-importance chapters more say; both stay visible.</p>
    </NotebookCard>

    <NotebookCard className="jee-snap-card jee-snap-practice">
      <div className="jee-snap-head"><span className="eyebrow">PRACTICE & PYQs</span><button type="button" className="jee-link" onClick={() => navigate('/practice')}>Log <ArrowUpRight size={13} aria-hidden="true" /></button></div>
      <div className="jee-mini-stats">
        <div><strong>{practice.attempted.toLocaleString('en-IN')}</strong><span>questions</span></div>
        <div><strong><Pct value={practice.accuracy} /></strong><span>accuracy</span></div>
        <div><strong><Pct value={pyqMain.percent} /></strong><span>JEE Main PYQs</span></div>
        <div><strong><Pct value={pyqAdv.percent} /></strong><span>Advanced PYQs</span></div>
      </div>
      <button type="button" className="jee-link" onClick={() => navigate('/backlog')}>Backlog due: <strong>{backlogDue}</strong> <ArrowUpRight size={13} aria-hidden="true" /></button>
    </NotebookCard>

    <NotebookCard className="jee-snap-card jee-snap-exam">
      <div className="jee-snap-head"><span className="eyebrow">{TRACK_LABEL[data.settings.active_track].toUpperCase()}</span><button type="button" className="jee-link" onClick={() => navigate('/settings')}>Exam dates <ArrowUpRight size={13} aria-hidden="true" /></button></div>
      <p className="jee-small">{mode.active ? mode.reason : 'Exam Mode turns on automatically in the final 30 days. The big countdown lives at the top of Home.'}</p>
      <ProgressLine label="Track readiness" value={track.percent} detail="weighted syllabus, PYQs and recent tests" />
    </NotebookCard>

    {reminders.length > 0 && <NotebookCard className="jee-snap-card jee-snap-reminders">
      <div className="jee-snap-head"><span className="eyebrow"><Bell size={13} aria-hidden="true" /> REMINDERS</span></div>
      <ul className="jee-reminder-list">{reminders.map(item => <li key={item.kind}><ListChecks size={14} aria-hidden="true" /><span><strong>{item.title}.</strong> {item.body}</span></li>)}</ul>
    </NotebookCard>}
  </section>
}

function SplitRow({ minutes, compact = false, empty }: { minutes: ActivityMinutes; compact?: boolean; empty?: string }) {
  if (minutes.total === 0 && empty) return <p className="jee-small jee-muted">{empty}</p>
  return <div className={`jee-split ${compact ? 'compact' : ''}`}>
    {PRIMARY_ACTIVITIES.map(activity => <div key={activity} className={`jee-split-item split-${activity.toLowerCase()}`}>
      <Clock3 size={12} aria-hidden="true" /><span>{activity}</span><strong>{minutesLabel(minutes[activity])}</strong>
    </div>)}
    {!compact && (minutes['Mock/Test'] > 0 || minutes['PYQ practice'] > 0) && <div className="jee-split-item other"><span>Mock/Test &amp; PYQ</span><strong>{minutesLabel(minutes['Mock/Test'] + minutes['PYQ practice'])}</strong></div>}
  </div>
}

function ProgressLine({ label, value, detail }: { label: string; value: number | null; detail?: string }) {
  return <div className="jee-progress-line">
    <div><span>{label}</span><strong><Pct value={value} /></strong></div>
    <Meter value={value} label={label} tone="blue" />
    {detail && <small className="jee-muted">{detail}</small>}
  </div>
}
