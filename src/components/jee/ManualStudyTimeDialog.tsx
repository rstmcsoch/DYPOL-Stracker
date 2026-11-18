import { useId, useState } from 'react'
import { Check, Clock3 } from 'lucide-react'
import { Button, Dialog, Field } from '../ui'
import { useData } from '../../contexts/DataContext'
import { useToast } from '../../contexts/ToastContext'
import { createId } from '../../lib/id'
import { indiaToday } from '../../lib/date'
import { STUDY_ACTIVITIES, type StudyActivity, type StudySession, type Subject } from '../../types'
import { useExamSubjects } from '../../lib/exams/useExamSubjects'
import { minutesLabel } from './shared'

const MAX_MINUTES = 1440

/**
 * Record study time that happened away from the timer: a lecture, a doubt class, a
 * paper you solved on paper. Before this, the only way minutes entered the notebook was the
 * focus timer or a practice block with a time, so the streak, the daily goal and every
 * study-time chart silently ignored real offline work.
 *
 * The row is a normal `study_sessions` record (`mode: 'Custom'`) so nothing downstream
 * needs to know it was entered by hand.
 */
export function ManualStudyTimeDialog({ onClose, defaultDate }: { onClose: () => void; defaultDate?: string }) {
  const { data, upsert } = useData()
  const { notify } = useToast()
  const today = indiaToday()
  const subjects = useExamSubjects()
  const idPrefix = useId().replaceAll(':', '')
  const [date, setDate] = useState(defaultDate ?? today)
  const [minutes, setMinutes] = useState('')
  const [activity, setActivity] = useState<StudyActivity>('Lecture')
  const [subject, setSubject] = useState<Subject | ''>('')
  const [chapterId, setChapterId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const chapters = data.chapters.filter(chapter => subject === '' || chapter.subject === subject).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
  const quick = [15, 30, 45, 60, 90]

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    const value = Number(minutes)
    if (date > today) { setError('Study time cannot be recorded for a future date.'); return }
    if (!Number.isInteger(value) || value < 1 || value > MAX_MINUTES) { setError(`Enter whole minutes from 1 to ${MAX_MINUTES.toLocaleString('en-IN')}.`); return }
    setSaving(true)
    try {
      const now = new Date()
      // End the block "now" on the chosen date so the session lands on that day in IST.
      const endedAt = date === today ? now : new Date(`${date}T21:00:00.000+05:30`)
      const startedAt = new Date(endedAt.getTime() - value * 60_000)
      const record: StudySession = {
        id: createId(), subject: subject || null, chapter_id: chapterId || null,
        started_at: startedAt.toISOString(), ended_at: endedAt.toISOString(), duration_minutes: value,
        completion_state: 'completed', mode: 'Custom', activity,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }
      await upsert('study_sessions', record)
      notify(`Logged ${minutesLabel(value)} of ${activity.toLowerCase()} time.`)
      onClose()
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Could not save the study time.', 'error')
    } finally { setSaving(false) }
  }

  return <Dialog lk="home:add-study-time" title="Add study time" subtitle="For time studied away from the timer." onClose={onClose} className="jee-dialog add-study-time-dialog">
    <form className="form-stack" noValidate onSubmit={submit}>
      <div className="form-grid two">
        <Field lk="home:l-date" label="Date"><input id={`${idPrefix}-date`} type="date" max={today} value={date} onChange={event => { setDate(event.target.value); setError(null) }} /></Field>
        <Field lk="home:l-minutes" label="Minutes"><input inputMode="numeric" value={minutes} onChange={event => { setMinutes(event.target.value); setError(null) }} placeholder="45" /></Field>
      </div>
      <div className="study-minute-quick" role="group" aria-label="Quick durations">{quick.map(value => <button key={value} type="button" className={minutes === String(value) ? 'is-selected' : ''} onClick={() => { setMinutes(String(value)); setError(null) }} aria-pressed={minutes === String(value)}>{value}m</button>)}</div>
      <div className="form-grid two">
        <Field lk="home:l-activity" label="What kind of study?"><select value={activity} onChange={event => setActivity(event.target.value as StudyActivity)}>{STUDY_ACTIVITIES.map(item => <option key={item}>{item}</option>)}</select></Field>
        <Field lk="home:l-subject" label="Subject (optional)"><select value={subject} onChange={event => { setSubject(event.target.value as Subject | ''); setChapterId('') }}><option value="">No subject</option>{subjects.map(item => <option key={item}>{item}</option>)}</select></Field>
      </div>
      {subject !== '' && chapters.length > 0 && <Field lk="home:l-chapter" label="Chapter (optional)"><select value={chapterId} onChange={event => setChapterId(event.target.value)}><option value="">No chapter</option>{chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}</select></Field>}
      <Field lk="home:l-note" label="Note (optional)"><input maxLength={200} value={note} onChange={event => setNote(event.target.value)} placeholder="e.g. Rotational motion lecture 4" /></Field>
      {error && <p className="field-error" role="alert">{error}</p>}
      <p className="field-hint"><Clock3 size={13} aria-hidden="true" /> Counts toward your daily goal, weekly goal, streak and study-time charts.</p>
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>Save time <Check size={15} /></Button></div>
    </form>
  </Dialog>
}
