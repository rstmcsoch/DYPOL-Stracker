import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Activity, AlarmClock, BookOpen, CalendarDays, Check, Clock3, Flame, Library, ListChecks, Pause, Play, Plus, Sparkles, Target, Timer } from 'lucide-react'
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { Button, ProgressBar, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { useFocus } from '../contexts/FocusContext'
import { getSmartTip, getTodayStudyMinutes } from '../lib/analytics'
import { computeStreaks, qualifyingDays, studyMinutesByActivity, weekRange } from '../lib/jee/study-time'
import { currentExamMode, daysUntilExam, trackConfig, trackExamDate, trackReadiness, TRACK_LABEL, TRACK_PYQ_EXAM } from '../lib/jee/exam'
import { aggregatePractice, pyqCompletion, syllabusProgress } from '../lib/jee/progress'
import { recommendStudyNow, type Recommendation } from '../lib/jee/recommend'
import { computeReminders, isAwake } from '../lib/jee/reminders'
import { fmtDuration } from '../lib/format'
import { indiaToday, prettyDate } from '../lib/date'
import { completeRevision as completeRevisionAction } from '../lib/revision-actions'
import { Pct } from '../components/jee/shared'
import { TRACK_IDS } from '../types'
import type { ActivityMinutes } from '../lib/jee/study-time'
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
  const overdueRevisions = dayRevisions.filter(revision => revision.due_on < today).length
  const todayMinutes = getTodayStudyMinutes(data)
  const streak = computeStreaks(data, today)
  const streakDays = useMemo(() => {
    const days = qualifyingDays(data)
    return Array.from({ length: 7 }, (_, index) => {
      const day = format(addDays(parseISO(`${today}T12:00:00`), index - 6), 'yyyy-MM-dd')
      const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(`${day}T12:00:00+05:30`))
      return { day, weekday, active: days.has(day), isToday: day === today }
    })
  }, [data, today])
  const examMode = currentExamMode(data, today)
  const goal = data.settings.daily_study_goal_minutes
  const goalProgress = goal > 0 ? Math.min(100, todayMinutes / goal * 100) : 0
  const practice = useMemo(() => aggregatePractice(data.practiceSessions), [data.practiceSessions])
  const progress = useMemo(() => syllabusProgress(data.chapters, data.settings), [data.chapters, data.settings])
  const studyNow = useMemo(() => recommendStudyNow(data, today), [data, today])
  const reminders = useMemo(() => computeReminders(data, today), [data, today])
  const todayMix = useMemo(() => studyMinutesByActivity(data, today, today), [data, today])
  const week = useMemo(() => studyMinutesByActivity(data, weekRange(today).start, today), [data, today])
  const backlogDue = data.backlogItems.filter(item => isAwake(item, today) && item.due_on !== null && item.due_on <= today).length
  const pendingRetries = data.mistakes.filter(mistake => mistake.retry_status === 'pending').length
  const weekStart = weekRange(today).start
  const testsThisWeek = data.tests.filter(test => test.test_date >= weekStart && test.test_date <= today).length
  const practicedToday = data.practiceSessions.some(session => session.practice_date === today)
  const activeTrack = trackReadiness(data, data.settings.active_track, today)
  const pyqExam = TRACK_PYQ_EXAM[data.settings.active_track]
  const pyq = useMemo(() => pyqExam ? pyqCompletion(data.pyqRecords, null, pyqExam, data.settings) : null, [data.pyqRecords, data.settings, pyqExam])
  const pyqMain = useMemo(() => pyqCompletion(data.pyqRecords, null, 'Main', data.settings), [data.pyqRecords, data.settings])
  const pyqAdv = useMemo(() => pyqCompletion(data.pyqRecords, null, 'Advanced', data.settings), [data.pyqRecords, data.settings])
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
          : !practicedToday
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
  const recommendationRevision = studyNow.primary?.kind === 'revision' && studyNow.primary.chapterId
    ? dayRevisions.find(item => item.chapter_id === studyNow.primary?.chapterId)
    : undefined
  const insightTip = tip === GENERIC_TIP ? null : tip

  return <div className="dashboard-page">
    <header className="dash-greeting">
      <div className="dash-greeting-copy">
        <p className="eyebrow">{new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date())}</p>
        <h1>Good {getGreeting()}, {name}.</h1>
        <p className="dash-status">{statusLine}</p>
      </div>
      <Button onClick={primaryAction.run}>{primaryAction.label} <ArrowRight size={16} /></Button>
    </header>

    {/* A · Featured overview: the exam countdown and the study streak. */}
    <section className="dash-overview" aria-label="Exam countdown and study streak">
      <section className="dash-feature dash-exam notebook-card" aria-label="Exam countdown">
        <div className="dash-feature-head">
          <span className="eyebrow">Exam countdown</span>
          <button type="button" className="text-link" onClick={() => navigate('/settings')}>Exam dates <ArrowUpRight size={14} /></button>
        </div>
        {primaryExam === null
          ? <div className="countdown-unset">
            <div>
              <span className="type-caption">No date set</span>
              <p className="dash-unset-title">Set your date when you’re ready.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/settings')}>Add exam date <ArrowRight size={15} /></Button>
          </div>
          : <div className="countdown-main">
            <div className="countdown-number">{Math.max(0, primaryExam.days)}<span>days</span></div>
            <div className="countdown-copy"><span>until</span><strong>{primaryExam.label}</strong><small>{prettyDate(primaryExam.date)}</small></div>
          </div>}
        {otherExams.length > 0 && <ul className="dash-tracks" aria-label="Other exam dates">
          {otherExams.map(exam => <li key={exam.track}><span>{exam.label}</span><strong>{exam.days === null ? 'Date not set' : exam.days < 0 ? 'Date passed' : `${Math.max(0, exam.days)} days`}</strong></li>)}
        </ul>}
        {examMode.active
          ? <p className="dash-exam-note" role="status">{examMode.reason}</p>
          : primaryExam && <p className="dash-exam-note">Exam Mode switches on automatically in the final 30 days.</p>}
      </section>

      <section className="dash-feature dash-streak notebook-card" aria-label="Study streak" title={streak.rule}>
        <div className="dash-feature-head">
          <span className="eyebrow"><Flame size={14} aria-hidden="true" /> Study streak</span>
        </div>
        <div className="dash-streak-main">
          <strong className="dash-streak-number">{streak.current}<span>{streak.current === 1 ? ' day' : ' days'}</span></strong>
          <span className="streak-subtitle">current study streak</span>
          <span className="dash-streak-longest"><strong>{streak.longest}</strong> longest</span>
        </div>
        <div className="dash-week-strip" role="list" aria-label={`Study days, last 7 days: ${streak.weeklyConsistency} of 7`}>
          {streakDays.map(item => <div key={item.day} role="listitem" className={`dash-week-day ${item.active ? 'active' : ''} ${item.isToday ? 'today' : ''}`} aria-label={`${item.weekday} ${item.day}: ${item.active ? 'study day' : 'no study day'}`}>
            <span className="dash-week-dot" aria-hidden="true">{item.active && <Check size={12} strokeWidth={3} />}</span>
            <small aria-hidden="true">{item.weekday.charAt(0)}</small>
          </div>)}
        </div>
        <p className="dash-streak-foot"><strong>{streak.weeklyConsistency}/7</strong> active days in the last week</p>
      </section>
    </section>

    {/* C · Planning: the recommendation gets its own band, beside the study insight. */}
    <section className="dash-planning" aria-label="Planning">
      <NextAction
        recommendation={studyNow.primary}
        alternatives={studyNow.alternatives}
        emptyReason={studyNow.emptyReason}
        showWhy={showWhy}
        onToggleWhy={() => setShowWhy(value => !value)}
        revision={recommendationRevision}
        onCompleteRevision={revision => void markRevision(revision)}
        onNavigate={navigate}
      />
      <StudyInsight tip={insightTip} reminder={insightReminder} onNavigate={navigate} />
    </section>

    <section className="dash-progress" aria-label="Daily progress">
      <DashHeading title="Daily progress" note="Today’s activity, syllabus, practice and readiness, side by side." />
      <div className="dash-stat-grid">
        <section className="notebook-card dash-stat dash-stat-activity" aria-label="Today’s activity">
          <div className="dash-stat-head">
            <span className="dash-stat-title"><Clock3 size={15} aria-hidden="true" /> Today’s activity</span>
            <button type="button" className="text-link" onClick={() => navigate('/focus')}>Focus <ArrowUpRight size={14} /></button>
          </div>
          {todayMix.total === 0
            ? <p className="dash-stat-empty">Nothing recorded yet today. A focus block or a practice log will show here.</p>
            : <ActivityMix minutes={todayMix} />}
          <p className="dash-stat-foot">This week: <strong>{fmtDuration(week.total)}</strong> of study recorded</p>
        </section>

        <section className="notebook-card dash-stat dash-stat-syllabus" aria-label="Syllabus progress">
          <div className="dash-stat-head">
            <span className="dash-stat-title"><BookOpen size={15} aria-hidden="true" /> Syllabus progress</span>
            <button type="button" className="text-link" onClick={() => navigate('/syllabus')}>Open <ArrowUpRight size={14} /></button>
          </div>
          {progress.totalChapters > 0
            ? <>
              <div className="dash-stat-value"><strong><Pct value={progress.raw} /></strong><span>complete</span></div>
              <ProgressBar value={progress.raw ?? 0} color="var(--accent)" label="Raw syllabus completion" />
              <dl className="dash-stat-rows">
                <div><dt>Chapters</dt><dd>{progress.completedChapters}/{progress.totalChapters}</dd></div>
                <div><dt>Weighted</dt><dd><Pct value={progress.weighted} /></dd></div>
              </dl>
              <p className="dash-stat-foot">Weighted gives high-importance chapters more say.</p>
            </>
            : <p className="dash-stat-empty">Add chapters in the syllabus to track coverage.</p>}
        </section>

        <section className="notebook-card dash-stat dash-stat-practice" aria-label="Practice and PYQs">
          <div className="dash-stat-head">
            <span className="dash-stat-title"><Library size={15} aria-hidden="true" /> Practice &amp; PYQs</span>
            <button type="button" className="text-link" onClick={() => navigate('/practice')}>Log <ArrowUpRight size={14} /></button>
          </div>
          <div className="dash-stat-value">
            <strong>{practice.attempted > 0 ? practice.attempted.toLocaleString('en-IN') : '—'}</strong>
            <span>{practice.accuracy === null ? 'questions logged' : `questions · ${Math.round(practice.accuracy)}% accuracy`}</span>
          </div>
          <dl className="dash-stat-rows">
            <div><dt>JEE Main PYQs</dt><dd><Pct value={pyqMain.percent} /> <small>{pyqMain.done}/{pyqMain.total}</small></dd></div>
            <div><dt>JEE Advanced PYQs</dt><dd><Pct value={pyqAdv.percent} /> <small>{pyqAdv.done}/{pyqAdv.total}</small></dd></div>
          </dl>
        </section>

        <section className="notebook-card dash-stat dash-stat-readiness" aria-label="Exam readiness">
          <div className="dash-stat-head">
            <span className="dash-stat-title"><Target size={15} aria-hidden="true" /> Exam readiness</span>
            <span className="dash-stat-caption">{activeTrack.label}</span>
          </div>
          {showReadiness
            ? <>
              <div className="dash-stat-value"><strong><Pct value={activeTrack.percent} /></strong><span>weighted average</span></div>
              <dl className="dash-stat-rows">
                {activeTrack.components.map(item => <div key={item.label}><dt>{item.label}<small>{item.note}</small></dt><dd>{item.value === null ? '—' : `${Math.round(item.value)}%`}</dd></div>)}
              </dl>
            </>
            : <p className="dash-stat-empty">Add chapters, PYQs or tests to see readiness.</p>}
        </section>
      </div>
    </section>

    <div className="dash-main">
      {/* D · Today's plan */}
      <div className="dash-column dash-column-plan">
        <section className="dash-plan" aria-label="Today’s plan">
          <DashHeading
            title="Today’s plan"
            note={`${doneTasks} of ${todayTasks.length} done`}
            action={<Button variant="secondary" size="sm" onClick={() => navigate('/planner?add=1')}><Plus size={16} /> Add task</Button>}
          />
          <div className="notebook-card dash-plan-card">
            <div className="dash-plan-top"><span className="plan-date"><CalendarDays size={14} aria-hidden="true" /> {prettyDate(today, { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>
            {todayTasks.length === 0
              ? <div className="dash-empty">
                <span className="dash-empty-icon" aria-hidden="true"><ListChecks size={20} /></span>
                <p className="dash-empty-title">Nothing planned for today</p>
                <p>Add one clear task and today has a start.</p>
                <Button variant="secondary" size="sm" onClick={() => navigate('/planner?add=1')}><Plus size={15} /> Add a task</Button>
              </div>
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
          </div>
        </section>
          <section className="notebook-card dash-panel dash-focus" aria-label="Daily study time">
            <div className="dash-panel-head">
              <h2>Daily study time</h2>
              <span className="dash-panel-caption">{focus.running ? 'In progress' : 'Daily goal'}</span>
            </div>
            <div className="study-time-value">{fmtDuration(todayMinutes)}<span> / {fmtDuration(goal)}</span></div>
            <ProgressBar value={goalProgress} color="var(--accent)" label="Daily study goal" />
            {sessionLive && <p className="dash-clock" aria-live="polite"><Timer size={15} aria-hidden="true" /> {focus.mode} · {formatClock(focus.remainingSeconds)}</p>}
            <div className="dash-focus-actions">
              {focus.running
                ? <Button variant="secondary" size="sm" onClick={focus.pause}><Pause size={15} /> Pause</Button>
                : sessionLive
                  ? <Button variant="secondary" size="sm" onClick={focus.start}><Play size={15} /> Resume</Button>
                  : <Button variant="secondary" size="sm" onClick={() => navigate('/focus')}><Timer size={15} /> Start focus session</Button>}
              <button type="button" className="text-link" onClick={() => navigate('/focus')}>Open timer <ArrowUpRight size={14} /></button>
            </div>
          </section>
      </div>

      <aside className="dash-column dash-support" aria-label="Supporting panels">

        <section className="notebook-card dash-panel dash-revisions" aria-label="Revision status">
          <div className="dash-panel-head">
            <h2><AlarmClock size={16} aria-hidden="true" /> Revision status</h2>
            <span className="dash-panel-caption">{dayRevisions.length ? `${dayRevisions.length} due${overdueRevisions ? ` · ${overdueRevisions} overdue` : ''}` : 'Clear'}</span>
          </div>
          {dayRevisions.length === 0
            ? <p className="dash-panel-empty">No revisions due today. Completed revisions keep the schedule moving.</p>
            : <ul className="dash-revision-list">
              {dayRevisions.slice(0, 3).map(revision => {
                const chapter = data.chapters.find(item => item.id === revision.chapter_id)
                return <li key={revision.id}>
                  <div className="dash-revision-copy">
                    <strong>{chapter?.name ?? 'Chapter'}</strong>
                    <small>Revision {revision.revision_number} · due {prettyDate(revision.due_on, { day: 'numeric', month: 'short' })}{revision.due_on < today ? ' · overdue' : ''}</small>
                  </div>
                  <button type="button" className="dash-revision-done" onClick={() => void markRevision(revision)} aria-label={`Mark ${chapter?.name ?? 'revision'} revision done`}><Check size={14} /> Done</button>
                </li>
              })}
            </ul>}
          <button type="button" className="text-link dash-panel-link" onClick={() => navigate('/revision')}>{dayRevisions.length > 3 ? `All ${dayRevisions.length} revisions` : 'Open revisions'} <ArrowUpRight size={14} /></button>
        </section>

        <section className="notebook-card dash-panel dash-checkpoints" aria-label="Practice checkpoints">
          <div className="dash-panel-head">
            <h2>Practice checkpoints</h2>
          </div>
          <ul className="dash-checkpoint-list">
            <li>
              <span className={`dash-check-mark ${practicedToday ? 'done' : ''}`} aria-hidden="true">{practicedToday && <Check size={12} strokeWidth={3} />}</span>
              <span className="dash-checkpoint-copy">Practice logged today</span>
              {practicedToday ? <strong>Done</strong> : <button type="button" className="text-link" onClick={() => navigate('/practice')}>Log <ArrowUpRight size={13} /></button>}
            </li>
            <li>
              <Sparkles size={15} aria-hidden="true" className="dash-checkpoint-icon" />
              <span className="dash-checkpoint-copy">Tests this week</span>
              <strong>{testsThisWeek}</strong>
            </li>
            <li>
              <ListChecks size={15} aria-hidden="true" className="dash-checkpoint-icon" />
              <span className="dash-checkpoint-copy">Mistakes awaiting retry</span>
              {pendingRetries > 0 ? <button type="button" className="text-link" onClick={() => navigate('/retry')}>{pendingRetries} · Retry <ArrowUpRight size={13} /></button> : <strong>0</strong>}
            </li>
            <li>
              <Activity size={15} aria-hidden="true" className="dash-checkpoint-icon" />
              <span className="dash-checkpoint-copy">Backlog due</span>
              {backlogDue > 0 ? <button type="button" className="text-link" onClick={() => navigate('/backlog')}>{backlogDue} · Open <ArrowUpRight size={13} /></button> : <strong>0</strong>}
            </li>
          </ul>
        </section>
      </aside>
    </div>

    {/* F · Long-term progress by subject */}
    <section className="dash-longterm" aria-label="Long-term syllabus progress">
      <DashHeading
        title="Long-term progress"
        note="Chapter completion by subject. The overall figure is in Daily progress."
        action={<Button variant="secondary" size="sm" onClick={() => navigate('/syllabus')}>All chapters <ArrowRight size={15} /></Button>}
      />
      <div className="notebook-card dash-longterm-card">
        {progress.totalChapters > 0
          ? <div className="dash-subject-grid">
            {progress.bySubject.map(subject => <div className="dash-subject" key={subject.subject}>
              <div className="dash-subject-top">
                <SubjectBadge subject={subject.subject} />
                <span>{subject.completed}/{subject.total} chapters</span>
              </div>
              <div className="dash-subject-value"><strong><Pct value={subject.raw} /></strong><span>complete</span></div>
              <ProgressBar value={subject.raw ?? 0} color={`var(--subject-${subject.subject.toLowerCase()})`} label={`${subject.subject} chapters`} />
              <small>{subject.weighted === null ? 'No weighting yet' : `${Math.round(subject.weighted)}% weighted by importance`}</small>
            </div>)}
          </div>
          : <p className="dash-panel-empty">Add chapters in the syllabus to track coverage. No completion figure yet.</p>}
        <div className="dash-longterm-foot">
          <button type="button" className="text-link" onClick={() => navigate('/analytics')}>Analytics <ArrowUpRight size={14} /></button>
          <button type="button" className="text-link" onClick={() => navigate('/tests?add=1')}>Log a test <ArrowUpRight size={14} /></button>
          {showPyq && pyq && <span className="dash-longterm-note">{pyqExam === 'Main' ? 'JEE Main' : 'JEE Advanced'} PYQs: {pyq.done} of {pyq.total} years</span>}
          {showReadiness && <span className="dash-longterm-note">Readiness {Math.round(activeTrack.percent ?? 0)}% for {activeTrack.label}</span>}
        </div>
      </div>
    </section>
  </div>
}

function DashHeading({ title, note, action }: { title: string; note?: string; action?: ReactNode }) {
  return <div className="dash-heading">
    <div>
      <h2>{title}</h2>
      {note && <p>{note}</p>}
    </div>
    {action}
  </div>
}

function ActivityMix({ minutes }: { minutes: ActivityMinutes }) {
  const segments = [
    { key: 'lecture', label: 'Lecture', value: minutes.Lecture },
    { key: 'practice', label: 'Practice', value: minutes.Practice },
    { key: 'revision', label: 'Revision', value: minutes.Revision },
    { key: 'other', label: 'Mock & PYQ', value: minutes['Mock/Test'] + minutes['PYQ practice'] }
  ].filter(segment => segment.value > 0)
  return <>
    <div className="dash-mix-bar" role="img" aria-label={segments.map(segment => `${segment.label} ${fmtDuration(segment.value)}`).join(', ')}>
      {segments.map(segment => <span key={segment.key} className={`seg-${segment.key}`} style={{ width: `${segment.value / minutes.total * 100}%` }} />)}
    </div>
    <ul className="dash-mix-list">
      {segments.map(segment => <li key={segment.key}><span className={`dash-mix-dot seg-${segment.key}`} aria-hidden="true" /><span>{segment.label}</span><strong>{fmtDuration(segment.value)}</strong></li>)}
    </ul>
  </>
}

function NextAction({ recommendation, alternatives, emptyReason, showWhy, onToggleWhy, revision, onCompleteRevision, onNavigate }: {
  recommendation: Recommendation | null
  alternatives: Recommendation[]
  emptyReason: string | null
  showWhy: boolean
  onToggleWhy: () => void
  revision: Revision | undefined
  onCompleteRevision: (revision: Revision) => void
  onNavigate: (to: string) => void
}) {
  if (!recommendation) {
    return <section className="notebook-card dash-action dash-action-empty" aria-label="Next best action">
      <div className="dash-action-copy">
        <span className="eyebrow">Next best action</span>
        <h2>Nothing urgent right now</h2>
        <p>{emptyReason ?? 'Plan a task or log a session and the next best action appears here.'}</p>
      </div>
      <div className="dash-action-buttons">
        <Button variant="secondary" onClick={() => onNavigate('/planner?add=1')}>Plan a task <ArrowRight size={15} /></Button>
      </div>
    </section>
  }
  return <section className="notebook-card dash-action" aria-label="Next best action">
    <div className="dash-action-copy">
      <span className="eyebrow">Next best action</span>
      <h2>{recommendation.title}</h2>
      <p>{recommendation.summary}</p>
    </div>
    <div className="dash-action-buttons">
      {revision
        ? <Button variant="secondary" onClick={() => onCompleteRevision(revision)}><Check size={15} /> Mark revision done</Button>
        : <Button variant="secondary" onClick={() => onNavigate(recommendation.to)}>{recommendation.actionLabel} <ArrowRight size={15} /></Button>}
      <button type="button" className="text-link" onClick={onToggleWhy} aria-expanded={showWhy}>{showWhy ? 'Hide why' : 'Why this?'}</button>
      {revision && <button type="button" className="text-link" onClick={() => onNavigate(recommendation.to)}>Open revisions <ArrowUpRight size={14} /></button>}
    </div>
    {showWhy && <div className="study-now-why dash-action-why">
      <strong>Ranked highest because:</strong>
      <ul>{recommendation.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
      {alternatives.length > 0 && <>
        <strong>Also considered</strong>
        <ol>{alternatives.slice(0, 3).map(item => <li key={item.id}><span>{item.title}</span><small>{item.reasons.join('; ') || item.summary}</small></li>)}</ol>
      </>}
    </div>}
  </section>
}

function StudyInsight({ tip, reminder, onNavigate }: {
  tip: string | null
  reminder: { kind: ReminderKind; title: string; body: string } | null
  onNavigate: (to: string) => void
}) {
  if (tip) {
    return <section className="notebook-card dash-insight" aria-label="Study insight">
      <span className="eyebrow">Study insight</span>
      <h2>One thing to notice</h2>
      <p>{tip}</p>
      <div className="dash-insight-buttons"><Button variant="secondary" onClick={() => onNavigate('/analytics')}>See the data <ArrowRight size={15} /></Button></div>
    </section>
  }
  if (reminder && reminder.kind !== 'plan') {
    return <section className="notebook-card dash-insight" aria-label="Study insight">
      <span className="eyebrow">Study insight</span>
      <h2>{reminder.title}</h2>
      <p>{reminder.body}</p>
      <div className="dash-insight-buttons"><Button variant="secondary" onClick={() => onNavigate(REMINDER_TO[reminder.kind])}>Open <ArrowRight size={15} /></Button></div>
    </section>
  }
  return <section className="notebook-card dash-insight" aria-label="Study insight">
    <span className="eyebrow">Study insight</span>
    <h2>One thing to notice</h2>
    <p>{GENERIC_TIP}</p>
    <div className="dash-insight-buttons"><Button variant="secondary" onClick={() => onNavigate('/analytics')}>Open analytics <ArrowRight size={15} /></Button></div>
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
