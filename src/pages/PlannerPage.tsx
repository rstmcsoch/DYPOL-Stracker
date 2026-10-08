import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { addDays, endOfWeek, format, parseISO, startOfWeek } from 'date-fns'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, Check, ChevronDown, Clock3, Copy, GripVertical, Plus, Target, Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { Button, ConfirmDialog, Dialog, EmptyState, Field, NotebookCard, PageHeader, ProgressBar, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { createId } from '../lib/id'
import { goalSchema, MAX_COUNT_GOAL, MAX_WEEKLY_STUDY_HOURS } from '../lib/goal-validation'
import { taskInputSchema } from '../lib/task-validation'
import { indiaDate, indiaToday, prettyDate } from '../lib/date'
import { fmtDuration, fmtNumber } from '../lib/format'
import type { DailyTask, GoalType, Priority, Subject, WeeklyGoal } from '../types'
import { SUBJECTS } from '../types'

const goalTypes: { type: GoalType; title: string; unit: string }[] = [
  { type: 'study_hours', title: 'Study hours', unit: 'hours' }, { type: 'tests', title: 'Tests', unit: 'tests' },
  { type: 'chapters', title: 'Chapters', unit: 'chapters' }, { type: 'revisions', title: 'Revisions', unit: 'revisions' },
  { type: 'custom', title: 'Custom goal', unit: 'steps' }
]
const monday = (date: string) => format(startOfWeek(parseISO(`${date}T12:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd')
const weekDays = (start: string) => Array.from({ length: 7 }, (_, index) => format(addDays(parseISO(`${start}T12:00:00`), index), 'yyyy-MM-dd'))

export default function PlannerPage() {
  const { data, upsert, upsertMany, remove } = useData()
  const { notify } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [weekStart, setWeekStart] = useState(() => monday(indiaToday()))
  const [selectedDate, setSelectedDate] = useState(indiaToday())
  const [taskDialog, setTaskDialog] = useState(false)
  const [editingTask, setEditingTask] = useState<DailyTask | null>(null)
  const [goalDialog, setGoalDialog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DailyTask | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const days = useMemo(() => weekDays(weekStart), [weekStart])
  const tasks = data.tasks.filter(task => task.task_date === selectedDate).sort((a, b) => a.position - b.position)
  const goals = data.goals.filter(goal => goal.week_start === weekStart)

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
    if (!deleteTarget) return
    try { await remove('daily_tasks', deleteTarget); notify('Task deleted.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not delete task.', 'error') }
    setDeleteTarget(null)
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
    const parsed = goalSchema.safeParse(goal)
    if (!parsed.success) { notify(parsed.error.issues[0]?.message ?? 'Check the weekly goal.', 'error'); return }
    try { await upsert('weekly_goals', { ...goal, title: parsed.data.title, updated_at: new Date().toISOString() }); notify('Weekly goal saved.'); setGoalDialog(false) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save goal.', 'error') }
  }

  const todayTotal = tasks.length
  const doneTotal = tasks.filter(task => task.is_completed).length

  return <div className="content-page planner-page">
    <PageHeader eyebrow="MAKE SPACE FOR THE WORK" title="Planner" subtitle="A steady plan is a promise you can keep adjusting." doodle={<CalendarDays size={19} />} action={<Button onClick={() => { setEditingTask(null); setTaskDialog(true) }}><Plus size={17} /> Add task</Button>} />
    <div className="planner-main-grid">
      <div className="planner-primary">
        <NotebookCard className="week-card">
          <div className="week-card-head"><div><span className="handwriting-label">This week, on paper</span><p>{prettyDate(weekStart, { day: 'numeric', month: 'short' })} – {prettyDate(format(endOfWeek(parseISO(`${weekStart}T12:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd'), { day: 'numeric', month: 'short', year: 'numeric' })}</p></div><div className="week-arrows"><button onClick={() => moveWeek(-1)} aria-label="Previous week"><ArrowLeft size={17} /></button><button onClick={() => selectWeek(monday(indiaToday()))}>This week</button><button onClick={() => moveWeek(1)} aria-label="Next week"><ArrowRight size={17} /></button></div></div>
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
            {tasks.length === 0 ? <EmptyState icon={<CalendarDays size={24} />} title="A clear patch of paper." description="Add a task for this day. You can move or reschedule it whenever your plan changes." action={<Button variant="secondary" size="sm" onClick={() => { setEditingTask(null); setTaskDialog(true) }}><Plus size={15} /> Plan a task</Button>} /> : tasks.map((task, index) => <PlannerTaskRow key={task.id} task={task} chapter={data.chapters.find(chapter => chapter.id === task.chapter_id)} dragged={draggedId === task.id} onToggle={() => void toggleTask(task)} onEdit={() => { setEditingTask(task); setTaskDialog(true) }} onDuplicate={() => void duplicateTask(task)} onDelete={() => setDeleteTarget(task)} onDragStart={() => setDraggedId(task.id)} onDragEnd={() => setDraggedId(null)} onDrop={() => { const dragged = tasks.find(item => item.id === draggedId); if (dragged) void reorderTask(dragged, task); setDraggedId(null) }} onMove={direction => { const dest = tasks[index + direction]; if (dest) void reorderTask(task, dest) }} />)}
          </div>
          <div className="planner-card-footer"><span><GripVertical size={15} /> Drag to reorder. Edit a task to move dates.</span><span>{fmtDuration(tasks.reduce((sum, task) => sum + (task.is_completed ? task.estimated_minutes : 0), 0))} complete</span></div>
        </NotebookCard>
      </div>
      <aside className="planner-aside">
        <NotebookCard className="weekly-goals-card"><div className="weekly-goals-head"><div><span className="card-kicker"><span className="icon-tile orange"><Target size={16} /></span> WEEKLY GOALS</span><h2>Little promises</h2></div><button className="icon-button" aria-label="Add weekly goal" onClick={() => setGoalDialog(true)}><Plus size={17} /></button></div>
          {goals.length === 0 ? <div className="goals-empty"><span className="goal-sticker">✦</span><p>No goals set for this week.<br />Choose a target that feels useful, not punishing.</p><Button variant="secondary" size="sm" onClick={() => setGoalDialog(true)}><Plus size={15} /> Add a goal</Button></div> : <div className="weekly-goal-list">{goals.map(goal => {
            const current = getGoalProgress(goal, data)
            const pct = Math.min(100, current / goal.target * 100)
            return <div className="weekly-goal-item" key={goal.id}><div className="goal-title-row"><strong>{goal.title}</strong><button aria-label={`Delete ${goal.title} goal`} onClick={() => void remove('weekly_goals', goal).then(() => notify('Goal deleted.')).catch(() => notify('Could not delete goal.', 'error'))}><Trash2 size={14} /></button></div><div className="goal-numbers"><span>{fmtNumber(current, 1)} <small>{goal.unit}</small></span><span>of {fmtNumber(goal.target, 1)} {goal.unit}</span></div><ProgressBar value={pct} color="var(--accent)" /><div className="goal-progress-actions"><span>{Math.round(pct)}% of target</span>{goal.goal_type === 'custom' && <div><button onClick={() => void saveGoal({ ...goal, progress_value: Math.max(0, goal.progress_value - 1) })}>−</button><button onClick={() => void saveGoal({ ...goal, progress_value: goal.progress_value + 1 })}>+</button></div>}</div></div>
          })}</div>}
          <span className="goal-doodle" aria-hidden="true">◌</span>
        </NotebookCard>
        <NotebookCard className="planner-week-note"><span className="eyebrow">A NOTE TO SELF</span><p>Plans are drafts. Move the task, keep the intention.</p><div className="note-signature">keep going <span>♡</span></div></NotebookCard>
      </aside>
    </div>
    {taskDialog && <TaskDialog key={editingTask?.id ?? `new-${selectedDate}`} initial={editingTask} defaultDate={selectedDate} data={data} onClose={() => { setTaskDialog(false); setEditingTask(null) }} onSave={saveTask} />}
    {goalDialog && <GoalDialog weekStart={weekStart} onClose={() => setGoalDialog(false)} onSave={saveGoal} />}
    {deleteTarget && <ConfirmDialog title="Delete this task?" message={`“${deleteTarget.title}” will be removed from your plan.`} onCancel={() => setDeleteTarget(null)} onConfirm={() => void deleteTask()} />}
  </div>
}

function PlannerTaskRow({ task, chapter, dragged, onToggle, onEdit, onDuplicate, onDelete, onDragStart, onDragEnd, onDrop, onMove }: {
  task: DailyTask; chapter?: ReturnType<typeof useData>['data']['chapters'][number]; dragged: boolean;
  onToggle: () => void; onEdit: () => void; onDuplicate: () => void; onDelete: () => void; onDragStart: () => void; onDragEnd: () => void; onDrop: () => void; onMove: (direction: -1 | 1) => void
}) {
  return <article className={`planner-task-row ${task.is_completed ? 'task-done' : ''} ${dragged ? 'task-dragging' : ''}`} draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onDrop={event => { event.preventDefault(); onDrop() }} onDragOver={event => event.preventDefault()}>
    <span className="planner-task-grip"><GripVertical size={16} /></span><button className="task-check" onClick={onToggle} aria-label={task.is_completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`} aria-pressed={task.is_completed}><Check size={14} /></button>
    <div className="planner-task-copy"><strong>{task.title}</strong><div className="planner-task-meta">{task.subject && <SubjectBadge subject={task.subject} />}{chapter && <span>{chapter.name}</span>}<span><Clock3 size={12} /> {fmtDuration(task.estimated_minutes)}</span><span className={`priority-label label-${task.priority.toLowerCase()}`}>{task.priority}</span></div></div>
    <div className="planner-task-tools"><button onClick={() => onMove(-1)} aria-label="Move task up" title="Move up"><ArrowUp size={14} /></button><button onClick={() => onMove(1)} aria-label="Move task down" title="Move down"><ArrowDown size={14} /></button><button onClick={onDuplicate} aria-label="Duplicate task" title="Duplicate"><Copy size={14} /></button><button onClick={onEdit} aria-label="Edit or reschedule task" title="Edit"><ChevronDown size={14} /></button><button onClick={onDelete} aria-label="Delete task" title="Delete"><Trash2 size={14} /></button></div>
  </article>
}

function TaskDialog({ initial, defaultDate, data, onClose, onSave }: { initial: DailyTask | null; defaultDate: string; data: ReturnType<typeof useData>['data']; onClose: () => void; onSave: (task: DailyTask) => Promise<void> }) {
  const now = new Date().toISOString()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [subject, setSubject] = useState<Subject | ''>(initial?.subject ?? '')
  const [chapterId, setChapterId] = useState(initial?.chapter_id ?? '')
  const [minutes, setMinutes] = useState(initial?.estimated_minutes ?? 30)
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'Medium')
  const [date, setDate] = useState(initial?.task_date ?? defaultDate)
  const [saving, setSaving] = useState(false)
  const chapters = data.chapters.filter(chapter => !subject || chapter.subject === subject)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (saving) return; setSaving(true)
    const task: DailyTask = {
      id: initial?.id ?? createId(), title: title.trim(), subject: subject || null, chapter_id: chapterId || null,
      estimated_minutes: Number(minutes), priority, is_completed: initial?.is_completed ?? false,
      task_date: date, position: initial?.position ?? data.tasks.filter(item => item.task_date === date).length,
      created_at: initial?.created_at ?? now, updated_at: now
    }
    try { await onSave(task) } finally { setSaving(false) }
  }
  return <Dialog title={initial ? 'Edit your task' : 'Plan a study task'} subtitle="You can change the day later. A plan should flex with you." onClose={onClose}>
    <form className="form-stack" onSubmit={submit}><Field label="Task" required><input autoFocus required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Practice 15 integration problems" /></Field>
      <div className="form-grid two"><Field label="Date"><input type="date" required value={date} onChange={event => setDate(event.target.value)} /></Field><Field label="Estimated minutes"><input type="number" min="0" max="1440" step="1" value={minutes} onChange={event => setMinutes(Number(event.target.value))} /></Field></div>
      <div className="form-grid three"><Field label="Subject"><select value={subject} onChange={event => { setSubject(event.target.value as Subject | ''); setChapterId('') }}><option value="">General</option>{SUBJECTS.map(item => <option key={item}>{item}</option>)}</select></Field><Field label="Chapter"><select value={chapterId} onChange={event => setChapterId(event.target.value)}><option value="">None</option>{chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}</select></Field><Field label="Priority"><select value={priority} onChange={event => setPriority(event.target.value as Priority)}><option>High</option><option>Medium</option><option>Low</option></select></Field></div>
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>{initial ? 'Save task' : 'Add task'}</Button></div>
    </form>
  </Dialog>
}

function GoalDialog({ weekStart, onClose, onSave }: { weekStart: string; onClose: () => void; onSave: (goal: WeeklyGoal) => Promise<void> }) {
  const [type, setType] = useState<GoalType>('study_hours')
  const [title, setTitle] = useState('Study hours')
  const [target, setTarget] = useState('10')
  const [unit, setUnit] = useState('hours')
  const [saving, setSaving] = useState(false)
  const changeType = (next: GoalType) => { setType(next); const item = goalTypes.find(goal => goal.type === next); if (item) { setTitle(item.title); setUnit(item.unit) } }
  const studyHours = type === 'study_hours'
  const submit = async (event: FormEvent) => { event.preventDefault(); if (saving) return; setSaving(true); const now = new Date().toISOString(); try { await onSave({ id: createId(), goal_type: type, title, target: Number(target), progress_value: 0, week_start: weekStart, unit, created_at: now, updated_at: now }) } finally { setSaving(false) } }
  return <Dialog title="Set a weekly goal" subtitle={`For the week of ${prettyDate(weekStart)}.`} onClose={onClose}>
    <form className="form-stack" noValidate onSubmit={submit}><Field label="Goal type"><select value={type} onChange={event => changeType(event.target.value as GoalType)}>{goalTypes.map(item => <option key={item.type} value={item.type}>{item.title}</option>)}</select></Field><Field label="Name"><input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></Field><div className="form-grid two"><Field label="Target"><input type="number" min={studyHours ? 0.5 : 1} max={studyHours ? MAX_WEEKLY_STUDY_HOURS : MAX_COUNT_GOAL} step={studyHours ? 0.5 : 1} required value={target} onChange={event => setTarget(event.target.value)} /></Field><Field label="Unit"><input maxLength={30} value={unit} onChange={event => setUnit(event.target.value)} /></Field></div><p className="goal-autotrack-note">Study hours, tests, chapters and revisions update from your real activity. Custom goals can be ticked up manually.</p><div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>Save weekly goal</Button></div></form>
  </Dialog>
}

function getGoalProgress(goal: WeeklyGoal, data: ReturnType<typeof useData>['data']): number {
  const end = format(addDays(parseISO(`${goal.week_start}T12:00:00`), 6), 'yyyy-MM-dd')
  if (goal.goal_type === 'study_hours') return data.sessions.filter(session => indiaDate(session.started_at) >= goal.week_start && indiaDate(session.started_at) <= end).reduce((sum, session) => sum + session.duration_minutes, 0) / 60
  if (goal.goal_type === 'tests') return data.tests.filter(test => test.test_date >= goal.week_start && test.test_date <= end).length
  if (goal.goal_type === 'chapters') return data.chapters.filter(chapter => chapter.completed_on && chapter.completed_on >= goal.week_start && chapter.completed_on <= end).length
  if (goal.goal_type === 'revisions') return data.revisions.filter(revision => revision.completed_at && indiaDate(revision.completed_at) >= goal.week_start && indiaDate(revision.completed_at) <= end).length
  return goal.progress_value
}
