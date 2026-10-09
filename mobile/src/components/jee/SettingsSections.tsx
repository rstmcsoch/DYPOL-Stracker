import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { BellOff, Bell, CalendarDays, Check } from '../icons'
import { useTheme } from '../../contexts/AppearanceContext'
import { useData } from '../../contexts/DataContext'
import { useToast } from '../../contexts/ToastContext'
import { defaultExamTracks } from '../../shared/lib/defaults'
import { TRACK_LABEL } from '../../shared/lib/jee/exam'
import { REMINDER_LABEL } from '../../shared/lib/jee/reminders'
import { stableId } from '../../shared/lib/id'
import { REMINDER_KINDS, type AppSettings, type ReminderKind, type TrackId, type UserExamTrack } from '../../shared/types'
import { Button } from '../ui/Button'
import { Chip, SwitchRow, TextField } from '../ui/Forms'
import { NotebookCard } from '../ui/Surfaces'
import { getReminderPermission, requestReminderPermission, type ReminderPermission } from '../../lib/device-reminders'

/** Session 2 and Boards keep their own dates; Main S1 and Advanced use the existing Settings dates above. */
export function ExamTracksSection() {
  const theme = useTheme()
  const { data, upsert } = useData()
  const { notify } = useToast()
  const userId = data.settings.user_id ?? data.settings.id
  const rows = data.examTracks.length ? data.examTracks : defaultExamTracks(userId)
  const editable: TrackId[] = ['main2', 'boards']
  const draftsFrom = (source: UserExamTrack[]) => Object.fromEntries(source.filter(row => editable.includes(row.track)).map(row => [row.track, {
    exam_date: row.exam_date ?? '', target_score: row.target_score != null ? String(row.target_score) : ''
  }]))
  const [drafts, setDrafts] = useState<Record<string, { exam_date: string; target_score: string }>>(() => draftsFrom(rows))
  // Reload the drafts only when the saved rows change, not on every keystroke.
  const [seenRows, setSeenRows] = useState(data.examTracks)
  if (seenRows !== data.examTracks) {
    setSeenRows(data.examTracks)
    setDrafts(draftsFrom(rows))
  }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    } catch (saveError) {
      notify(saveError instanceof Error ? saveError.message : 'Could not save track dates.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <NotebookCard>
      <View style={styles.head}>
        <CalendarDays size={18} color={theme.colors.accent} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[theme.type.label, { color: theme.colors.ink }]}>Preparation tracks</Text>
          <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13 }]}>One shared syllabus. Each track differs only by its date and target.</Text>
        </View>
      </View>
      <View style={styles.stack}>
        <View style={[styles.trackRow, { borderColor: theme.colors.line }]}>
          <Text style={[theme.type.label, { color: theme.colors.ink }]}>{TRACK_LABEL.main1}</Text>
          <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13 }]}>Date comes from “JEE Main date” above.</Text>
        </View>
        <View style={[styles.trackRow, { borderColor: theme.colors.line }]}>
          <Text style={[theme.type.label, { color: theme.colors.ink }]}>{TRACK_LABEL.advanced}</Text>
          <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13 }]}>Date comes from “JEE Advanced date” above.</Text>
        </View>
        {editable.map(track => (
          <View key={track} style={[styles.trackRow, { borderColor: theme.colors.line }]}>
            <Text style={[theme.type.label, { color: theme.colors.ink }]}>{TRACK_LABEL[track]}</Text>
            <TextField
              label="Exam date"
              hint="Format YYYY-MM-DD, or leave blank."
              value={drafts[track]?.exam_date ?? ''}
              onChangeText={value => setDrafts(current => ({ ...current, [track]: { target_score: current[track]?.target_score ?? '', exam_date: value.trim() } }))}
              autoCapitalize="none"
              placeholder="2027-04-05"
            />
            <TextField
              label="Target score (optional)"
              value={drafts[track]?.target_score ?? ''}
              onChangeText={value => setDrafts(current => ({ ...current, [track]: { exam_date: current[track]?.exam_date ?? '', target_score: value } }))}
              keyboardType="decimal-pad"
            />
          </View>
        ))}
      </View>
      {error ? <Text accessibilityRole="alert" style={[theme.type.caption, { color: theme.colors.red }]}>{error}</Text> : null}
      <View style={styles.actionRow}>
        <Button variant="secondary" size="sm" onPress={() => void save()} loading={saving} icon={<Check size={14} color={theme.colors.ink} />}>
          Save track dates
        </Button>
      </View>
      <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>Leave dates blank until official dates are published. Nothing here assumes a date.</Text>
    </NotebookCard>
  )
}

/** Reminder preferences. In-app reminders always show on Home; the device notification needs permission. */
export function ReminderSettingsSection({ draft, patch, errors }: {
  draft: AppSettings
  patch: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  errors: Record<string, string>
}) {
  const theme = useTheme()
  const { notify } = useToast()
  const [permission, setPermission] = useState<ReminderPermission | 'unsupported'>('undetermined')
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    let active = true
    void getReminderPermission()
      .then(value => { if (active) setPermission(value) })
      .catch(() => { if (active) setPermission('unsupported') })
    return () => { active = false }
  }, [])

  const toggleType = (kind: ReminderKind) => {
    const current = draft.reminder_types
    patch('reminder_types', current.includes(kind) ? current.filter(item => item !== kind) : [...current, kind])
  }

  const requestPermission = async () => {
    if (requesting) return
    setRequesting(true)
    try {
      const next = await requestReminderPermission()
      setPermission(next)
      if (next !== 'granted') notify('Notifications stay off. In-app reminders still appear on Home.', 'info')
    } catch {
      setPermission('unsupported')
      notify('Device notifications are not available on this device.', 'error')
    } finally {
      setRequesting(false)
    }
  }

  const permissionCopy = permission === 'unsupported'
    ? 'Device notifications are not available here. In-app reminders still appear on Home.'
    : permission === 'granted'
      ? 'Allowed. One reminder a day can arrive even when Stracker is closed.'
      : permission === 'denied'
        ? 'Blocked in Android settings. In-app reminders still appear on Home.'
        : 'Not allowed yet. Allow notifications to receive the daily reminder.'

  return (
    <NotebookCard>
      <View style={styles.head}>
        {draft.reminders_enabled ? <Bell size={18} color={theme.colors.accent} /> : <BellOff size={18} color={theme.colors.muted} />}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[theme.type.label, { color: theme.colors.ink }]}>Daily reminders</Text>
          <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13 }]}>Reminders only mention things that really need you.</Text>
        </View>
      </View>
      <View style={styles.stack}>
        <SwitchRow label="Remind me once a day" value={draft.reminders_enabled} onValueChange={value => patch('reminders_enabled', value)} />
        <TextField
          label="Time (24-hour, HH:MM)"
          value={draft.reminder_time}
          onChangeText={value => patch('reminder_time', value.trim())}
          editable={draft.reminders_enabled}
          placeholder="08:00"
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          error={errors.reminder_time}
        />
        <View style={styles.stack}>
          <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>Device notification</Text>
          <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13 }]}>{permissionCopy}</Text>
          {permission !== 'granted' && permission !== 'unsupported' && permission !== 'denied' ? (
            <View style={styles.actionRow}>
              <Button variant="secondary" size="sm" onPress={() => void requestPermission()} loading={requesting} disabled={!draft.reminders_enabled}>
                Allow notifications
              </Button>
            </View>
          ) : null}
        </View>
        <View style={{ gap: 8, opacity: draft.reminders_enabled ? 1 : 0.5 }} pointerEvents={draft.reminders_enabled ? 'auto' : 'none'}>
          <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>What to remind me about</Text>
          <View style={styles.chips}>
            {REMINDER_KINDS.map(kind => (
              <Chip key={kind} label={REMINDER_LABEL[kind]} selected={draft.reminder_types.includes(kind)} onPress={() => toggleType(kind)} />
            ))}
          </View>
          {errors.reminder_types ? <Text accessibilityRole="alert" style={[theme.type.caption, { color: theme.colors.red }]}>{errors.reminder_types}</Text> : null}
        </View>
      </View>
      <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>
        The device notification is scheduled when you open Stracker, using what needs you that day. If nothing needs you when you last opened the app, no notification is scheduled until your next visit.
      </Text>
    </NotebookCard>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stack: { gap: 12 },
  trackRow: { gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }
})
