import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, CalendarDays, Check, Clock3, Pause, Play, Plus, Timer } from 'lucide-react'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import { Button, NotebookCard, ProgressBar, SectionHeading, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { useFocus } from '../contexts/FocusContext'
import { getSmartTip, getTodayStudyMinutes } from '../lib/analytics'
import { computeStreaks, studyMinutesByActivity, weekRange, PRIMARY_ACTIVITIES } from '../lib/jee/study-time'
import { currentExamMode, daysUntilExam, trackConfig, trackExamDate, trackReadiness, TRACK_LABEL, TRACK_PYQ_EXAM } from '../lib/jee/exam'
import { aggregatePractice, pyqCompletion, syllabusProgress } from '../lib/jee/progress'
import { recommendStudyNow, type Recommendation } from '../lib/jee/recommend'
import { computeReminders, isAwake } from '../lib/jee/reminders'
import { fmtDuration } from '../lib/format'
import { indiaToday, prettyDate } from '../lib/date'
import { completeRevision as completeRevisionAction } from '../lib/revision-actions'
import { Pct } from '../components/jee/shared'
import { TRACK_IDS } from '../types'
import type { DailyTask, Priority, ReminderKind, Revision } from '../types'

const GENERIC_TIP = 'Your study data is up to date. Keep logging tests and focus sessions to make your next insight more useful.'
const PRIORITY_RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 }
const REMINDER_TO: Record<ReminderKind, string> = {
  revision: '/revision', backlog: '/backlog', practice: '/practice', pyq: '/pyqs', mock: '/tests?add=1', plan: '/planner?add=1'
}

export default function HomePage() {
  const { data, upsert, upsertMany } = useData()
  const { notify } = useToast()
  const focus = useFocus()
  const navigate = useNavigate()
  const [reordering, setReordering] = useState(false)
  const [showWhy, setShowWhy] = useState(false)
  const today = indiaToday()
  const todayTasks = useMemo(() => data.tasks.filter(task => task.task_date === today).sort((a, b) => a.position - b.position), [data.tasks, today])
  const doneTasks = todayTasks.filter(task => task.is_completed).length
  const openTasks = todayTasks.filter(task => !task.is_completed)
  const dayRevisions = data.revisions.filter(revision => !revision.completed_at && revision.due_on <= today).sort((a, b) => a.due_on.localeCompare(b.due_on))
  const todayMinutes = getTodayStudyMinutes(data)
  const streak = computeStreaks(data, today)
  const examMode = currentExamMode(data, today)
  const goal = data.settings.daily_study_goal_minutes
  const goalProgress = goal > 0 ? Math.min(100, todayMinutes / goal * 100) : 0
  const practice = useMemo(() => aggregatePractice(data.practiceSessions), [data.practiceSessions])
  const progress = useMemo(() => syllabusProgress(data.chapters, data.settings), [data.chapters, data.settings])
  const studyNow = useMemo(() => recommendStudyNow(data, today), [data, today])
  const reminders = useMemo(() => computeReminders(data, today), [data, today])
  const week = useMemo(() => studyMinutesByActivity(data, weekRange(today).start, today), [data, today])
  const backlogDue = data.backlogItems.filter(item => isAwake(item, today) && item.due_on !== null && item.due_on <= today).length
  const activeTrack = trackReadiness(data, data.settings.active_track, today)
  const pyqExam = TRACK_PYQ_EXAM[data.settings.active_track]
  const pyq = useMemo(() => pyqExam ? pyqCompletion(data.pyqRecords, null, pyqExam, data.settings) : null, [data.pyqRecords, data.settings, pyqExam])
  const showReadiness = activeTrack.percent !== null && (progress.totalChapters > 0 || data.tests.length > 0 || data.pyqRecords.length > 0)
  const showPyq = Boolean(pyq && pyq.total > 0 && pyqExam && data.pyqRecords.some(record => record.exam === pyqExam))
  const insightReminder = reminders.find(item => item.kind !== 'plan' && item.kind !== 'practice' && !(item.kind === 'mock' && item.body.startsWith('No test'))) ?? null
  const tip = getSmartTip(data)
  const name = data.settings.owner_name || data.profile?.display_name || 'future engineer'
  const examDays = daysUntil(data.settings.advanced_exam_date)
  const mainDays = daysUntil(data.settings.main_exam_date)
  // Prefer Advanced when it has a date. If only Main is set, Main is the countdown.
  const primaryExam = examDays !== null
    ? { label: 'JEE Advanced', days: examDays, date: data.settings.advanced_exam_date, track: 'advanced' as const }
    : mainDays !== null
      ? { label: 'JEE Main', days: mainDays, date: data.settings.main_exam_date, track: 'main1' as const }
      : null
  const otherExams = TRACK_IDS.flatMap(track => {
    if (primaryExam?.track === track) return []
    const config = trackConfig(data, track)
    if (!config.enabled) return []
    const date = trackExamDate(data, track)
    if (!date) return []
    return [{ track, label: config.label || TRACK_LABEL[track], date, days: daysUntilExam(date, today) }]
  })

  const toggleTask = async (task: DailyTask) => {
    try {
      await upsert('daily_tasks', { ...task, is_completed: !task.is_completed, updated_at: new Date().toISOString() })
      if (!task.is_completed) notify('Nice work — one less thing on the list.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update task. Retry.', 'error') }
  }

  const moveTask = async (index: number, direction: -1 | 1) => {
    if (reordering) return
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= todayTasks.length) return
    const first = todayTasks[index]
    const second = todayTasks[nextIndex]
    if (!first || !second) return
    setReordering(true)
    const firstPosition = first.position
    try {
      await upsertMany('daily_tasks', [
        { ...first, position: second.position, updated_at: new Date().toISOString() },
        { ...second, position: firstPosition, updated_at: new Date().toISOString() }
      ])
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not reorder tasks.', 'error') }
    finally { setReordering(false) }
  }

  const markRevision = async (revision: Revision) => {
    const chapter = data.chapters.find(item => item.id === revision.chapter_id)
    try {
      const completed = await completeRevisionAction(
        revision, chapter,
        records => upsertMany('chapter_revisions', records),
        record => upsert('chapters', record),
        { revisions: data.revisions, gaps: data.settings.revision_gaps, today }
      )
      if (completed) notify('Revision marked complete. Well remembered.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not mark revision complete.', 'error') }
  }

  const nextTask = [...openTasks].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.position - b.position)[0]
  const blockSeconds = focus.focusMinutes * 60
  const sessionLive = focus.running || focus.finished || focus.elapsedSeconds > 0 || focus.remainingSeconds < blockSeconds
  const primaryAction = sessionLive
    ? { label: 'Open focus session', run: () => navigate('/focus') }
    : nextTask
      ? { label: 'Continue today’s task', run: () => { focus.setTask(nextTask.id); navigate('/focus') } }
      : dayRevisions.length
        ? { label: 'Open revisions', run: () => navigate('/revision') }
        : todayTasks.length === 0
          ? { label: 'Add a task', run: () => navigate('/planner?add=1') }
          : !data.practiceSessions.some(session => session.practice_date === today)
            ? { label: 'Log practice', run: () => navigate('/practice') }
            : { label: 'Start focus session', run: () => navigate('/focus') }
  const statusLine = focus.running
    ? 'A focus block is running.'
    : openTasks.length
      ? `${openTasks.length} task${openTasks.length === 1 ? '' : 's'} left today.`
      : dayRevisions.length
        ? `${dayRevisions.length} revision${dayRevisions.length === 1 ? '' : 's'} due.`
        : todayTasks.length
          ? 'Today’s list is finished.'
          : 'Nothing is planned yet.'

  return <div className="dashboard-page">
    <header className="dash-greeting">
      <div>
        <p className="eyebrow">{new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date())}</p>
        <h1>Good {getGreeting()}, {name}.</h1>
        <p className="dash-status">{statusLine}</p>
      </div>
      <Button onClick={primaryAction.run}>{primaryAction.label} <ArrowRight size={16} /></Button>
    </header>

    <section className="dash-strip" aria-label="Today at a glance">
      <div className="dash-metric">
        <span className="type-overline">Tasks</span>
        <strong className="type-metric">{doneTasks}<small>/{todayTasks.length}</small></strong>
        <span className="type-caption">done today</span>
      </div>
      <div className="dash-metric">
        <span className="type-overline">Practice</span>
        <strong className="type-metric">{practice.attempted > 0 ? practice.attempted.toLocaleString('en-IN') : '—'}</strong>
        <span className="type-caption">{practice.accuracy === null ? 'No questions yet' : `${Math.round(practice.accuracy)}% accuracy`}</span>
      </div>
      <div className="dash-metric" title={streak.rule}>
        <span className="type-overline">Streak</span>
        <strong className="type-metric">{streak.current}<small>{streak.current === 1 ? ' day' : ' days'}</small></strong>
        <span className="streak-subtitle">current study streak</span>
        <span className="type-caption"><strong>{streak.longest}</strong> longest</span>
      </div>
      <div className="dash-metric">
        <span className="type-overline">This week</span>
        <strong className="type-metric">{streak.weeklyConsistency}<small>/7</small></strong>
        <span className="type-caption">active days</span>
      </div>
    </section>

    <div className="dashboard-grid">
      <section className="today-plan-block" aria-label="Today's plan">
        <SectionHeading title="Today's plan" note={`${doneTasks} of ${todayTasks.length} done`} action={<Button variant="secondary" size="sm" onClick={() => navigate('/planner?add=1')}><Plus size={16} /> Add task</Button>} />
        <NotebookCard className="today-plan-card">
          <div className="plan-card-top"><span className="plan-date"><CalendarDays size={14} /> {prettyDate(today, { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>
          {todayTasks.length === 0
            ? <div className="dash-empty"><p>Add one clear task and today has a start.</p><Button variant="secondary" size="sm" onClick={() => navigate('/planner?add=1')}><Plus size={15} /> Add a task</Button></div>
            : <div className="task-list">
              {todayTasks.map((task, index) => {
                const chapter = data.chapters.find(item => item.id === task.chapter_id)
                return <div key={task.id} className={`task-row ${task.is_completed ? 'task-done' : ''}`}>
                  <button className="task-check" onClick={() => void toggleTask(task)} aria-label={task.is_completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`} aria-pressed={task.is_completed}><Check size={14} /></button>
                  <div className="task-row-copy"><strong>{task.title}</strong><div className="task-meta">{task.subject && <SubjectBadge subject={task.subject} />}{chapter && <span>{chapter.name}</span>}<span><Clock3 size={12} /> {fmtDuration(task.estimated_minutes)}</span><span className={`priority-label label-${task.priority.toLowerCase()}`}>{task.priority}</span></div></div>
                  <div className="task-order-actions"><button onClick={() => void moveTask(index, -1)} disabled={index === 0 || reordering} aria-label={`Move ${task.title} up`}>↑</button><button onClick={() => void moveTask(index, 1)} disabled={index === todayTasks.length - 1 || reordering} aria-label={`Move ${task.title} down`}>↓</button></div>
                </div>
              })}
              <button className="plan-footer-link" onClick={() => navigate('/planner')}>Open planner <ArrowUpRight size={14} /></button>
            </div>}
        </NotebookCard>
      </section>

      <aside className="dashboard-aside">
        <NotebookCard className="dash-focus" aria-label="Focus and daily study goal">
          <div className="dash-focus-head">
            <h2>Focus</h2>
            <span className="type-caption">{focus.running ? 'In progress' : 'Daily goal'}</span>
          </div>
          <div className="study-time-value">{fmtDuration(todayMinutes)}<span> / {fmtDuration(goal)}</span></div>
          <ProgressBar value={goalProgress} color="var(--accent)" label="Daily study goal" />
          {sessionLive && <p className="dash-clock" aria-live="polite"><Timer size={15} aria-hidden="true" /> {focus.mode} · {formatClock(focus.remainingSeconds)}</p>}
          <div className="dash-focus-actions">
            {focus.running
              ? <Button variant="secondary" onClick={focus.pause}><Pause size={15} /> Pause</Button>
              : sessionLive
                ? <Button variant="secondary" onClick={focus.start}><Play size={15} /> Resume</Button>
                : <Button variant="secondary" onClick={() => navigate('/focus')}><Timer size={15} /> Start focus session</Button>}
            <button type="button" className="text-link" onClick={() => navigate('/focus')}>Open timer <ArrowUpRight size={14} /></button>
          </div>
        </NotebookCard>
      </aside>
    </div>

    <section className="dash-exam-section" aria-label="Exams and syllabus">
      <SectionHeading title="Exams" note={examMode.active ? `Exam mode · ${examMode.label}` : activeTrack.label} action={<Button variant="quiet" size="sm" onClick={() => navigate('/settings')}>Exam dates</Button>} />
      <NotebookCard className="dash-exam">
        {primaryExam === null
          ? <div className="countdown-unset"><div><span className="type-caption">No date set</span><p className="dash-unset-title">Set your date when you’re ready.</p></div><Button variant="secondary" size="sm" onClick={() => navigate('/settings')}>Add exam date <ArrowRight size={15} /></Button></div>
          : <div className="countdown-main"><div className="countdown-number">{Math.max(0, primaryExam.days)}<span>days</span></div><div className="countdown-copy"><span>until</span><strong>{primaryExam.label}</strong><small>{prettyDate(primaryExam.date)}</small></div></div>}
        {otherExams.length > 0 && <ul className="dash-tracks">
          {otherExams.map(exam => <li key={exam.track}><span>{exam.label}</span><strong>{exam.days === null ? 'Date not set' : exam.days < 0 ? 'Date passed' : `${Math.max(0, exam.days)}d`}</strong></li>)}
        </ul>}
        {examMode.active && <p className="dash-exam-note" role="status">{examMode.reason}</p>}

        {progress.totalChapters > 0 ? <>
          <div className="dash-syllabus-line">
            <span className="type-caption">{progress.completedChapters}/{progress.totalChapters} chapters</span>
            {progress.raw !== null && <strong>{Math.round(progress.raw)}% complete</strong>}
            {progress.weighted !== null && <span className="type-caption">{Math.round(progress.weighted)}% weighted</span>}
          </div>
          <div className="dash-subjects">
            {progress.bySubject.map(subject => <div className="dash-subject" key={subject.subject}>
              <SubjectBadge subject={subject.subject} />
              <ProgressBar value={subject.raw ?? 0} color={`var(--subject-${subject.subject.toLowerCase()})`} label={`${subject.subject} chapters`} />
              <span className="type-caption">{subject.completed}/{subject.total}</span>
            </div>)}
          </div>
        </> : <p className="dash-exam-note">Add chapters in the syllabus to track coverage. No completion figure yet.</p>}

        {(showPyq || showReadiness || backlogDue > 0) ? <div className="dash-facts">
          {showPyq && pyq && <div><span className="type-overline">{pyqExam === 'Main' ? 'JEE Main PYQs' : 'JEE Advanced PYQs'}</span><strong className="type-metric"><Pct value={pyq.percent} /></strong><span className="type-caption">{pyq.done} of {pyq.total} years</span></div>}
          {showReadiness && <div><span className="type-overline">Readiness</span><strong className="type-metric"><Pct value={activeTrack.percent} /></strong><span className="type-caption">{activeTrack.label}</span></div>}
          {backlogDue > 0 && <div><span className="type-overline">Backlog</span><strong className="type-metric">{backlogDue}</strong><button type="button" className="text-link" onClick={() => navigate('/backlog')}>Open backlog <ArrowUpRight size={14} /></button></div>}
        </div> : null}
        {showReadiness && <details className="dash-details">
          <summary>How readiness is calculated</summary>
          <ul>{activeTrack.components.map(item => <li key={item.label}><span>{item.label}</span><strong>{item.value === null ? '—' : `${Math.round(item.value)}%`}</strong><small>{item.note}</small></li>)}</ul>
        </details>}
        {week.total > 0 && <details className="dash-details">
          <summary>This week · {fmtDuration(week.total)}</summary>
          <ul className="dash-week">
            {PRIMARY_ACTIVITIES.map(activity => <li key={activity}><span>{activity}</span><strong>{fmtDuration(week[activity])}</strong></li>)}
            {(week['Mock/Test'] > 0 || week['PYQ practice'] > 0) && <li><span>Mock and PYQ</span><strong>{fmtDuration(week['Mock/Test'] + week['PYQ practice'])}</strong></li>}
          </ul>
        </details>}
        <div className="dash-links">
          <button type="button" className="text-link" onClick={() => navigate('/syllabus')}>All chapters <ArrowUpRight size={14} /></button>
          <button type="button" className="text-link" onClick={() => navigate('/tests?add=1')}>Log a test <ArrowUpRight size={14} /></button>
          <button type="button" className="text-link" onClick={() => navigate('/analytics')}>Analytics <ArrowUpRight size={14} /></button>
        </div>
      </NotebookCard>
    </section>

    <Insight
      recommendation={studyNow.primary}
      alternatives={studyNow.alternatives}
      tip={tip === GENERIC_TIP ? null : tip}
      reminder={insightReminder}
      showWhy={showWhy}
      onToggleWhy={() => setShowWhy(value => !value)}
      revisions={dayRevisions}
      onCompleteRevision={revision => void markRevision(revision)}
      onNavigate={navigate}
    />
  </div>
}

function Insight({
  recommendation, alternatives, tip, reminder, showWhy, onToggleWhy, revisions, onCompleteRevision, onNavigate
}: {
  recommendation: Recommendation | null
  alternatives: Recommendation[]
  tip: string | null
  reminder: { kind: ReminderKind; title: string; body: string } | null
  showWhy: boolean
  onToggleWhy: () => void
  revisions: Revision[]
  onCompleteRevision: (revision: Revision) => void
  onNavigate: (to: string) => void
}) {
  if (recommendation) {
    const revision = recommendation.kind === 'revision' && recommendation.chapterId
      ? revisions.find(item => item.chapter_id === recommendation.chapterId)
      : undefined
    return <section className="dash-insight" aria-label="Next best action">
      <div className="dash-insight-copy">
        <span className="type-overline">Next best action</span>
        <h2>{recommendation.title}</h2>
        <p>{recommendation.summary}</p>
      </div>
      <div className="dash-insight-actions">
        {revision
          ? <Button variant="secondary" onClick={() => onCompleteRevision(revision)}><Check size={15} /> Mark revision done</Button>
          : <Button variant="secondary" onClick={() => onNavigate(recommendation.to)}>{recommendation.actionLabel} <ArrowRight size={15} /></Button>}
        <Button variant="quiet" size="sm" onClick={onToggleWhy} aria-expanded={showWhy}>{showWhy ? 'Hide why' : 'Why this?'}</Button>
        {revision && <button type="button" className="text-link" onClick={() => onNavigate(recommendation.to)}>Open revisions <ArrowUpRight size={14} /></button>}
      </div>
      {showWhy && <div className="study-now-why">
        <strong>Ranked highest because:</strong>
        <ul>{recommendation.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        {alternatives.length > 0 && <>
          <strong>Also considered</strong>
          <ol>{alternatives.slice(0, 3).map(item => <li key={item.id}><span>{item.title}</span><small>{item.reasons.join('; ') || item.summary}</small></li>)}</ol>
        </>}
      </div>}
    </section>
  }
  if (tip) {
    return <section className="dash-insight" aria-label="Study insight">
      <div className="dash-insight-copy">
        <span className="type-overline">Study insight</span>
        <h2>One thing to notice</h2>
        <p>{tip}</p>
      </div>
      <Button variant="secondary" onClick={() => onNavigate('/analytics')}>See the data <ArrowRight size={15} /></Button>
    </section>
  }
  if (!reminder || reminder.kind === 'plan') return null
  return <section className="dash-insight" aria-label="Study insight">
    <div className="dash-insight-copy">
      <span className="type-overline">Study insight</span>
      <h2>{reminder.title}</h2>
      <p>{reminder.body}</p>
    </div>
    <Button variant="secondary" onClick={() => onNavigate(REMINDER_TO[reminder.kind])}>Open <ArrowRight size={15} /></Button>
  </section>
}

function getGreeting(): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date()))
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

function daysUntil(date: string): number | null {
  if (!date) return null
  const today = indiaToday()
  return differenceInCalendarDays(parseISO(`${date}T12:00:00`), parseISO(`${today}T12:00:00`))
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}
