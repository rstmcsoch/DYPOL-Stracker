import { useRef, useState } from 'react'
import { View } from 'react-native'
import { useData } from '../../contexts/DataContext'
import { useToast } from '../../contexts/ToastContext'
import { Check } from '../icons'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Overlays'
import { Field, SelectField, TextField } from '../ui/Forms'
import { indiaToday } from '../../shared/lib/date'
import { createId } from '../../shared/lib/id'
import { taskInputSchema } from '../../shared/lib/task-validation'
import type { DailyTask, Priority, Subject } from '../../shared/types'
import { useShell } from './ShellContext'

/** "A small step for today": the website's quick task dialog, with the same fields and validation. */
export function QuickTaskDialog() {
  const shell = useShell()
  return (
    <Dialog visible={shell.quickTaskOpen} onClose={shell.closeQuickTask} title="A small step for today" subtitle="Add a task to your study plan.">
      {shell.quickTaskOpen ? <QuickTaskForm onDone={shell.closeQuickTask} /> : null}
    </Dialog>
  )
}

function QuickTaskForm({ onDone }: { onDone: () => void }) {
  const { data, upsert } = useData()
  const { notify } = useToast()
  const [taskId] = useState(() => createId())
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState<Subject | ''>('')
  const [chapterId, setChapterId] = useState('')
  const [minutes, setMinutes] = useState('30')
  const [priority, setPriority] = useState<Priority>('Medium')
  const [loading, setLoading] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const loadingRef = useRef(false)
  const chapters = data.chapters.filter(chapter => !subject || chapter.subject === subject)

  const clearError = (key: string) => setFieldErrors(current => {
    const next = { ...current }
    delete next[key]
    return next
  })

  const save = async () => {
    if (loadingRef.current) return
    const taskDate = indiaToday()
    const parsed = taskInputSchema.safeParse({
      title: title.trim(),
      estimated_minutes: minutes.trim() === '' ? null : Number(minutes),
      task_date: taskDate
    })
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) nextErrors[String(issue.path[0] ?? 'form')] ??= issue.message
      setFieldErrors(nextErrors)
      notify('Please correct the highlighted task fields.', 'error')
      return
    }
    if (chapterId) {
      const chapter = data.chapters.find(item => item.id === chapterId)
      if (!chapter || (subject && chapter.subject !== subject)) {
        notify('Choose a chapter that belongs to the selected subject.', 'error')
        return
      }
    }
    loadingRef.current = true
    setLoading(true)
    const now = new Date().toISOString()
    const task: DailyTask = {
      id: taskId,
      title: parsed.data.title,
      subject: subject || null,
      chapter_id: chapterId || null,
      estimated_minutes: parsed.data.estimated_minutes,
      priority,
      is_completed: false,
      task_date: taskDate,
      position: data.tasks.filter(item => item.task_date === taskDate).length,
      created_at: now,
      updated_at: now
    }
    try {
      await upsert('daily_tasks', task)
      notify('Task added to today.')
      onDone()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save task. Retry.', 'error')
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  return (
    <View style={{ gap: 14 }}>
      <TextField
        label="What do you want to do?"
        required
        error={fieldErrors.title}
        value={title}
        maxLength={200}
        autoFocus
        placeholder="e.g. Revise Kirchhoff's laws"
        onChangeText={value => { setTitle(value); clearError('title') }}
      />
      <SelectField<Subject | ''>
        label="Subject"
        value={subject}
        options={[{ value: '', label: 'General' }, { value: 'Physics', label: 'Physics' }, { value: 'Chemistry', label: 'Chemistry' }, { value: 'Maths', label: 'Maths' }]}
        onChange={value => { setSubject(value); setChapterId('') }}
      />
      <SelectField<string>
        label="Chapter"
        value={chapterId}
        options={[{ value: '', label: 'Choose chapter' }, ...chapters.map(chapter => ({ value: chapter.id, label: chapter.name }))]}
        onChange={setChapterId}
      />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <TextField
            label="Estimated time (min)"
            error={fieldErrors.estimated_minutes}
            value={minutes}
            keyboardType="number-pad"
            onChangeText={value => { setMinutes(value.replace(/[^0-9]/g, '')); clearError('estimated_minutes') }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Priority">
            <SelectField<Priority>
              label="Priority"
              value={priority}
              options={[{ value: 'High', label: 'High' }, { value: 'Medium', label: 'Medium' }, { value: 'Low', label: 'Low' }]}
              onChange={setPriority}
            />
          </Field>
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
        <Button variant="secondary" onPress={onDone}>Cancel</Button>
        <Button loading={loading} onPress={() => void save()} icon={<Check size={16} />}>Add to today</Button>
      </View>
    </View>
  )
}
