import { T } from '../lib/student-layout/T'
import { useMemo, useState, type ReactNode } from 'react'
import { useLayoutOrder, useLayoutSlot } from '../lib/student-layout/use-layout'
import { useNavigate } from 'react-router-dom'
import {
  AlarmClock, ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Check, ChevronRight,
  Clock3, Flame, NotebookPen, Plus, Rocket, Sparkles, Timer
} from 'lucide-react'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import { Button, EmptyState, NotebookCard, PageHeader, ProgressBar, ProgressRing, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { latestTestOn, getOverallTestPercentage, getOverallTestScore, getSmartTip, getTodayStudyMinutes } from '../lib/analytics'
import { computeStreaks } from '../lib/jee/study-time'
import { StudyNowCard } from '../components/jee/StudyNowCard'
import { HomeSnapshot } from '../components/jee/HomeSnapshot'
import { FocusIndicator } from '../components/jee/FocusIndicator'
import { currentExamMode } from '../lib/jee/exam'
import { fmtDuration, fmtNumber } from '../lib/format'
import { indiaToday, prettyDate } from '../lib/date'
import { completeRevision as completeRevisionAction } from '../lib/revision-actions'
import type { AppData, DailyTask, Revision } from '../types'
import { useReportSubjects } from '../lib/exams/useExamSubjects'
import { subjectColor } from '../lib/exams/subjects'
import { chosenExamTitle, isJeeSettings, trackExamDate } from '../lib/jee/exam'

const HOME_SUBJECT_LIMIT = 5

export default function HomePage() {
  const homeSubjects = useReportSubjects()
  const { data, upsert, upsertMany } = useData()
  // Only subjects the student actually has chapters in; a long catalogue (CUET, school) would otherwise list every option.
  const trackedSubjects = homeSubjects.filter(subject => data.chapters.some(item => item.subject === subject))
  const { notify } = useToast()
  const navigate = useNavigate()
  const [reordering, setReordering] = useState(false)
  const today = indiaToday()
  const todayTasks = useMemo(() => data.tasks.filter(task => task.task_date === today).sort((a, b) => a.position - b.position), [data.tasks, today])
  const doneTasks = todayTasks.filter(task => task.is_completed).length
  const dayRevisions = data.revisions.filter(revision => !revision.completed_at && revision.due_on <= today).sort((a, b) => a.due_on.localeCompare(b.due_on))
  const todayMinutes = getTodayStudyMinutes(data)
  const streak = computeStreaks(data, today)
  const examMode = currentExamMode(data, today)
  const progress = data.settings.daily_study_goal_minutes > 0 ? Math.min(100, todayMinutes / data.settings.daily_study_goal_minutes * 100) : 0
  const tip = getSmartTip(data)
  const completedChapters = data.chapters.filter(chapter => chapter.status === 'Done' || chapter.status === 'Revised').length
  const totalChapters = data.chapters.length
  const examDays = daysUntil(data.settings.advanced_exam_date)
  const mainDays = daysUntil(data.settings.main_exam_date)
  // The prominent countdown prefers JEE Advanced, but when Advanced is unset and
  // a Main date exists, JEE Main becomes the big day instead of a tiny footnote.
  const jee = isJeeSettings(data.settings)
  const examTitle = chosenExamTitle(data.settings)
  const boardsDate = jee ? null : trackExamDate(data, 'boards')
  const otherPrimary = mainDays !== null ? { label: examTitle, days: mainDays, date: data.settings.main_exam_date, dot: 'blue' as const } : null
  const otherSecondary = data.settings.boards_addon ? { label: 'Class 12 boards', days: daysUntil(boardsDate ?? ''), date: boardsDate ?? '', dot: 'orange' as const } : null
  const jeePrimary = examDays !== null
    ? { label: 'JEE Advanced', days: examDays, date: data.settings.advanced_exam_date, dot: 'orange' as const }
    : mainDays !== null
      ? { label: 'JEE Main', days: mainDays, date: data.settings.main_exam_date, dot: 'blue' as const }
      : null
  const primaryExam = jee ? jeePrimary : otherPrimary
  const jeeSecondary = jeePrimary?.label === 'JEE Main'
    ? { label: 'JEE Advanced', days: examDays, date: data.settings.advanced_exam_date, dot: 'orange' as const }
    : { label: 'JEE Main', days: mainDays, date: data.settings.main_exam_date, dot: 'blue' as const }
  const secondaryExam = jee ? jeeSecondary : otherSecondary

  const toggleTask = async (task: DailyTask) => {
    try {
      await upsert('daily_tasks', { ...task, is_completed: !task.is_completed, updated_at: new Date().toISOString() })
      if (!task.is_completed) notify('Task done.')
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

  const header = useLayoutSlot('home.header')
  const focusSlot = useLayoutSlot('home.focus')
  const hero = useLayoutSlot('home.hero')
  const countdown = useLayoutSlot('home.countdown')
  const streakSlot = useLayoutSlot('home.streak')
  const examSlot = useLayoutSlot('home.exam-mode')
  const studyNow = useLayoutSlot('home.study-now')
  const grid = useLayoutSlot('home.grid')
  const plan = useLayoutSlot('home.today-plan')
  const aside = useLayoutSlot('home.aside')
  const studyTime = useLayoutSlot('home.study-time')
  const revisionsSlot = useLayoutSlot('home.revisions')
  const tipSlot = useLayoutSlot('home.tip')
  const snapshot = useLayoutSlot('home.snapshot')
  const bottom = useLayoutSlot('home.bottom')
  const checkpoint = useLayoutSlot('home.checkpoint')
  const syllabus = useLayoutSlot('home.syllabus')
  const subjectLimit = syllabus.num('subjectRows', HOME_SUBJECT_LIMIT)
  const pageOrder = useLayoutOrder('home', HOME_SECTIONS)
  const heroOrder = useLayoutOrder('home.hero', ['home.countdown', 'home.streak'] as const)
  const gridOrder = useLayoutOrder('home.grid', ['home.today-plan', 'home.aside'] as const)
  const asideOrder = useLayoutOrder('home.aside', ['home.study-time', 'home.revisions', 'home.tip'] as const)
  const bottomOrder = useLayoutOrder('home.bottom', ['home.checkpoint', 'home.syllabus'] as const)

  const heroParts: Record<string, ReactNode> = {
    'home.countdown': countdown.hidden ? null : <NotebookCard key="countdown" className="countdown-card" {...countdown.attrs}>
      <div className="countdown-top"><span className="countdown-label"><span className="pencil-underline" {...countdown.textAttrs('kicker')}>{countdown.t('kicker', 'EXAM COUNTDOWN')}</span></span><span className="countdown-badge" {...countdown.dataAttrs('exam')}><Rocket size={15} /> {jee ? `JEE ${data.settings.exam_year ?? 2027}` : examTitle}</span></div>
      {primaryExam === null ? <div className="countdown-unset"><div><span>{jee ? 'JEE Main & Advanced' : examTitle}</span><h2><T k="home:set-your-date">{"Set your date"}</T><br /><em><T k="home:when-youre-ready">{"when you’re ready."}</T></em></h2><p><T k="home:well-keep-the-countdown-honest">{"Add it to start the countdown."}</T></p></div><Button variant="marker" size="sm" onClick={() => navigate('/settings')}>{countdown.text('addDate', 'Add exam date')} <ArrowRight size={15} /></Button></div> : <div className="countdown-main"><div className="countdown-number" {...countdown.dataAttrs('daysLeft')}>{Math.max(0, primaryExam.days)}<span {...countdown.textAttrs('daysUnit')}>{countdown.t('daysUnit', 'days')}</span></div><div className="countdown-copy"><span {...countdown.textAttrs('until')}>{countdown.t('until', 'until')}</span><strong {...countdown.dataAttrs('exam')}>{primaryExam.label}</strong><small {...countdown.dataAttrs('examDates')}>{prettyDate(primaryExam.date)}</small></div><span className="countdown-scribble" aria-hidden="true">↗</span></div>}
      <div className="countdown-footer">{secondaryExam && <div className="mini-exam"><span className={`mini-exam-dot ${secondaryExam.dot}`} /><span>{secondaryExam.label}</span>{secondaryExam.days === null ? <button onClick={() => navigate('/settings')}><T k="home:add-date">{"Add date"}</T></button> : <strong {...countdown.dataAttrs('daysLeft')}>{Math.max(0, secondaryExam.days)} days</strong>}</div>}<div className="mini-exam"><span className="mini-exam-dot orange" /><span {...countdown.textAttrs('chapters')}>{countdown.t('chapters', 'Chapters covered')}</span><strong {...countdown.dataAttrs('chaptersCovered')}>{completedChapters}/{totalChapters}</strong></div></div>
      <div className="countdown-star" aria-hidden="true">✳</div>
    </NotebookCard>,
    'home.streak': streakSlot.hidden ? null : <NotebookCard key="streak" className="streak-card accent-orange" {...streakSlot.attrs}>
      <div className="card-kicker"><span className="icon-tile orange"><Flame size={17} /></span> {streakSlot.text('kicker', 'STUDY STREAK')} <span className="tiny-star">✦</span></div>
      <div className="streak-number" {...streakSlot.dataAttrs('current')}>{streak.current}<span>day{streak.current === 1 ? '' : 's'}</span></div>
      <p className="streak-subtitle" {...streakSlot.textAttrs('subtitle')}>{streakSlot.t('subtitle', 'current study streak')}</p>
      <div className="streak-bottom"><span><strong {...streakSlot.dataAttrs('longest')}>{streak.longest}</strong> {streakSlot.text('longestLabel', 'longest')}</span><span className="streak-separator" /><span><strong {...streakSlot.dataAttrs('activeDays')}>{streak.weeklyConsistency}/7</strong> {streakSlot.text('weekLabel', 'active this week')}</span></div>
      <p className="jee-small jee-muted streak-rule" {...streakSlot.dataAttrs('rule')}>{streak.qualifyingToday ? 'Today counts.' : '15+ min of study, practice, a revision or a test counts.'}</p>
      <div className="streak-sun" aria-hidden="true">☼</div>
    </NotebookCard>
  }

  const asideParts: Record<string, ReactNode> = {
    'home.study-time': studyTime.hidden ? null : <NotebookCard key="study-time" className="study-progress-card accent-blue" {...studyTime.attrs}>
      <div className="card-kicker"><span className="icon-tile blue"><Timer size={16} /></span> {studyTime.text('kicker', 'DAILY STUDY TIME')}</div>
      <div className="progress-content"><ProgressRing value={progress} size={88} label={<span className="ring-value" {...studyTime.dataAttrs('percent')}>{Math.round(progress)}<small>%</small></span>} color="var(--subject-physics)" /><div className="study-progress-copy"><div className="study-time-value" {...studyTime.dataAttrs('minutes')}>{fmtDuration(todayMinutes)}<span> / {fmtDuration(data.settings.daily_study_goal_minutes)}</span></div><p {...studyTime.textAttrs('goalCaption')}>{studyTime.t('goalCaption', 'of your daily goal')}</p><button onClick={() => navigate('/focus')}><Timer size={14} /> {studyTime.text('start', 'Start a focus session')}</button></div></div>
      <ProgressBar value={progress} color="var(--subject-physics)" />
      <span className="study-doodle" aria-hidden="true">⌁</span>
    </NotebookCard>,
    'home.revisions': revisionsSlot.hidden ? null : <NotebookCard key="revisions" className="revisions-card accent-green" {...revisionsSlot.attrs}>
      <div className="section-card-head"><div className="card-kicker"><span className="icon-tile green"><AlarmClock size={16} /></span> {revisionsSlot.text('kicker', 'REVISION DESK')}</div><button className="text-link" onClick={() => navigate('/revision')}>{revisionsSlot.text('open', 'Open')} <ArrowUpRight size={14} /></button></div>
      <div className="revision-summary"><strong {...revisionsSlot.dataAttrs('count')}>{dayRevisions.length}</strong><span {...revisionsSlot.textAttrs('due')}>{revisionsSlot.t('due', 'due now')}</span>{dayRevisions.length > 0 && <span className="revision-dot-mark">•</span>}</div>
      {dayRevisions.length === 0 ? <p className="revision-empty" {...revisionsSlot.textAttrs('empty')}>{revisionsSlot.t('empty', 'Nothing due today.')}</p> : <div className="revision-peek-list" {...revisionsSlot.dataAttrs('revisions')}>{dayRevisions.slice(0, 3).map(revision => <RevisionPeek key={revision.id} revision={revision} data={data} onDone={async () => {
        const chapter = data.chapters.find(item => item.id === revision.chapter_id)
        try {
          const completed = await completeRevisionAction(
            revision, chapter,
            records => upsertMany('chapter_revisions', records),
            record => upsert('chapters', record),
            { revisions: data.revisions, gaps: data.settings.revision_gaps, today }
          )
          if (completed) notify('Revision done.')
        } catch (error) { notify(error instanceof Error ? error.message : 'Could not mark revision complete.', 'error') }
      }} />)}</div>}
    </NotebookCard>,
    'home.tip': tipSlot.hidden ? null : <NotebookCard key="tip" className="smart-tip-card" {...tipSlot.attrs}>
      <div className="tip-top"><span className="tip-spark"><Sparkles size={16} /></span><span {...tipSlot.textAttrs('kicker')}>{tipSlot.t('kicker', 'STUDY TIP')}</span></div>
      <p {...tipSlot.dataAttrs('tip')}>{tip}</p><button className="tip-link" onClick={() => navigate('/analytics')}>{tipSlot.text('cta', 'See analytics')} <ArrowRight size={14} /></button>
      <span className="tip-pencil" aria-hidden="true">✎</span>
    </NotebookCard>
  }

  const gridParts: Record<string, ReactNode> = {
    'home.today-plan': plan.hidden ? null : <section key="plan" className="today-plan-block" {...plan.attrs}>
      <SectionHeading title={plan.t('title', "Today's plan")} note={`${doneTasks} of ${todayTasks.length} done`} action={<Button variant="secondary" size="sm" onClick={() => navigate('/planner?add=1')}><Plus size={16} /> {plan.t('addTask', 'Add task')}</Button>} />
      <NotebookCard className="today-plan-card">
        <div className="plan-card-top"><span className="handwriting-label" {...plan.textAttrs('listLabel')}>{plan.t('listLabel', 'Today’s tasks')}</span><span className="plan-date" {...plan.dataAttrs('date')}><CalendarDays size={14} /> {prettyDate(today, { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>
        {todayTasks.length === 0 ? <EmptyState icon={<BookOpen size={26} />} title={plan.t('empty', 'No tasks today.')} action={<Button variant="secondary" size="sm" onClick={() => navigate('/planner?add=1')}><Plus size={15} /> {plan.t('planTask', 'Plan a task')}</Button>} /> : <div className="task-list" {...plan.dataAttrs('tasks')}>
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
        {todayTasks.length > 0 && <button className="plan-footer-link" onClick={() => navigate('/planner')}>{plan.text('openPlanner', 'Open planner')} <ArrowUpRight size={14} /></button>}
        <span className="paper-clip" aria-hidden="true" />
      </NotebookCard>
    </section>,
    'home.aside': aside.hidden ? null : <aside key="aside" className="dashboard-aside" {...aside.attrs}>{asideOrder.map(id => asideParts[id])}</aside>
  }

  const bottomParts: Record<string, ReactNode> = {
    'home.checkpoint': checkpoint.hidden ? null : <CheckpointCard key="checkpoint" data={data} today={today} slot={checkpoint} onView={id => navigate(`/tests?view=${encodeURIComponent(id)}`)} onAdd={() => navigate('/tests?add=1')} />,
    'home.syllabus': syllabus.hidden ? null : <NotebookCard key="syllabus" className="syllabus-mini-card" {...syllabus.attrs}>
      <div className="syllabus-mini-head"><div><span className="eyebrow" {...syllabus.textAttrs('eyebrow')}>{syllabus.t('eyebrow', 'OVERALL')}</span><h3 {...syllabus.textAttrs('title')}>{syllabus.t('title', 'Syllabus progress')}</h3></div><ProgressRing value={totalChapters ? completedChapters / totalChapters * 100 : 0} size={62} label={<span className="ring-value small" {...syllabus.dataAttrs('percent')}>{Math.round(totalChapters ? completedChapters / totalChapters * 100 : 0)}<small>%</small></span>} /></div>
      {trackedSubjects.length === 0 ? <p className="subject-mini-hint"><T k="home:add-chapters-in-syllabus-to-track-a-subj">{"Add chapters in Syllabus to track progress."}</T></p> : <div className="subject-mini-bars" {...syllabus.dataAttrs('subjects')}>{trackedSubjects.slice(0, subjectLimit).map(subject => {
        const total = data.chapters.filter(item => item.subject === subject).length
        const done = data.chapters.filter(item => item.subject === subject && (item.status === 'Done' || item.status === 'Revised')).length
        return <div className="subject-mini-row" key={subject}><SubjectBadge subject={subject} /><ProgressBar value={total ? done / total * 100 : 0} color={subjectColor(subject)} /><span>{done}/{total}</span></div>
      })}</div>}
      <button className="syllabus-mini-link" onClick={() => navigate('/syllabus')}>{trackedSubjects.length > subjectLimit ? `See all ${trackedSubjects.length} subjects` : trackedSubjects.length ? 'See all chapters' : 'Open Syllabus'} <ChevronRight size={15} /></button>
    </NotebookCard>
  }

  const sections: Record<HomeSection, ReactNode> = {
    'home.header': <PageHeader key="header" layoutAttrs={header.attrs} eyebrow={new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date()).toUpperCase()} title={`Good ${getGreeting()}, ${data.settings.owner_name || data.profile?.display_name || 'future engineer'}.`} doodle={<span className="header-atom">✦</span>} />,
    'home.focus': <FocusIndicator key="focus" layoutAttrs={focusSlot.attrs} />,
    'home.hero': <section key="hero" className="hero-row" aria-label="Exam countdown and syllabus progress" {...hero.attrs}>{heroOrder.map(id => heroParts[id])}</section>,
    'home.exam-mode': examMode.active ? <div key="exam-mode" className="exam-mode-banner" role="status" {...examSlot.attrs}><span className="exam-mode-days" {...examSlot.dataAttrs('daysLeft')}>{examMode.daysLeft}</span><div><strong {...examSlot.dataAttrs('label')}>Exam Mode · {examMode.label}</strong><p>{examSlot.data('reason', examMode.reason)} {examSlot.text('focus', 'Revision, PYQs, mocks and weak areas come first.')}</p></div></div> : null,
    'home.study-now': studyNow.hidden ? null : <StudyNowCard key="study-now" layoutAttrs={studyNow.attrs} />,
    'home.grid': <div key="grid" className="dashboard-grid" {...grid.attrs}>{gridOrder.map(id => gridParts[id])}</div>,
    'home.snapshot': snapshot.hidden ? null : <HomeSnapshot key="snapshot" layoutAttrs={snapshot.attrs} />,
    'home.bottom': <section key="bottom" className="dashboard-bottom-row" {...bottom.attrs}>{bottomOrder.map(id => bottomParts[id])}</section>
  }

  return <div className="dashboard-page">{pageOrder.map(id => sections[id])}</div>
}

const HOME_SECTIONS = ['home.header', 'home.focus', 'home.hero', 'home.exam-mode', 'home.study-now', 'home.grid', 'home.snapshot', 'home.bottom'] as const
type HomeSection = (typeof HOME_SECTIONS)[number]

function CheckpointCard({ data, today, onView, onAdd, slot }: { data: AppData; today: string; onView: (id: string) => void; onAdd: () => void; slot: ReturnType<typeof useLayoutSlot> }) {
  const latest = latestTestOn(data, today)
  if (!latest) {
    return <NotebookCard className="quick-test-card" {...slot.attrs}>
      <div className="quick-test-illustration" aria-hidden="true"><NotebookPen size={25} /><span>✦</span></div>
      <div><span className="eyebrow" {...slot.textAttrs('emptyEyebrow')}>{slot.t('emptyEyebrow', 'LATEST TEST')}</span><h2 {...slot.textAttrs('emptyTitle')}>{slot.t('emptyTitle', 'No tests yet.')}</h2><p {...slot.textAttrs('emptyBody')}>{slot.t('emptyBody', 'Log a test, PYQ session or mock.')}</p></div>
      <Button onClick={onAdd}><Plus size={17} /> {slot.t('add', 'Add test')}</Button>
    </NotebookCard>
  }
  const score = getOverallTestScore(latest, data.testSubjectScores)
  const percent = score ? getOverallTestPercentage(latest, data.testSubjectScores) : null
  const result = score ? `${fmtNumber(score.marks, 1)} / ${fmtNumber(score.total, 1)}${percent === null ? '' : ` · ${Math.round(percent)}%`}` : 'Score not recorded'
  const countToday = data.tests.filter(test => test.test_date === today).length
  return <NotebookCard className="quick-test-card checkpoint-logged" {...slot.attrs}>
    <div className="quick-test-illustration" aria-hidden="true"><Check size={25} /><span>✦</span></div>
    <div><span className="eyebrow" {...slot.dataAttrs('count')}>{countToday > 1 ? `TODAY’S CHECKPOINTS · ${countToday}` : 'TODAY’S CHECKPOINT'}</span><h2 {...slot.dataAttrs('test')}>{latest.title}</h2><p {...slot.dataAttrs('marks')}>{latest.test_type} · {result}</p></div>
    <div className="checkpoint-actions">
      <Button variant="secondary" onClick={() => onView(latest.id)}><ArrowUpRight size={16} /> {slot.t('view', 'View it')}</Button>
      <Button variant="quiet" onClick={onAdd}><Plus size={16} /> {slot.t('addAnother', 'Add another test')}</Button>
    </div>
  </NotebookCard>
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
