import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { addDays, endOfWeek, format, parseISO, startOfWeek } from 'date-fns'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, Check, ChevronDown, Clock3, Copy, GripVertical, Plus, Target, Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { TOPIC_MAX, topicCounterText } from '../lib/planner-fields'
import { GroupedChapterOptions } from '../components/GroupedChapterOptions'
import { Button, ConfirmDialog, Dialog, EmptyState, Field, NotebookCard, PageHeader, ProgressBar, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { createId } from '../lib/id'
import { goalSchema, MAX_COUNT_GOAL, MAX_WEEKLY_STUDY_HOURS } from '../lib/goal-validation'
import { goalProgress } from '../lib/jee/goals'
import { taskInputSchema } from '../lib/task-validation'
import { indiaToday, plusDays, prettyDate } from '../lib/date'
import { MAX_INPUT_DATE, MIN_INPUT_DATE, isValidInputDate } from '../lib/date-input'
import { fmtDuration, fmtNumber } from '../lib/format'
import type { DailyTask, GoalType, Priority, Subject, WeeklyGoal } from '../types'
import { useExamSubjects } from '../lib/exams/useExamSubjects'
import { T } from '../lib/student-layout/T'
import { usePageSlots } from '../lib/student-layout/use-layout'

const goalTypes: { type: GoalType; title: string; unit: string }[] = [
  { type: 'study_hours', title: 'Study hours', unit: 'hours' }, { type: 'tests', title: 'Tests', unit: 'tests' },
  { type: 'chapters', title: 'Chapters', unit: 'chapters' }, { type: 'revisions', title: 'Revisions', unit: 'revisions' },
  { type: 'custom', title: 'Custom goal', unit: 'steps' }
]
const monday = (date: string) => format(startOfWeek(parseISO(`${date}T12:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd')
const weekDays = (start: string) => Array.from({ length: 7 }, (_, index) => format(addDays(parseISO(`${start}T12:00:00`), index), 'yyyy-MM-dd'))

export default function PlannerPage() {
  const sl = usePageSlots('planner')
  const { data, upsert, upsertMany, remove } = useData()
  const { notify } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [weekStart, setWeekStart] = useState(() => monday(indiaToday()))
  const [selectedDate, setSelectedDate] = useState(indiaToday())
  const [taskDialog, setTaskDialog] = useState(false)
  const [editingTask, setEditingTask] = useState<DailyTask | null>(null)
  const [goalDialog, setGoalDialog] = useState(false)
  const [busyGoalIds, setBusyGoalIds] = useState<Set<string>>(() => new Set())
  const busyGoalIdsRef = useRef(new Set<string>())
  const [deleteTarget, setDeleteTarget] = useState<DailyTask | null>(null)
  const [deletingTask, setDeletingTask] = useState(false)
  const deletingTaskRef = useRef(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const days = useMemo(() => weekDays(weekStart), [weekStart])
  const tasks = data.tasks.filter(task => task.task_date === selectedDate).sort((a, b) => a.position - b.position)
  const goals = data.goals.filter(goal => goal.week_start === weekStart)

  // Deep links from search (Cmd+K) or elsewhere: /planner?date=YYYY-MM-DD&task=<id> opens that
  // task's week and day, then scrolls to and highlights the task so it can be edited or deleted.
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null)
  useEffect(() => {
    const dateParam = searchParams.get('date')
    const taskParam = searchParams.get('task')
    if (!dateParam && !taskParam) return
    const target = taskParam ? data.tasks.find(task => task.id === taskParam) : undefined
    const day = target?.task_date ?? (dateParam && isValidInputDate(dateParam) ? dateParam : null)
    if (day) { setWeekStart(monday(day)); setSelectedDate(day) }
    if (target) setFocusTaskId(target.id)
    // Keep the params until the task has loaded, so a cold load still lands on it.
    if (!taskParam || target) {
      const params = new URLSearchParams(searchParams); params.delete('date'); params.delete('task'); setSearchParams(params, { replace: true })
    }
  }, [searchParams, setSearchParams, data.tasks])
  useEffect(() => {
    if (!focusTaskId) return
    const row = document.getElementById(`planner-task-${focusTaskId}`)
    if (!row) return
    row.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    row.focus({ preventScroll: true })
  }, [focusTaskId, selectedDate])
  const jumpToDate = (value: string) => {
    if (!isValidInputDate(value)) return
    setWeekStart(monday(value)); setSelectedDate(value); setFocusTaskId(null)
  }

  useEffect(() => {
    if (searchParams.get('add') === '1') {
      setTaskDialog(true)
      const params = new URLSearchParams(searchParams); params.delete('add'); setSearchParams(params, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const selectWeek = (nextStart: string) => { setWeekStart(nextStart); setSelectedDate(nextStart) }
  const moveWeek = (offset: number) => selectWeek(format(addDays(parseISO(`${weekStart}T12:00:00`), offset * 7), 'yyyy-MM-dd'))

  const saveTask = async (task: DailyTask) => {
    const parsed = taskInputSchema.safeParse(task)
    if (!parsed.success) { notify(parsed.error.issues[0]?.message ?? 'Check the task details.', 'error'); return }
    try { await upsert('daily_tasks', { ...task, title: task.title.trim(), updated_at: new Date().toISOString() }); notify(editingTask ? 'Task updated.' : 'Task added to your plan.'); setTaskDialog(false); setEditingTask(null) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save task.', 'error') }
  }
  const toggleTask = async (task: DailyTask) => {
    try { await upsert('daily_tasks', { ...task, is_completed: !task.is_completed, updated_at: new Date().toISOString() }) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not update task.', 'error') }
  }
  const duplicateTask = async (task: DailyTask) => {
    const now = new Date().toISOString()
    try { await upsert('daily_tasks', { ...task, id: createId(), title: `${task.title} (copy)`, is_completed: false, position: tasks.length, created_at: now, updated_at: now }); notify('Task duplicated.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not duplicate task.', 'error') }
  }
  const deleteTask = async () => {
    if (!deleteTarget || deletingTaskRef.current) return
    deletingTaskRef.current = true
    setDeletingTask(true)
    try { await remove('daily_tasks', deleteTarget); notify('Task deleted.'); setDeleteTarget(null) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not delete task.', 'error') }
    finally { deletingTaskRef.current = false; setDeletingTask(false) }
  }
  const reorderTask = async (task: DailyTask, target: DailyTask) => {
    if (task.id === target.id) return
    const reordered = [...tasks]
    const from = reordered.findIndex(item => item.id === task.id)
    const to = reordered.findIndex(item => item.id === target.id)
    if (from < 0 || to < 0) return
    const [moved] = reordered.splice(from, 1)
    if (moved) reordered.splice(to, 0, moved)
    try { await upsertMany('daily_tasks', reordered.map((item, position) => ({ ...item, position, updated_at: new Date().toISOString() }))) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not reorder tasks.', 'error') }
  }

  const saveGoal = async (goal: WeeklyGoal) => {
    if (busyGoalIdsRef.current.has(goal.id)) return
    busyGoalIdsRef.current.add(goal.id)
    setBusyGoalIds(new Set(busyGoalIdsRef.current))
    try {
      const parsed = goalSchema.safeParse(goal)
      if (!parsed.success) { notify(parsed.error.issues[0]?.message ?? 'Check the weekly goal.', 'error'); return }
      await upsert('weekly_goals', { ...goal, title: parsed.data.title, updated_at: new Date().toISOString() })
      notify('Weekly goal saved.')
      setGoalDialog(false)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save goal.', 'error') }
    finally {
      busyGoalIdsRef.current.delete(goal.id)
      setBusyGoalIds(new Set(busyGoalIdsRef.current))
    }
  }

  const todayTotal = tasks.length
  const doneTotal = tasks.filter(task => task.is_completed).length

  return <div className="content-page planner-page">
    <PageHeader layoutId="planner.header" title="Planner" doodle={<CalendarDays size={19} />} action={<Button onClick={() => { setEditingTask(null); setTaskDialog(true) }}><Plus size={17} />{' '}<T k="planner:add-task">{"Add task"}</T></Button>} />
    <div {...sl.attrs('grid')} className="planner-main-grid">
      <div className="planner-primary">
        <NotebookCard className="week-card">
          <div className="week-card-head"><div><span className="handwriting-label"><T k="planner:this-week-on-paper">{"This week"}</T></span><p>{prettyDate(weekStart, { day: 'numeric', month: 'short' })} – {prettyDate(format(endOfWeek(parseISO(`${weekStart}T12:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd'), { day: 'numeric', month: 'short', year: 'numeric' })}</p></div><div className="week-arrows"><button onClick={() => moveWeek(-1)} aria-label="Previous week"><ArrowLeft size={17} /></button><button onClick={() => selectWeek(monday(indiaToday()))}><T k="planner:this-week">{"This week"}</T></button><button onClick={() => moveWeek(1)} aria-label="Next week"><ArrowRight size={17} /></button><input type="date" className="planner-jump-date" aria-label="Jump to date" title="Jump to any date" min={MIN_INPUT_DATE} max={MAX_INPUT_DATE} value={selectedDate} onChange={event => jumpToDate(event.target.value)} /></div></div>
          <div className="week-day-strip">{days.map(day => {
            const dayTasks = data.tasks.filter(task => task.task_date === day)
            const done = dayTasks.filter(task => task.is_completed).length
            const isToday = day === indiaToday()
            return <button className={`week-day ${day === selectedDate ? 'selected' : ''} ${isToday ? 'today' : ''}`} key={day} onClick={() => setSelectedDate(day)} aria-pressed={day === selectedDate}>
              <span>{new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(parseISO(`${day}T12:00:00`))}</span><strong>{parseISO(`${day}T12:00:00`).getDate()}</strong>{dayTasks.length > 0 && <i className={done === dayTasks.length ? 'day-dot complete' : 'day-dot'} />}
            </button>
          })}</div>
          <div className="selected-day-head"><div><span className="eyebrow">{selectedDate === indiaToday() ? 'TODAY' : new Intl.DateTimeFormat('en-IN', { weekday: 'long' }).format(parseISO(`${selectedDate}T12:00:00`)).toUpperCase()}</span><h2>{prettyDate(selectedDate, { day: 'numeric', month: 'long' })}</h2></div><span className="task-count-label">{doneTotal} / {todayTotal} complete</span></div>
          <div className="planner-task-list" onDragOver={event => event.preventDefault()}>
            {tasks.length === 0 ? <EmptyState lk="planner:nothing-planned-for-this-day" icon={<CalendarDays size={24} />} title="Nothing planned for this day." action={<Button variant="secondary" size="sm" onClick={() => { setEditingTask(null); setTaskDialog(true) }}><Plus size={15} />{' '}<T k="planner:plan-a-task">{"Plan a task"}</T></Button>} /> : tasks.map((task, index) => <PlannerTaskRow key={task.id} task={task} highlighted={focusTaskId === task.id} chapter={data.chapters.find(chapter => chapter.id === task.chapter_id)} dragged={draggedId === task.id} onToggle={() => void toggleTask(task)} onEdit={() => { setEditingTask(task); setTaskDialog(true) }} onDuplicate={() => void duplicateTask(task)} onDelete={() => setDeleteTarget(task)} onDragStart={() => setDraggedId(task.id)} onDragEnd={() => setDraggedId(null)} onDrop={() => { const dragged = tasks.find(item => item.id === draggedId); if (dragged) void reorderTask(dragged, task); setDraggedId(null) }} onMove={direction => { const dest = tasks[index + direction]; if (dest) void reorderTask(task, dest) }} />)}
          </div>
          <div className="planner-card-footer"><span><GripVertical size={15} />{' '}<T k="planner:drag-to-reorder-edit-a-task-to-move-date">{"Drag to reorder. Edit to change the date."}</T></span><span>{fmtDuration(tasks.reduce((sum, task) => sum + (task.is_completed ? task.estimated_minutes : 0), 0))} complete</span></div>
        </NotebookCard>
      </div>
      <aside className="planner-aside">
        <NotebookCard className="weekly-goals-card"><div className="weekly-goals-head"><div><span className="card-kicker"><span className="icon-tile orange"><Target size={16} /></span>{' '}<T k="planner:weekly-goals">{"WEEKLY GOALS"}</T></span><h2><T k="planner:little-promises">{"This week’s goals"}</T></h2></div><button className="icon-button" aria-label="Add weekly goal" onClick={() => setGoalDialog(true)}><Plus size={17} /></button></div>
          {goals.length === 0 ? <div className="goals-empty"><span className="goal-sticker">✦</span><p><T k="planner:no-goals-set-for-this-week">{"No goals set for this week."}</T><br /><T k="planner:choose-a-target-that-feels-useful-not-pu">{"Set a realistic target."}</T></p><Button variant="secondary" size="sm" onClick={() => setGoalDialog(true)}><Plus size={15} />{' '}<T k="planner:add-a-goal">{"Add a goal"}</T></Button></div> : <div className="weekly-goal-list">{goals.map(goal => {
            const current = getGoalProgress(goal, data)
            const rawPct = goal.target > 0 ? current / goal.target * 100 : 0
            const pct = Math.min(100, rawPct)
            const over = goal.target > 0 && current > goal.target ? current - goal.target : 0
            return <div className={`weekly-goal-item${over > 0 ? ' goal-over' : ''}`} key={goal.id}><div className="goal-title-row"><strong>{goal.title}</strong><button aria-label={`Delete ${goal.title} goal`} onClick={() => void remove('weekly_goals', goal).then(() => notify('Goal deleted.')).catch(() => notify('Could not delete goal.', 'error'))}><Trash2 size={14} /></button></div><div className="goal-numbers"><span>{fmtNumber(current, 1)} <small>{goal.unit}</small></span><span>of {fmtNumber(goal.target, 1)} {goal.unit}</span></div><ProgressBar value={pct} color={over > 0 ? 'var(--green)' : 'var(--accent)'} /><div className="goal-progress-actions"><span>{Math.round(rawPct)}% of target{over > 0 && <span className="goal-over-badge" data-testid="goal-over-badge">+{fmtNumber(over, 1)} over</span>}</span>{goal.goal_type === 'custom' && <div><button disabled={busyGoalIds.has(goal.id)} onClick={() => void saveGoal({ ...goal, progress_value: Math.max(0, goal.progress_value - 1) })} aria-label={`Decrease ${goal.title} progress`}>−</button><button disabled={busyGoalIds.has(goal.id)} onClick={() => void saveGoal({ ...goal, progress_value: goal.progress_value + 1 })} aria-label={`Increase ${goal.title} progress`}>+</button></div>}</div></div>
          })}</div>}
          <span className="goal-doodle" aria-hidden="true">◌</span>
        </NotebookCard>
        <NotebookCard className="planner-week-note"><span className="eyebrow"><T k="planner:a-note-to-self">{"TIP"}</T></span><p><T k="planner:plans-are-drafts-move-the-task-keep-the">{"Plans can change. Move tasks anytime."}</T></p><div className="note-signature"><T k="planner:keep-going">{"keep going"}</T>{' '}<span>♡</span></div></NotebookCard>
      </aside>
    </div>
    {taskDialog && <TaskDialog key={editingTask?.id ?? `new-${selectedDate}`} initial={editingTask} defaultDate={selectedDate} data={data} onClose={() => { setTaskDialog(false); setEditingTask(null) }} onSave={saveTask} />}
    {goalDialog && <GoalDialog weekStart={weekStart} onClose={() => setGoalDialog(false)} onSave={saveGoal} />}
    {deleteTarget && <ConfirmDialog title={`Delete “${deleteTarget.title}”?`} message="This task will be removed. You can undo briefly." onCancel={() => setDeleteTarget(null)} onConfirm={() => void deleteTask()} loading={deletingTask} />}
  </div>
}

function PlannerTaskRow({ task, highlighted = false, chapter, dragged, onToggle, onEdit, onDuplicate, onDelete, onDragStart, onDragEnd, onDrop, onMove }: {
  task: DailyTask; highlighted?: boolean; chapter?: ReturnType<typeof useData>['data']['chapters'][number]; dragged: boolean;
  onToggle: () => void; onEdit: () => void; onDuplicate: () => void; onDelete: () => void; onDragStart: () => void; onDragEnd: () => void; onDrop: () => void; onMove: (direction: -1 | 1) => void
}) {
  return <article id={`planner-task-${task.id}`} tabIndex={-1} aria-current={highlighted ? 'true' : undefined} className={`planner-task-row ${task.is_completed ? 'task-done' : ''} ${dragged ? 'task-dragging' : ''} ${highlighted ? 'task-highlight' : ''}`} draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onDrop={event => { event.preventDefault(); onDrop() }} onDragOver={event => event.preventDefault()}>
    <span className="planner-task-grip"><GripVertical size={16} /></span><button className="task-check" onClick={onToggle} aria-label={task.is_completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`} aria-pressed={task.is_completed}><Check size={14} /></button>
    <div className="planner-task-copy"><strong>{task.title}</strong><div className="planner-task-meta">{task.subject && <SubjectBadge subject={task.subject} />}{chapter && <span>{chapter.name}</span>}{task.topic && <span className="planner-task-topic">{task.topic}</span>}<span><Clock3 size={12} /> {fmtDuration(task.estimated_minutes)}</span><span className={`priority-label label-${task.priority.toLowerCase()}`}>{task.priority}</span></div></div>
    <div className="planner-task-tools"><button onClick={() => onMove(-1)} aria-label="Move task up" title="Move up"><ArrowUp size={14} /></button><button onClick={() => onMove(1)} aria-label="Move task down" title="Move down"><ArrowDown size={14} /></button><button onClick={onDuplicate} aria-label="Duplicate task" title="Duplicate"><Copy size={14} /></button><button onClick={onEdit} aria-label="Edit or reschedule task" title="Edit"><ChevronDown size={14} /></button><button onClick={onDelete} aria-label="Delete task" title="Delete"><Trash2 size={14} /></button></div>
  </article>
}

function TaskDialog({ initial, defaultDate, data, onClose, onSave }: { initial: DailyTask | null; defaultDate: string; data: ReturnType<typeof useData>['data']; onClose: () => void; onSave: (task: DailyTask) => Promise<void> }) {
  const taskSubjects = useExamSubjects(initial?.subject)
  const { notify } = useToast()
  const now = new Date().toISOString()
  const [taskId] = useState(() => initial?.id ?? createId())
  const [title, setTitle] = useState(initial?.title ?? '')
  const [subject, setSubject] = useState<Subject | ''>(initial?.subject ?? '')
  const [chapterId, setChapterId] = useState(initial?.chapter_id ?? '')
  const [topic, setTopic] = useState(initial?.topic ?? '')
  const [minutes, setMinutes] = useState(String(initial?.estimated_minutes ?? 30))
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'Medium')
  const [date, setDate] = useState(initial?.task_date ?? defaultDate)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const savingRef = useRef(false)
  const chapters = data.chapters.filter(chapter => !subject || chapter.subject === subject)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (savingRef.current) return
    const parsed = taskInputSchema.safeParse({ title: title.trim(), topic: topic.trim() || null, estimated_minutes: minutes.trim() === '' ? null : Number(minutes), task_date: date })
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) next[String(issue.path[0] ?? 'form')] ??= issue.message
      setErrors(next)
      notify('Please correct the highlighted task fields.', 'error')
      return
    }
    if (chapterId) {
      const chapter = data.chapters.find(item => item.id === chapterId)
      if (!chapter || (subject && chapter.subject !== subject)) {
        setErrors({ chapter_id: 'Choose a chapter that belongs to the selected subject.' })
        notify('Please correct the highlighted task fields.', 'error')
        return
      }
    }
    savingRef.current = true
    setSaving(true)
    const task: DailyTask = {
      id: taskId, title: parsed.data.title, subject: subject || null, chapter_id: chapterId || null, topic: parsed.data.topic ?? null,
      estimated_minutes: parsed.data.estimated_minutes, priority, is_completed: initial?.is_completed ?? false,
      task_date: parsed.data.task_date, position: initial?.position ?? data.tasks.filter(item => item.task_date === date).length,
      created_at: initial?.created_at ?? now, updated_at: now
    }
    try { await onSave(task) } finally { savingRef.current = false; setSaving(false) }
  }
  const clearError = (key: string) => setErrors(current => { const next = { ...current }; delete next[key]; return next })
  return <Dialog title={initial ? 'Edit your task' : 'Plan a study task'}  onClose={onClose}>
    <form className="form-stack" noValidate onSubmit={submit}><Field lk="planner:l-task" label="Task" required error={errors.title}><input autoFocus required maxLength={200} value={title} onChange={event => { setTitle(event.target.value); clearError('title') }} placeholder="e.g. Practice 15 integration problems" /></Field>
      <div className="form-grid two"><div className="planner-date-field"><DateQuickChips value={date} onChange={value => { setDate(value); clearError('task_date') }} /><Field lk="planner:l-date" label="Date" error={errors.task_date}><input type="date" required value={date} min={MIN_INPUT_DATE} max={MAX_INPUT_DATE} onChange={event => { setDate(event.target.value); clearError('task_date') }} /></Field></div><Field lk="planner:estimated-minutes" label="Estimated minutes" error={errors.estimated_minutes}><input type="number" min="0" max="1440" step="1" value={minutes} onChange={event => { setMinutes(event.target.value); clearError('estimated_minutes') }} /></Field></div>
      <div className="form-grid three"><Field lk="planner:subject" label="Subject"><select value={subject} onChange={event => { setSubject(event.target.value as Subject | ''); setChapterId('') }}><option value="">General</option>{taskSubjects.map(item => <option key={item}>{item}</option>)}</select></Field><Field lk="planner:chapter" label="Chapter" error={errors.chapter_id}><select value={chapterId} onChange={event => { setChapterId(event.target.value); clearError('chapter_id') }}><option value="">None</option>{subject ? chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>) : <GroupedChapterOptions chapters={chapters} subjectOrder={taskSubjects} />}</select></Field><Field lk="planner:priority" label="Priority"><select value={priority} onChange={event => setPriority(event.target.value as Priority)}><option>High</option><option>Medium</option><option>Low</option></select></Field></div>
      <Field lk="planner:topic-subtopic" lk2="planner:optional-e-g-gausss-law-or-integration-b" label="Topic / subtopic" hint="Optional, e.g. a topic name." error={errors.topic}><input maxLength={TOPIC_MAX} value={topic} onChange={event => { setTopic(event.target.value); clearError('topic') }} placeholder="Optional" /><span className={`char-counter ${topic.length >= TOPIC_MAX ? 'is-full' : topic.length >= TOPIC_MAX - 20 ? 'is-near' : ''}`} aria-live="polite" data-testid="topic-counter">{topicCounterText(topic.length)}</span></Field>
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose} disabled={saving}><T k="planner:cancel">{"Cancel"}</T></Button><Button type="submit" loading={saving}>{initial ? 'Save task' : 'Add task'}</Button></div>
    </form>
  </Dialog>
}

function GoalDialog({ weekStart, onClose, onSave }: { weekStart: string; onClose: () => void; onSave: (goal: WeeklyGoal) => Promise<void> }) {
  const { notify } = useToast()
  const [goalId] = useState(() => createId())
  const [type, setType] = useState<GoalType>('study_hours')
  const [title, setTitle] = useState('Study hours')
  const [target, setTarget] = useState('10')
  const [unit, setUnit] = useState('hours')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const savingRef = useRef(false)
  const changeType = (next: GoalType) => { setType(next); const item = goalTypes.find(goal => goal.type === next); if (item) { setTitle(item.title); setUnit(item.unit) }; setErrors({}) }
  const studyHours = type === 'study_hours'
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (savingRef.current) return
    const now = new Date().toISOString()
    const goal: WeeklyGoal = { id: goalId, goal_type: type, title, target: target.trim() === '' ? Number.NaN : Number(target), progress_value: 0, week_start: weekStart, unit, created_at: now, updated_at: now }
    const parsed = goalSchema.safeParse(goal)
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) next[String(issue.path[0] ?? 'form')] ??= issue.message
      setErrors(next)
      notify('Please correct the highlighted goal fields.', 'error')
      return
    }
    savingRef.current = true
    setSaving(true)
    try { await onSave({ ...goal, title: parsed.data.title }) }
    finally { savingRef.current = false; setSaving(false) }
  }
  return <Dialog lk="planner:set-a-weekly-goal" title="Set a weekly goal" subtitle={`For the week of ${prettyDate(weekStart)}.`} onClose={onClose}>
    <form className="form-stack" noValidate onSubmit={submit}><Field lk="planner:goal-type" label="Goal type"><select value={type} onChange={event => changeType(event.target.value as GoalType)}>{goalTypes.map(item => <option key={item.type} value={item.type}>{item.title}</option>)}</select></Field><Field lk="planner:l-name" label="Name" error={errors.title}><input required maxLength={120} value={title} onChange={event => { setTitle(event.target.value); setErrors(current => { const next = { ...current }; delete next.title; return next }) }} /></Field><div className="form-grid two"><Field lk="planner:target" label="Target" error={errors.target}><input type="number" min={studyHours ? 0.5 : 1} max={studyHours ? MAX_WEEKLY_STUDY_HOURS : MAX_COUNT_GOAL} step={studyHours ? 0.5 : 1} required value={target} onChange={event => { setTarget(event.target.value); setErrors(current => { const next = { ...current }; delete next.target; return next }) }} /></Field><Field lk="planner:unit" label="Unit"><input maxLength={30} value={unit} onChange={event => setUnit(event.target.value)} /></Field></div><p className="goal-autotrack-note"><T k="planner:study-hours-tests-chapters-and-revisions">{"Hours, tests, chapters and revisions update automatically. Custom goals are manual."}</T></p><div className="dialog-actions"><Button variant="secondary" onClick={onClose} disabled={saving}><T k="planner:cancel">{"Cancel"}</T></Button><Button type="submit" loading={saving}><T k="planner:save-weekly-goal">{"Save weekly goal"}</T></Button></div></form>
  </Dialog>
}

/** Kept as the page-local name; the counting lives in lib/jee/goals so Home shows the same number. */
const getGoalProgress = (goal: WeeklyGoal, data: ReturnType<typeof useData>['data']): number => goalProgress(goal, data)

function DateQuickChips({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const today = indiaToday()
  const chips = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: plusDays(today, 1) },
    { label: '+1 week', date: plusDays(today, 7) }
  ]
  return <div className="jee-chip-row" role="group" aria-label="Quick dates">
    {chips.map(chip => <button key={chip.label} type="button" className={`jee-chip ${value === chip.date ? 'active' : ''}`} aria-pressed={value === chip.date} onClick={() => onChange(chip.date)}>{chip.label}</button>)}
  </div>
}

