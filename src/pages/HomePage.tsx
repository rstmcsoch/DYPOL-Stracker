import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlarmClock, ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Check, ChevronRight,
  Clock3, Flame, NotebookPen, Plus, Rocket, Sparkles, Timer
} from 'lucide-react'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import { Button, EmptyState, NotebookCard, PageHeader, ProgressBar, ProgressRing, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { getSmartTip, getStudyStreak, getTodayStudyMinutes } from '../lib/analytics'
import { fmtDuration } from '../lib/format'
import { indiaToday, prettyDate } from '../lib/date'
import { completeRevision as completeRevisionAction } from '../lib/revision-actions'
import type { AppData, DailyTask, Revision, Subject } from '../types'

export default function HomePage() {
  const { data, upsert, upsertMany } = useData()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [reordering, setReordering] = useState(false)
  const today = indiaToday()
  const todayTasks = useMemo(() => data.tasks.filter(task => task.task_date === today).sort((a, b) => a.position - b.position), [data.tasks, today])
  const doneTasks = todayTasks.filter(task => task.is_completed).length
  const dayRevisions = data.revisions.filter(revision => !revision.completed_at && revision.due_on <= today).sort((a, b) => a.due_on.localeCompare(b.due_on))
  const todayMinutes = getTodayStudyMinutes(data)
  const streak = getStudyStreak(data)
  const progress = data.settings.daily_study_goal_minutes > 0 ? Math.min(100, todayMinutes / data.settings.daily_study_goal_minutes * 100) : 0
  const tip = getSmartTip(data)
  const completedChapters = data.chapters.filter(chapter => chapter.status === 'Done' || chapter.status === 'Revised').length
  const totalChapters = data.chapters.length
  const examDays = daysUntil(data.settings.advanced_exam_date)
  const mainDays = daysUntil(data.settings.main_exam_date)

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

  return <div className="dashboard-page">
    <PageHeader eyebrow={new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date()).toUpperCase()} title={`Good ${getGreeting()}, ${data.settings.owner_name || data.profile?.display_name || 'future engineer'}.`} subtitle="Let’s make today count — one honest study block at a time." doodle={<span className="header-atom">✦</span>} />

    <section className="hero-row" aria-label="Exam countdown and syllabus progress">
      <NotebookCard className="countdown-card">
        <div className="countdown-top"><span className="countdown-label"><span className="pencil-underline">THE BIG DAY</span></span><span className="countdown-badge"><Rocket size={15} /> JEE 2027</span></div>
        {examDays === null ? <div className="countdown-unset"><div><span>JEE Advanced</span><h2>Set your date<br /><em>when you’re ready.</em></h2><p>We’ll keep the countdown honest.</p></div><Button variant="marker" size="sm" onClick={() => navigate('/settings')}>Add exam date <ArrowRight size={15} /></Button></div> : <div className="countdown-main"><div className="countdown-number">{Math.max(0, examDays)}<span>days</span></div><div className="countdown-copy"><span>until</span><strong>JEE Advanced</strong><small>{prettyDate(data.settings.advanced_exam_date)}</small></div><span className="countdown-scribble" aria-hidden="true">↗</span></div>}
        <div className="countdown-footer"><div className="mini-exam"><span className="mini-exam-dot blue" /><span>JEE Main</span>{mainDays === null ? <button onClick={() => navigate('/settings')}>Add date</button> : <strong>{Math.max(0, mainDays)} days</strong>}</div><div className="mini-exam"><span className="mini-exam-dot orange" /><span>Chapters covered</span><strong>{completedChapters}/{totalChapters}</strong></div></div>
        <div className="countdown-star" aria-hidden="true">✳</div>
      </NotebookCard>
      <NotebookCard className="streak-card accent-orange">
        <div className="card-kicker"><span className="icon-tile orange"><Flame size={17} /></span> YOUR RHYTHM <span className="tiny-star">✦</span></div>
        <div className="streak-number">{streak.current}<span>day{streak.current === 1 ? '' : 's'}</span></div>
        <p className="streak-subtitle">current study streak</p>
        <div className="streak-bottom"><span><strong>{streak.longest}</strong> longest</span><span className="streak-separator" /><span><strong>{streak.daysThisMonth}</strong> study days this month</span></div>
        <div className="streak-sun" aria-hidden="true">☼</div>
      </NotebookCard>
    </section>

    <div className="dashboard-grid">
      <section className="today-plan-block">
        <SectionHeading title="Today's plan" note={`${doneTasks} of ${todayTasks.length} done`} action={<Button variant="secondary" size="sm" onClick={() => navigate('/planner?add=1')}><Plus size={16} /> Add task</Button>} />
        <NotebookCard className="today-plan-card">
          <div className="plan-card-top"><span className="handwriting-label">A little list for today</span><span className="plan-date"><CalendarDays size={14} /> {prettyDate(today, { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>
          {todayTasks.length === 0 ? <EmptyState icon={<BookOpen size={26} />} title="Your page is still blank." description="Add one clear task and give today a gentle starting point." action={<Button variant="secondary" size="sm" onClick={() => navigate('/planner?add=1')}><Plus size={15} /> Plan a task</Button>} /> : <div className="task-list">
            {todayTasks.slice(0, 6).map((task, index) => {
              const chapter = data.chapters.find(item => item.id === task.chapter_id)
              return <div key={task.id} className={`task-row ${task.is_completed ? 'task-done' : ''}`}>
                <button className="task-check" onClick={() => void toggleTask(task)} aria-label={task.is_completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`} aria-pressed={task.is_completed}><Check size={14} /></button>
                <div className="task-row-copy"><strong>{task.title}</strong><div className="task-meta">{task.subject && <SubjectBadge subject={task.subject} />}{chapter && <span>{chapter.name}</span>}<span><Clock3 size={12} /> {fmtDuration(task.estimated_minutes)}</span></div></div>
                <span className={`priority-dot priority-${task.priority.toLowerCase()}`} title={`${task.priority} priority`} aria-label={`${task.priority} priority`} />
                <div className="task-order-actions"><button onClick={() => void moveTask(index, -1)} disabled={index === 0 || reordering} aria-label={`Move ${task.title} up`}>↑</button><button onClick={() => void moveTask(index, 1)} disabled={index === todayTasks.length - 1 || reordering} aria-label={`Move ${task.title} down`}>↓</button></div>
              </div>
            })}
            {todayTasks.length > 6 && <button className="view-all-link" onClick={() => navigate('/planner')}>View all {todayTasks.length} tasks <ArrowRight size={15} /></button>}
          </div>}
          {todayTasks.length > 0 && <button className="plan-footer-link" onClick={() => navigate('/planner')}>Open planner <ArrowUpRight size={14} /></button>}
          <span className="paper-clip" aria-hidden="true" />
        </NotebookCard>
      </section>

      <aside className="dashboard-aside">
        <NotebookCard className="study-progress-card accent-blue">
          <div className="card-kicker"><span className="icon-tile blue"><Timer size={16} /></span> DAILY STUDY TIME</div>
          <div className="progress-content"><ProgressRing value={progress} size={88} label={<span className="ring-value">{Math.round(progress)}<small>%</small></span>} color="var(--subject-physics)" /><div className="study-progress-copy"><div className="study-time-value">{fmtDuration(todayMinutes)}<span> / {fmtDuration(data.settings.daily_study_goal_minutes)}</span></div><p>towards your daily goal</p><button onClick={() => navigate('/focus')}><Timer size={14} /> Start a focus session</button></div></div>
          <ProgressBar value={progress} color="var(--subject-physics)" />
          <span className="study-doodle" aria-hidden="true">⌁</span>
        </NotebookCard>

        <NotebookCard className="revisions-card accent-green">
          <div className="section-card-head"><div className="card-kicker"><span className="icon-tile green"><AlarmClock size={16} /></span> REVISION DESK</div><button className="text-link" onClick={() => navigate('/revision')}>Open <ArrowUpRight size={14} /></button></div>
          <div className="revision-summary"><strong>{dayRevisions.length}</strong><span>due now</span>{dayRevisions.length > 0 && <span className="revision-dot-mark">•</span>}</div>
          {dayRevisions.length === 0 ? <p className="revision-empty">Nothing due today. Keep that momentum going.</p> : <div className="revision-peek-list">{dayRevisions.slice(0, 3).map(revision => <RevisionPeek key={revision.id} revision={revision} data={data} onDone={async () => {
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
          }} />)}</div>}
        </NotebookCard>

        <NotebookCard className="smart-tip-card">
          <div className="tip-top"><span className="tip-spark"><Sparkles size={16} /></span><span>ONE THING TO NOTICE</span></div>
          <p>{tip}</p><button className="tip-link" onClick={() => navigate('/analytics')}>See what the data says <ArrowRight size={14} /></button>
          <span className="tip-pencil" aria-hidden="true">✎</span>
        </NotebookCard>
      </aside>
    </div>

    <section className="dashboard-bottom-row">
      <NotebookCard className="quick-test-card">
        <div className="quick-test-illustration" aria-hidden="true"><NotebookPen size={25} /><span>✦</span></div>
        <div><span className="eyebrow">A FRESH CHECKPOINT</span><h2>How did the practice go?</h2><p>Log a chapter test, a PYQ session, or your latest mock.</p></div>
        <Button onClick={() => navigate('/tests?add=1')}><Plus size={17} /> Add test</Button>
      </NotebookCard>
      <NotebookCard className="syllabus-mini-card">
        <div className="syllabus-mini-head"><div><span className="eyebrow">THE LONG GAME</span><h3>Syllabus progress</h3></div><ProgressRing value={totalChapters ? completedChapters / totalChapters * 100 : 0} size={62} label={<span className="ring-value small">{Math.round(totalChapters ? completedChapters / totalChapters * 100 : 0)}<small>%</small></span>} /></div>
        <div className="subject-mini-bars">{(['Physics', 'Chemistry', 'Maths'] as Subject[]).map(subject => {
          const total = data.chapters.filter(item => item.subject === subject).length
          const done = data.chapters.filter(item => item.subject === subject && (item.status === 'Done' || item.status === 'Revised')).length
          return <div className="subject-mini-row" key={subject}><SubjectBadge subject={subject} /><ProgressBar value={total ? done / total * 100 : 0} color={`var(--subject-${subject.toLowerCase()})`} /><span>{done}/{total}</span></div>
        })}</div>
        <button className="syllabus-mini-link" onClick={() => navigate('/syllabus')}>See all chapters <ChevronRight size={15} /></button>
      </NotebookCard>
    </section>
  </div>
}

function RevisionPeek({ revision, data, onDone }: { revision: Revision; data: AppData; onDone: () => void }) {
  const chapter = data.chapters.find(item => item.id === revision.chapter_id)
  if (!chapter) return null
  return <div className="revision-peek"><span className="revision-peek-number">R{revision.revision_number}</span><div className="revision-peek-copy"><strong>{chapter.name}</strong><span><SubjectBadge subject={chapter.subject} />{revision.due_on < indiaToday() && <StatusBadge tone="weak">{differenceInCalendarDays(parseISO(`${indiaToday()}T12:00:00`), parseISO(`${revision.due_on}T12:00:00`))}d late</StatusBadge>}</span></div><button className="revision-done-button" onClick={onDone} aria-label={`Mark ${chapter.name} revision complete`}><Check size={15} /></button></div>
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
