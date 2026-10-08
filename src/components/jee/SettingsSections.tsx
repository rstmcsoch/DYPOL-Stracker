import { useEffect, useState } from 'react'
import { Bell, BellOff, CalendarDays, Check } from 'lucide-react'
import { Button, Field, NotebookCard } from '../ui'
import { useData } from '../../contexts/DataContext'
import { useToast } from '../../contexts/ToastContext'
import { defaultExamTracks } from '../../lib/defaults'
import { TRACK_LABEL } from '../../lib/jee/exam'
import { REMINDER_LABEL } from '../../lib/jee/reminders'
import { stableId } from '../../lib/id'
import { REMINDER_KINDS, type AppSettings, type ReminderKind, type TrackId, type UserExamTrack } from '../../types'

/** Session 2 and Boards keep their own dates; Main S1 and Advanced use the existing Settings dates above. */
export function ExamTracksSection() {
  const { data, upsert } = useData()
  const { notify } = useToast()
  const userId = data.settings.user_id ?? data.settings.id
  const rows = data.examTracks.length ? data.examTracks : defaultExamTracks(userId)
  const editable: TrackId[] = ['main2', 'boards']
  const [drafts, setDrafts] = useState<Record<string, { exam_date: string; target_score: string }>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDrafts(Object.fromEntries(rows.filter(row => editable.includes(row.track)).map(row => [row.track, {
      exam_date: row.exam_date ?? '', target_score: row.target_score != null ? String(row.target_score) : ''
    }])))
    // Reload drafts only when the saved rows change, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.examTracks])

  const save = async () => {
    if (saving) return
    setError(null)
    const updates: UserExamTrack[] = []
    for (const track of editable) {
      const draft = drafts[track]
      const base = rows.find(row => row.track === track)
      if (!draft || !base) continue
      if (draft.exam_date && !/^\d{4}-\d{2}-\d{2}$/.test(draft.exam_date)) { setError(`Choose a valid date for ${TRACK_LABEL[track]} or leave it blank.`); return }
      const target = draft.target_score.trim() === '' ? null : Number(draft.target_score)
      if (target !== null && (!Number.isFinite(target) || target < 0 || target > 999999.99)) { setError(`Target for ${TRACK_LABEL[track]} must be between 0 and 999,999.99.`); return }
      if (draft.exam_date !== (base.exam_date ?? '') || target !== base.target_score) {
        updates.push({ ...base, id: base.id || stableId(`${userId}:track:${track}`), user_id: userId, exam_date: draft.exam_date || null, target_score: target, updated_at: new Date().toISOString() })
      }
    }
    if (!updates.length) { notify('Nothing to save for these tracks.'); return }
    setSaving(true)
    try {
      for (const record of updates) await upsert('user_exam_tracks', record)
      notify('Track dates saved.')
    } catch (saveError) { notify(saveError instanceof Error ? saveError.message : 'Could not save track dates.', 'error') }
    finally { setSaving(false) }
  }

  return <NotebookCard className="settings-section">
    <div className="jee-settings-head"><CalendarDays size={18} aria-hidden="true" /><div><strong>Preparation tracks</strong><small className="jee-muted">One shared syllabus. Each track differs only by its date and target.</small></div></div>
    <div className="settings-section-content">
      <div className="jee-track-settings">
        <div className="jee-track-setting readonly"><span>{TRACK_LABEL.main1}</span><small className="jee-muted">Date comes from “JEE Main date” above.</small></div>
        <div className="jee-track-setting readonly"><span>{TRACK_LABEL.advanced}</span><small className="jee-muted">Date comes from “JEE Advanced date” above.</small></div>
        {editable.map(track => <div key={track} className="jee-track-setting">
          <span>{TRACK_LABEL[track]}</span>
          <div className="form-grid two">
            <Field label="Exam date"><input type="date" value={drafts[track]?.exam_date ?? ''} onChange={event => setDrafts(current => ({ ...current, [track]: { target_score: current[track]?.target_score ?? '', exam_date: event.target.value } }))} /></Field>
            <Field label="Target score (optional)"><input type="number" min="0" max="999999.99" step="0.01" value={drafts[track]?.target_score ?? ''} onChange={event => setDrafts(current => ({ ...current, [track]: { exam_date: current[track]?.exam_date ?? '', target_score: event.target.value } }))} /></Field>
          </div>
        </div>)}
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="jee-section-save"><Button variant="secondary" size="sm" onClick={() => void save()} loading={saving}><Check size={14} /> Save track dates</Button></div>
      <p className="jee-small jee-muted">Leave dates blank until official dates are published. Nothing here assumes a date.</p>
    </div>
  </NotebookCard>
}

/** Reminder preferences. In-app reminders always show on Home; OS notifications need browser permission. */
export function ReminderSettingsSection({ draft, patch, errors }: {
  draft: AppSettings
  patch: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  errors: Record<string, string>
}) {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const toggleType = (kind: ReminderKind) => {
    const current = draft.reminder_types
    patch('reminder_types', current.includes(kind) ? current.filter(item => item !== kind) : [...current, kind])
  }
  const requestPermission = async () => {
    if (typeof Notification === 'undefined') return
    setPermission(await Notification.requestPermission())
  }
  return <NotebookCard className="settings-section">
    <div className="jee-settings-head">{draft.reminders_enabled ? <Bell size={18} aria-hidden="true" /> : <BellOff size={18} aria-hidden="true" />}<div><strong>Daily reminders</strong><small className="jee-muted">Reminders only mention things that really need you.</small></div></div>
    <div className="settings-section-content">
      <label className="jee-toggle-row"><input type="checkbox" checked={draft.reminders_enabled} onChange={event => patch('reminders_enabled', event.target.checked)} /><span>Remind me once a day</span></label>
      <div className="form-grid two">
        <Field label="Time" error={errors.reminder_time}><input type="time" value={draft.reminder_time} disabled={!draft.reminders_enabled} onChange={event => patch('reminder_time', event.target.value)} /></Field>
        <div className="jee-notif-permission">
          <span className="field-label">Device notifications</span>
          {permission === 'unsupported' ? <small className="jee-muted">This browser does not support notifications. In-app reminders still appear on Home.</small>
            : permission === 'granted' ? <small className="jee-ok">Allowed. Reminders also appear as device notifications while Stracker is open.</small>
            : permission === 'denied' ? <small className="jee-muted">Blocked in browser settings. In-app reminders still appear on Home.</small>
            : <Button variant="secondary" size="sm" onClick={() => void requestPermission()} disabled={!draft.reminders_enabled}>Allow notifications</Button>}
        </div>
      </div>
      <fieldset className="jee-fieldset jee-reminder-types" disabled={!draft.reminders_enabled}>
        <legend>What to remind me about</legend>
        <div className="jee-chip-row">
          {REMINDER_KINDS.map(kind => <button key={kind} type="button" className={`jee-chip ${draft.reminder_types.includes(kind) ? 'active' : ''}`} aria-pressed={draft.reminder_types.includes(kind)} onClick={() => toggleType(kind)}>{REMINDER_LABEL[kind]}</button>)}
        </div>
        {errors.reminder_types && <p className="field-error" role="alert">{errors.reminder_types}</p>}
      </fieldset>
      <p className="jee-small jee-muted">Stracker can only notify while the app is open or installed and running. It cannot send a reminder when the device is fully closed; that needs a push service, which is not configured here.</p>
    </div>
  </NotebookCard>
}
