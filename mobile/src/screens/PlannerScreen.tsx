import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { addDays, endOfWeek, format, parseISO, startOfWeek } from 'date-fns'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { useTheme } from '../contexts/AppearanceContext'
import { createId } from '../shared/lib/id'
import { goalSchema, MAX_COUNT_GOAL, MAX_WEEKLY_STUDY_HOURS } from '../shared/lib/goal-validation'
import { taskInputSchema } from '../shared/lib/task-validation'
import { indiaDate, indiaToday, prettyDate } from '../shared/lib/date'
import { fmtDuration, fmtNumber } from '../shared/lib/format'
import { SUBJECTS, type AppData, type DailyTask, type GoalType, type Priority, type Subject, type WeeklyGoal } from '../shared/types'
import { ArrowDown, ArrowUp, CalendarDays, Check, Clock, Copy, Plus, Target, Trash2 } from '../components/icons'
import { Button } from '../components/ui/Button'
import { ConfirmDialog, Dialog } from '../components/ui/Overlays'
import { Screen } from '../components/ui/Screen'
import { DateField, SelectField, TextField } from '../components/ui/Forms'
import { ProgressBar } from '../components/ui/Progress'
import { EmptyState, NotebookCard, PageHeader, SubjectBadge } from '../components/ui/Surfaces'

const goalTypes: { type: GoalType; title: string; unit: string }[] = [
  { type: 'study_hours', title: 'Study hours', unit: 'hours' }, { type: 'tests', title: 'Tests', unit: 'tests' },
  { type: 'chapters', title: 'Chapters', unit: 'chapters' }, { type: 'revisions', title: 'Revisions', unit: 'revisions' },
  { type: 'custom', title: 'Custom goal', unit: 'steps' }
]
const monday = (date: string) => format(startOfWeek(parseISO(`${date}T12:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd')
const weekDays = (start: string) => Array.from({ length: 7 }, (_, index) => format(addDays(parseISO(`${start}T12:00:00`), index), 'yyyy-MM-dd'))

/** Daily planner with a week strip, dated tasks, duplication, reordering, and weekly goals measured from real records. */
export function PlannerScreen() {
  const theme = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ add?: string }>()
  const { data, upsert, upsertMany, remove, refresh, syncState } = useData()
  const { notify } = useToast()
  const [weekStart, setWeekStart] = useState(() => monday(indiaToday()))
  const [selectedDate, setSelectedDate] = useState(indiaToday())
  const [taskDialog, setTaskDialog] = useState(false)
  const [editingTask, setEditingTask] = useState<DailyTask | null>(null)
  const [goalDialog, setGoalDialog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DailyTask | null>(null)
  const [deletingTask, setDeletingTask] = useState(false)
  const [deleteGoal, setDeleteGoal] = useState<WeeklyGoal | null>(null)
  const days = useMemo(() => weekDays(weekStart), [weekStart])
  const tasks = data.tasks.filter(task => task.task_date === selectedDate).sort((a, b) => a.position - b.position)
  const goals = data.goals.filter(goal => goal.week_start === weekStart)

  // A "?add=1" link opens the task dialog once; the parameter is cleared straight after.
  const [openSeen, setOpenSeen] = useState(false)
  const openRequested = params.add === '1'
  if (openRequested !== openSeen) {
    setOpenSeen(openRequested)
    if (openRequested) {
      setEditingTask(null)
      setTaskDialog(true)
    }
  }
  useEffect(() => {
    if (openRequested) router.setParams({ add: undefined })
  }, [openRequested, router])

  const moveWeek = (offset: number) => {
    const next = format(addDays(parseISO(`${weekStart}T12:00:00`), offset * 7), 'yyyy-MM-dd')
    setWeekStart(next)
    setSelectedDate(next)
  }

  const saveTask = async (task: DailyTask): Promise<boolean> => {
    const parsed = taskInputSchema.safeParse(task)
    if (!parsed.success) {
      notify(parsed.error.issues[0]?.message ?? 'Check the task details.', 'error')
      return false
    }
    try {
      await upsert('daily_tasks', { ...task, title: task.title.trim(), updated_at: new Date().toISOString() })
      notify(editingTask ? 'Task updated.' : 'Task added to your plan.')
      setTaskDialog(false)
      setEditingTask(null)
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save task.', 'error')
      return false
    }
  }
  const toggleTask = async (task: DailyTask) => {
    try {
      await upsert('daily_tasks', { ...task, is_completed: !task.is_completed, updated_at: new Date().toISOString() })
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update task.', 'error')
    }
  }
  const duplicateTask = async (task: DailyTask) => {
    const now = new Date().toISOString()
    try {
      await upsert('daily_tasks', { ...task, id: createId(), title: `${task.title} (copy)`, is_completed: false, position: tasks.length, created_at: now, updated_at: now })
      notify('Task duplicated.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not duplicate task.', 'error')
    }
  }
  const confirmDeleteTask = async () => {
    if (!deleteTarget || deletingTask) return
    setDeletingTask(true)
    try {
      await remove('daily_tasks', deleteTarget)
      notify('Task deleted.')
      setDeleteTarget(null)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not delete task.', 'error')
    } finally {
      setDeletingTask(false)
    }
  }
  const moveTask = async (task: DailyTask, direction: -1 | 1) => {
    const reordered = [...tasks]
    const from = reordered.findIndex(item => item.id === task.id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= reordered.length) return
    const [moved] = reordered.splice(from, 1)
    if (moved) reordered.splice(to, 0, moved)
    try {
      await upsertMany('daily_tasks', reordered.map((item, position) => ({ ...item, position, updated_at: new Date().toISOString() })))
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not reorder tasks.', 'error')
    }
  }

  const saveGoal = async (goal: WeeklyGoal): Promise<boolean> => {
    try {
      const parsed = goalSchema.safeParse(goal)
      if (!parsed.success) {
        notify(parsed.error.issues[0]?.message ?? 'Check the weekly goal.', 'error')
        return false
      }
      await upsert('weekly_goals', { ...goal, title: parsed.data.title, updated_at: new Date().toISOString() })
      notify('Weekly goal saved.')
      setGoalDialog(false)
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save goal.', 'error')
      return false
    }
  }

  const removeGoal = async (goal: WeeklyGoal) => {
    try {
      await remove('weekly_goals', goal)
      notify('Goal deleted.')
    } catch {
      notify('Could not delete goal. Try again.', 'error')
    } finally {
      setDeleteGoal(null)
    }
  }

  const doneTotal = tasks.filter(task => task.is_completed).length
  const weekEnd = format(endOfWeek(parseISO(`${weekStart}T12:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd')

  return (
    <Screen refreshing={syncState === 'syncing'} onRefresh={() => void refresh()}>
      <PageHeader
        eyebrow="MAKE SPACE FOR THE WORK"
        title="Planner"
        subtitle="A steady plan is a promise you can keep adjusting."
        action={<Button onPress={() => { setEditingTask(null); setTaskDialog(true) }} icon={<Plus size={17} color={theme.colors.buttonPrimaryInk} />}>Add task</Button>}
      />

      <NotebookCard padding={14} style={{ gap: 12 }}>
        <View style={styles.weekHead}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous week" onPress={() => moveWeek(-1)} style={styles.navBtn}><Text style={[theme.type.label, { color: theme.colors.accent }]}>← Prev</Text></Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>{prettyDate(weekStart, { day: 'numeric', month: 'short' })} – {prettyDate(weekEnd, { day: 'numeric', month: 'short' })}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Next week" onPress={() => moveWeek(1)} style={styles.navBtn}><Text style={[theme.type.label, { color: theme.colors.accent }]}>Next →</Text></Pressable>
        </View>
        <View style={styles.strip}>
          {days.map(day => {
            const dayTasks = data.tasks.filter(task => task.task_date === day)
            const done = dayTasks.filter(task => task.is_completed).length
            const selected = day === selectedDate
            const isToday = day === indiaToday()
            return (
              <Pressable
                key={day}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${prettyDate(day, { weekday: 'long', day: 'numeric', month: 'short' })}, ${dayTasks.length} task${dayTasks.length === 1 ? '' : 's'}`}
                onPress={() => setSelectedDate(day)}
                style={[styles.day, { borderColor: selected ? theme.colors.accent : theme.colors.line, backgroundColor: selected ? theme.colors.accentLight : theme.colors.paper }]}
              >
                <Text style={[theme.type.badge, { color: isToday ? theme.colors.accent : theme.colors.muted }]}>{new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(parseISO(`${day}T12:00:00`))}</Text>
                <Text style={[theme.type.label, { color: theme.colors.ink }]}>{parseISO(`${day}T12:00:00`).getDate()}</Text>
                <View style={[styles.dot, { backgroundColor: dayTasks.length === 0 ? 'transparent' : done === dayTasks.length ? theme.colors.green : theme.colors.orange }]} />
              </Pressable>
            )
          })}
        </View>
        <View style={styles.dayHead}>
          <View style={{ flex: 1 }}>
            <Text style={[theme.type.overline, { color: theme.colors.accent, fontSize: 11 }]}>{selectedDate === indiaToday() ? 'TODAY' : new Intl.DateTimeFormat('en-IN', { weekday: 'long' }).format(parseISO(`${selectedDate}T12:00:00`)).toUpperCase()}</Text>
            <Text accessibilityRole="header" style={[theme.type.h3, { color: theme.colors.ink }]}>{prettyDate(selectedDate, { day: 'numeric', month: 'long' })}</Text>
          </View>
          <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{doneTotal} of {tasks.length} done</Text>
        </View>
        {tasks.length === 0 ? (
          <EmptyState icon={<CalendarDays size={24} color={theme.colors.muted} />} title="A clear patch of paper." description="Add a task for this day. You can move or reschedule it whenever your plan changes." action={<Button variant="secondary" size="sm" onPress={() => { setEditingTask(null); setTaskDialog(true) }} icon={<Plus size={15} color={theme.colors.ink} />}>Plan a task</Button>} />
        ) : (
          <View style={{ gap: 8 }}>
            {tasks.map((task, index) => {
              const chapter = data.chapters.find(item => item.id === task.chapter_id)
              return (
                <View key={task.id} style={[styles.task, { borderColor: theme.colors.line, backgroundColor: task.is_completed ? theme.colors.paperSoft : theme.colors.paper }]}>
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: task.is_completed }} accessibilityLabel={task.is_completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`} onPress={() => void toggleTask(task)} style={[styles.check, { borderColor: task.is_completed ? theme.colors.green : theme.colors.lineStrong, backgroundColor: task.is_completed ? theme.colors.greenBg : 'transparent' }]}>
                    {task.is_completed ? <Check size={14} strokeWidth={3} color={theme.colors.green} /> : null}
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${task.title}`} onPress={() => { setEditingTask(task); setTaskDialog(true) }} style={{ flex: 1, gap: 4 }}>
                    <Text style={[theme.type.label, { color: task.is_completed ? theme.colors.muted : theme.colors.ink, textDecorationLine: task.is_completed ? 'line-through' : 'none' }]}>{task.title}</Text>
                    <View style={styles.meta}>
                      {task.subject ? <SubjectBadge subject={task.subject} /> : null}
                      {chapter ? <Text style={[theme.type.badge, { color: theme.colors.muted, flexShrink: 1 }]} numberOfLines={1}>{chapter.name}</Text> : null}
                      <Clock size={12} color={theme.colors.muted} />
                      <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{fmtDuration(task.estimated_minutes)}</Text>
                      <Text style={[theme.type.badge, { color: task.priority === 'High' ? theme.colors.red : task.priority === 'Low' ? theme.colors.green : theme.colors.orange }]}>{task.priority}</Text>
                    </View>
                  </Pressable>
                  <View style={styles.tools}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Move task up" disabled={index === 0} onPress={() => void moveTask(task, -1)} style={styles.toolBtn}><ArrowUp size={14} color={index === 0 ? theme.colors.lineStrong : theme.colors.inkSoft} /></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Move task down" disabled={index === tasks.length - 1} onPress={() => void moveTask(task, 1)} style={styles.toolBtn}><ArrowDown size={14} color={index === tasks.length - 1 ? theme.colors.lineStrong : theme.colors.inkSoft} /></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Duplicate ${task.title}`} onPress={() => void duplicateTask(task)} style={styles.toolBtn}><Copy size={14} color={theme.colors.inkSoft} /></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${task.title}`} onPress={() => setDeleteTarget(task)} style={styles.toolBtn}><Trash2 size={14} color={theme.colors.red} /></Pressable>
                  </View>
                </View>
              )
            })}
          </View>
        )}
        <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>Reorder with the arrows. Tap a task to edit it or move its date. Finished time: {fmtDuration(tasks.reduce((sum, task) => sum + (task.is_completed ? task.estimated_minutes : 0), 0))}.</Text>
      </NotebookCard>

      <NotebookCard padding={14} style={{ gap: 12 }}>
        <View style={styles.goalHead}>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={styles.inline}><Target size={16} color={theme.colors.accent} /><Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11 }]}>WEEKLY GOALS</Text></View>
            <Text accessibilityRole="header" style={[theme.type.h3, { color: theme.colors.ink }]}>Little promises</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Add weekly goal" onPress={() => setGoalDialog(true)} style={[styles.navBtn, { borderColor: theme.colors.line, borderWidth: 1, borderRadius: 999 }]}>
            <Plus size={16} color={theme.colors.ink} />
          </Pressable>
        </View>
        {goals.length === 0 ? (
          <View style={{ gap: 10 }}>
            <Text style={[theme.type.caption, { color: theme.colors.muted }]}>No goals set for this week. Choose a target that feels useful, not punishing.</Text>
            <Button variant="secondary" size="sm" onPress={() => setGoalDialog(true)} icon={<Plus size={15} color={theme.colors.ink} />}>Add a goal</Button>
          </View>
        ) : goals.map(goal => {
          const current = getGoalProgress(goal, data)
          const pct = goal.target > 0 ? Math.min(100, (current / goal.target) * 100) : 0
          return (
            <View key={goal.id} style={{ gap: 6 }}>
              <View style={styles.goalTitleRow}>
                <Text style={[theme.type.label, { color: theme.colors.ink, flex: 1 }]}>{goal.title}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${goal.title} goal`} onPress={() => setDeleteGoal(goal)} style={styles.toolBtn}><Trash2 size={14} color={theme.colors.red} /></Pressable>
              </View>
              <ProgressBar value={pct} color={theme.colors.accent} label={`${goal.title} progress`} />
              <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>{fmtNumber(current, 1)} / {fmtNumber(goal.target, 1)} {goal.unit}</Text>
            </View>
          )
        })}
      </NotebookCard>

      <NotebookCard padding={14} style={{ gap: 6 }}>
        <Text style={[theme.type.overline, { color: theme.colors.accent, fontSize: 11 }]}>A NOTE TO SELF</Text>
        <Text style={[theme.type.body, { color: theme.colors.inkSoft }]}>Plans are drafts. Move the task, keep the intention.</Text>
      </NotebookCard>

      {taskDialog ? (
        <TaskDialog key={editingTask?.id ?? `new-${selectedDate}`} initial={editingTask} defaultDate={selectedDate} data={data} onClose={() => { setTaskDialog(false); setEditingTask(null) }} onSave={saveTask} />
      ) : null}
      {goalDialog ? <GoalDialog weekStart={weekStart} onClose={() => setGoalDialog(false)} onSave={saveGoal} /> : null}
      <ConfirmDialog
        visible={Boolean(deleteTarget)}
        title={`Delete “${deleteTarget?.title ?? ''}”?`}
        message="This task will be removed from your plan. You can undo for a few seconds."
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDeleteTask()}
        loading={deletingTask}
      />
      <ConfirmDialog
        visible={Boolean(deleteGoal)}
        title={`Delete “${deleteGoal?.title ?? ''}”?`}
        message="This weekly goal will be removed for this week."
        onCancel={() => setDeleteGoal(null)}
        onConfirm={() => { if (deleteGoal) void removeGoal(deleteGoal) }}
      />
    </Screen>
  )
}

function TaskDialog({ initial, defaultDate, data, onClose, onSave }: {
  initial: DailyTask | null
  defaultDate: string
  data: AppData
  onClose: () => void
  onSave: (task: DailyTask) => Promise<boolean>
}) {
  const theme = useTheme()
  const { notify } = useToast()
  const now = new Date().toISOString()
  const [taskId] = useState(() => initial?.id ?? createId())
  const [title, setTitle] = useState(initial?.title ?? '')
  const [subject, setSubject] = useState<Subject | ''>(initial?.subject ?? '')
  const [chapterId, setChapterId] = useState(initial?.chapter_id ?? '')
  const [minutes, setMinutes] = useState(String(initial?.estimated_minutes ?? 30))
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'Medium')
  const [date, setDate] = useState(initial?.task_date ?? defaultDate)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const savingRef = useRef(false)
  const chapters = data.chapters.filter(chapter => !subject || chapter.subject === subject)
  const clearError = (key: string) => setErrors(current => {
    const next = { ...current }
    delete next[key]
    return next
  })
  const submit = async () => {
    if (savingRef.current) return
    const parsed = taskInputSchema.safeParse({ title: title.trim(), estimated_minutes: minutes.trim() === '' ? null : Number(minutes), task_date: date })
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
      id: taskId, title: parsed.data.title, subject: subject || null, chapter_id: chapterId || null,
      estimated_minutes: parsed.data.estimated_minutes, priority, is_completed: initial?.is_completed ?? false,
      task_date: parsed.data.task_date, position: initial?.position ?? data.tasks.filter(item => item.task_date === date).length,
      created_at: initial?.created_at ?? now, updated_at: now
    }
    try {
      await onSave(task)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  return (
    <Dialog visible onClose={onClose} title={initial ? 'Edit your task' : 'Plan a study task'} subtitle="You can change the day later. A plan should flex with you.">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14 }}>
        <TextField label="Task" required value={title} error={errors.title} maxLength={200} autoFocus placeholder="e.g. Practice 15 integration problems" onChangeText={value => { setTitle(value); clearError('title') }} />
        <DateField label="Date" required value={date} error={errors.task_date} onChange={value => { setDate(value); clearError('task_date') }} />
        <TextField label="Estimated minutes" value={minutes} error={errors.estimated_minutes} keyboardType="number-pad" onChangeText={value => { setMinutes(value.replace(/[^0-9]/g, '')); clearError('estimated_minutes') }} />
        <SelectField<Subject | ''>
          label="Subject"
          value={subject}
          options={[{ value: '', label: 'General' }, ...SUBJECTS.map(item => ({ value: item, label: item }))]}
          onChange={value => { setSubject(value); setChapterId('') }}
        />
        <SelectField<string>
          label="Chapter"
          value={chapterId}
          error={errors.chapter_id}
          options={[{ value: '', label: 'Choose chapter' }, ...chapters.map(chapter => ({ value: chapter.id, label: chapter.name, description: chapter.subject }))]}
          onChange={value => { setChapterId(value); clearError('chapter_id') }}
        />
        <SelectField<Priority>
          label="Priority"
          value={priority}
          options={[{ value: 'High', label: 'High' }, { value: 'Medium', label: 'Medium' }, { value: 'Low', label: 'Low' }]}
          onChange={setPriority}
        />
        <View style={styles.dialogActions}>
          <Button variant="secondary" onPress={onClose} disabled={saving}>Cancel</Button>
          <Button loading={saving} onPress={() => void submit()} icon={<Check size={16} color={theme.colors.buttonPrimaryInk} />}>{initial ? 'Save task' : 'Add task'}</Button>
        </View>
      </ScrollView>
    </Dialog>
  )
}

function GoalDialog({ weekStart, onClose, onSave }: { weekStart: string; onClose: () => void; onSave: (goal: WeeklyGoal) => Promise<boolean> }) {
  const theme = useTheme()
  const { notify } = useToast()
  const [goalId] = useState(() => createId())
  const [type, setType] = useState<GoalType>('study_hours')
  const [title, setTitle] = useState('Study hours')
  const [target, setTarget] = useState('10')
  const [unit, setUnit] = useState('hours')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const savingRef = useRef(false)
  const changeType = (next: GoalType) => {
    setType(next)
    const item = goalTypes.find(goal => goal.type === next)
    if (item) {
      setTitle(item.title)
      setUnit(item.unit)
    }
    setErrors({})
  }
  const submit = async () => {
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
    try {
      await onSave({ ...goal, title: parsed.data.title })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const limit = type === 'study_hours' ? MAX_WEEKLY_STUDY_HOURS : MAX_COUNT_GOAL
  return (
    <Dialog visible onClose={onClose} title="Set a weekly goal" subtitle={`For the week of ${prettyDate(weekStart)}.`}>
      <View style={{ gap: 14 }}>
        <SelectField<GoalType> label="Goal type" value={type} options={goalTypes.map(item => ({ value: item.type, label: item.title }))} onChange={changeType} />
        <TextField label="Name" required value={title} error={errors.title} maxLength={120} onChangeText={value => { setTitle(value); setErrors(current => ({ ...current, title: '' })) }} />
        <TextField label={`Target (up to ${limit} ${unit})`} required value={target} error={errors.target} keyboardType="decimal-pad" onChangeText={value => { setTarget(value); setErrors(current => ({ ...current, target: '' })) }} />
        <View style={styles.dialogActions}>
          <Button variant="secondary" onPress={onClose} disabled={saving}>Cancel</Button>
          <Button loading={saving} onPress={() => void submit()} icon={<Check size={16} color={theme.colors.buttonPrimaryInk} />}>Save goal</Button>
        </View>
      </View>
    </Dialog>
  )
}

/** Progress for one weekly goal, computed from the records that feed it. */
function getGoalProgress(goal: WeeklyGoal, data: AppData): number {
  const end = format(addDays(parseISO(`${goal.week_start}T12:00:00`), 6), 'yyyy-MM-dd')
  if (goal.goal_type === 'study_hours') return data.sessions.filter(session => indiaDate(session.started_at) >= goal.week_start && indiaDate(session.started_at) <= end).reduce((sum, session) => sum + session.duration_minutes, 0) / 60
  if (goal.goal_type === 'tests') return data.tests.filter(test => test.test_date >= goal.week_start && test.test_date <= end).length
  if (goal.goal_type === 'chapters') return data.chapters.filter(chapter => chapter.completed_on && chapter.completed_on >= goal.week_start && chapter.completed_on <= end).length
  if (goal.goal_type === 'revisions') return data.revisions.filter(revision => revision.completed_at && indiaDate(revision.completed_at) >= goal.week_start && indiaDate(revision.completed_at) <= end).length
  return goal.progress_value
}

const styles = StyleSheet.create({
  weekHead: { flexDirection: 'row', alignItems: 'center' },
  navBtn: { minHeight: 42, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  strip: { flexDirection: 'row', gap: 6 },
  day: { flex: 1, alignItems: 'center', gap: 2, borderWidth: 1, borderRadius: 12, paddingVertical: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 2 },
  dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  task: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 10 },
  check: { width: 30, height: 30, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  tools: { flexDirection: 'row', alignItems: 'center' },
  toolBtn: { width: 30, height: 34, alignItems: 'center', justifyContent: 'center' },
  goalHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  goalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }
})
