import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertOctagon, Bell, CalendarDays, Check, Cloud, KeyRound, LogOut, Palette, RotateCcw, Save, Shield, SlidersHorizontal, Target, Timer, Type, UserRound } from 'lucide-react'
import { Button, Dialog, Field, NotebookCard, PageHeader, StatusBadge } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { clearLocalUserData } from '../lib/database'
import { supabase } from '../lib/supabase'
import { INTERFACE_FONT_OPTIONS } from '../lib/fonts'
import { settingsFieldErrors, settingsSchema } from '../lib/settings-validation'
import type { AppSettings, InterfaceFont, Profile, ThemeMode } from '../types'

export default function SettingsPage() {
  const { data, upsert } = useData()
  const { user, signOut } = useAuth()
  const { notify } = useToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<AppSettings>(data.settings)
  const [gapsText, setGapsText] = useState(data.settings.revision_gaps.join(', '))
  const [dailyGoalText, setDailyGoalText] = useState(String(data.settings.daily_study_goal_minutes / 60))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [signingOut, setSigningOut] = useState(false)
  const signOutRef = useRef(false)
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)
  const [firstResetOpen, setFirstResetOpen] = useState(false)
  const [secondResetOpen, setSecondResetOpen] = useState(false)
  const [resetText, setResetText] = useState('')
  const [resetting, setResetting] = useState(false)
  const resettingRef = useRef(false)
  const [soundTested, setSoundTested] = useState(false)

  useEffect(() => {
    setDraft(data.settings)
    setGapsText(data.settings.revision_gaps.join(', '))
    setDailyGoalText(String(data.settings.daily_study_goal_minutes / 60))
    setErrors({})
  }, [data.settings])

  const patch = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft(current => ({ ...current, [key]: value }))
    setErrors(current => {
      const next = { ...current }
      delete next[String(key)]
      if (key === 'weak_threshold' || key === 'strong_threshold') {
        delete next.weak_threshold
        delete next.strong_threshold
      }
      return next
    })
  }

  const savedKeys: (keyof AppSettings)[] = [
    'owner_name', 'main_exam_date', 'advanced_exam_date', 'target_score', 'theme', 'interface_font',
    'weak_threshold', 'strong_threshold', 'dropping_threshold', 'sound_enabled'
  ]
  const hasUnsavedChanges = savedKeys.some(key => draft[key] !== data.settings[key]) ||
    gapsText !== data.settings.revision_gaps.join(', ') || dailyGoalText !== String(data.settings.daily_study_goal_minutes / 60)
  const resetChanges = () => {
    setDraft(data.settings)
    setGapsText(data.settings.revision_gaps.join(', '))
    setDailyGoalText(String(data.settings.daily_study_goal_minutes / 60))
    setErrors({})
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)

    const hours = dailyGoalText.trim() === '' ? Number.NaN : Number(dailyGoalText)
    const rawMinutes = hours * 60
    const roundedMinutes = Math.round(rawMinutes)
    const minutesAreWhole = Number.isFinite(rawMinutes) && Math.abs(rawMinutes - roundedMinutes) < 1e-6
    const revisionGaps = gapsText.split(',').map(value => value.trim() === '' ? Number.NaN : Number(value.trim()))
    const validated = settingsSchema.safeParse({
      owner_name: draft.owner_name, main_exam_date: draft.main_exam_date, advanced_exam_date: draft.advanced_exam_date,
      target_score: draft.target_score, theme: draft.theme, interface_font: draft.interface_font,
      weak_threshold: draft.weak_threshold,
      strong_threshold: draft.strong_threshold, dropping_threshold: draft.dropping_threshold,
      revision_gaps: revisionGaps, daily_study_goal_minutes: minutesAreWhole ? roundedMinutes : Number.NaN,
      sound_enabled: draft.sound_enabled
    })
    if (!validated.success) {
      setErrors(settingsFieldErrors(validated.error))
      notify('Please correct the highlighted Settings fields.', 'error')
      savingRef.current = false
      setSaving(false)
      return
    }

    try {
      const settings: AppSettings = {
        ...draft,
        ...validated.data,
        revision_gaps: [...new Set(validated.data.revision_gaps)].sort((a, b) => a - b),
        daily_study_goal_minutes: validated.data.daily_study_goal_minutes,
        updated_at: new Date().toISOString()
      }
      await upsert('app_settings', settings)
      if (user) {
        const now = new Date().toISOString()
        const profile: Profile = data.profile
          ? { ...data.profile, display_name: settings.owner_name, updated_at: now }
          : { id: user.id, user_id: user.id, display_name: settings.owner_name, email: user.email, created_at: now, updated_at: now }
        await upsert('profiles', profile)
      }
      setDraft(settings)
      setGapsText(settings.revision_gaps.join(', '))
      setDailyGoalText(String(settings.daily_study_goal_minutes / 60))
      setErrors({})
      notify('Settings saved to your notebook.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save settings. Retry.', 'error')
    } finally {
      savingRef.current = false
      setSaving(false)
      // Deliberately do not focus a field or scroll the page after save. Focus stays on the
      // user's chosen Save button, and the mobile keyboard is not reopened.
    }
  }

  const playTestTone = () => {
    try {
      const context = new window.AudioContext()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'; oscillator.frequency.value = 660
      gain.gain.setValueAtTime(0.001, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.11, context.currentTime + 0.025); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.35)
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.36)
      void context.close()
      setSoundTested(true)
    } catch { notify('This browser could not play the notification sound.', 'error') }
  }

  const signOutFromSettings = async () => {
    if (signOutRef.current) return
    signOutRef.current = true
    setSigningOut(true)
    try { await signOut(); navigate('/login', { replace: true }) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not sign out. Try again.', 'error') }
    finally { signOutRef.current = false; setSigningOut(false) }
  }

  const resetAll = async () => {
    if (!user || resetText !== 'RESET' || resettingRef.current) return
    resettingRef.current = true
    setResetting(true)
    try {
      if (!user.isLocal && supabase) {
        const imageRows: { name: string; id: string | null }[] = []
        for (let offset = 0; ; offset += 1000) {
          const { data: page, error } = await supabase.storage.from('mistake-images').list(user.id, { limit: 1000, offset })
          if (error) throw new Error('Could not list uploaded images. No data was reset; retry after checking access.')
          imageRows.push(...(page ?? []))
          if (!page || page.length < 1000) break
        }
        const imagePaths = imageRows.filter(item => item.name && item.id).map(item => `${user.id}/${item.name}`)
        if (imagePaths.length) {
          const { error } = await supabase.storage.from('mistake-images').remove(imagePaths)
          if (error) throw new Error('Could not remove uploaded images. No data was reset; retry after checking access.')
        }
        const tables = ['mistakes','test_chapter_links','test_subject_scores','chapter_revisions','tests','daily_tasks','weekly_goals','study_sessions','chapters','app_settings','profiles'] as const
        for (const table of tables) {
          const { error } = await supabase.from(table).delete().eq('user_id', user.id)
          if (error) throw new Error('Cloud reset stopped because an owner-scoped record could not be deleted. Retry sync or contact your Supabase administrator.')
        }
      }
      await clearLocalUserData(user.id)
      queryClient.removeQueries({ queryKey: ['stracker-data', user.id] })
      notify('Study data was reset. You are being signed out.')
      await signOut()
      navigate('/login', { replace: true })
    } catch (error) { notify(error instanceof Error ? error.message : 'Reset did not finish. Your session is still active.', 'error') }
    finally {
      resettingRef.current = false
      setResetting(false); setFirstResetOpen(false); setSecondResetOpen(false); setResetText('')
    }
  }

  const auto = draft.theme === 'auto'
  return <div className="content-page settings-page">
    <PageHeader eyebrow="MAKE IT YOUR OWN" title="Settings" subtitle="Small adjustments for the way you study." doodle={<SlidersHorizontal size={19} />} action={<div className="settings-header-actions">{hasUnsavedChanges && <Button type="button" variant="quiet" onClick={resetChanges} disabled={saving}>Reset changes</Button>}<Button form="settings-form" type="submit" loading={saving} aria-busy={saving}><Save size={16} /> {saving ? 'Saving settings…' : 'Save settings'}</Button></div>} />
    <form id="settings-form" className="settings-form" noValidate onSubmit={save}>
      <fieldset className="settings-form-fields" disabled={saving}>
      <NotebookCard className="settings-section"><SectionLabel icon={<UserRound size={18} />} title="Owner" note="Your notebook belongs to this account." /><div className="settings-section-content"><div className="settings-owner-row"><div className="settings-avatar">{(draft.owner_name.trim()[0] ?? 'S').toUpperCase()}</div><div className="settings-owner-fields"><Field label="Name in your notebook" error={errors.owner_name}><input maxLength={100} value={draft.owner_name} onChange={event => patch('owner_name', event.target.value)} placeholder="What should Stracker call you?" /></Field><Field label="Account email"><input type="email" value={user?.email ?? ''} readOnly aria-readonly="true" /><span className="field-hint">Email and password are managed by secure Supabase authentication.</span></Field></div></div><div className="settings-note-line"><Shield size={15} /> Public registration is disabled. Only the signed-in account can read or change its rows.</div><div className="settings-account-actions"><Button type="button" variant="secondary" onClick={() => setPasswordDialogOpen(true)} disabled={!user || user.isLocal}><KeyRound size={15} /> Change password</Button><Button type="button" variant="quiet" onClick={() => void signOutFromSettings()} loading={signingOut}><LogOut size={15} /> Sign out</Button></div>{user?.isLocal && <small className="settings-account-note">Password changes are available for a cloud-authenticated owner account.</small>}</div></NotebookCard>

      <NotebookCard className="settings-section"><SectionLabel icon={<CalendarDays size={18} />} title="Exam dates & target" note="A countdown is only useful when the date is yours to choose." /><div className="settings-section-content"><div className="form-grid three"><Field label="JEE Main date" error={errors.main_exam_date}><input type="date" value={draft.main_exam_date} onChange={event => patch('main_exam_date', event.target.value)} /></Field><Field label="JEE Advanced date" error={errors.advanced_exam_date}><input type="date" value={draft.advanced_exam_date} onChange={event => patch('advanced_exam_date', event.target.value)} /></Field><Field label="Target score" error={errors.target_score}><input type="number" min="0" max="999999.99" step="0.01" value={Number.isFinite(draft.target_score) ? draft.target_score : ''} onChange={event => patch('target_score', event.target.value === '' ? Number.NaN : Number(event.target.value))} /><span className="field-hint">Compared to a mock with all three subject totals.</span></Field></div><div className="settings-note-line"><Target size={15} /> Leave dates blank until the official dates are confirmed.</div></div></NotebookCard>

      <NotebookCard className="settings-section"><SectionLabel icon={<Palette size={18} />} title="Notebook theme" note="Choose paper, blackboard, or follow this device." /><div className="settings-section-content"><div className="theme-choice-grid" role="radiogroup" aria-label="Theme preference">{([['light','Warm paper','Light notebook paper'],['dark','Chalkboard','Dark, high-contrast study mode'],['auto','Auto','Follow your device setting']] as const).map(([value,title,desc]) => <label className={`theme-choice theme-choice-${value} ${draft.theme === value ? 'selected' : ''}`} key={value}><input type="radio" name="theme" value={value} checked={draft.theme === value} onChange={() => patch('theme', value as ThemeMode)} /><span className="theme-swatch"><i /><i /><i /></span><strong>{title}</strong><small>{desc}</small>{draft.theme === value && <span className="theme-check"><Check size={13} /></span>}</label>)}</div><div className="settings-note-line"><Palette size={15} /> {auto ? 'Auto theme follows the device appearance.' : 'Theme choice is saved with your account.'}</div></div></NotebookCard>

      <NotebookCard className="settings-section"><SectionLabel icon={<Type size={18} />} title="Interface font" note="Choose the typeface Stracker writes in. Exports keep their own typography." /><div className="settings-section-content"><div className="font-choice-grid" role="radiogroup" aria-label="Interface font">{INTERFACE_FONT_OPTIONS.map(option => <label className={`font-choice ${draft.interface_font === option.value ? 'selected' : ''}`} key={option.value}><input type="radio" name="interface_font" value={option.value} checked={draft.interface_font === option.value} onChange={() => patch('interface_font', option.value as InterfaceFont)} /><span className="font-choice-sample" style={{ fontFamily: option.stack }} aria-hidden="true">Aa</span><span className="font-choice-copy"><strong style={{ fontFamily: option.stack }}>{option.label}</strong><small>{option.note}</small></span>{draft.interface_font === option.value && <span className="theme-check"><Check size={13} /></span>}</label>)}</div><div className="settings-note-line"><Type size={15} /> Applies to the whole interface — dashboard, navigation, forms, tables and dialogs. JSON, CSV, PDF and DOCX exports keep their existing typography.</div></div></NotebookCard>

      <NotebookCard className="settings-section"><SectionLabel icon={<Target size={18} />} title="Weak-area thresholds" note="These bands describe test results; they do not judge your preparation." /><div className="settings-section-content"><div className="form-grid three"><Field label="Weak below (%)" error={errors.weak_threshold}><input type="number" min="0" max="99.99" step="0.01" value={Number.isFinite(draft.weak_threshold) ? draft.weak_threshold : ''} onChange={event => patch('weak_threshold', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field><Field label="Strong above (%)" error={errors.strong_threshold}><input type="number" min="0.01" max="100" step="0.01" value={Number.isFinite(draft.strong_threshold) ? draft.strong_threshold : ''} onChange={event => patch('strong_threshold', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field><Field label="Dropping when down by (points)" error={errors.dropping_threshold}><input type="number" min="0" max="100" step="0.01" value={Number.isFinite(draft.dropping_threshold) ? draft.dropping_threshold : ''} onChange={event => patch('dropping_threshold', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field></div><div className="threshold-preview"><StatusBadge tone="Weak">Weak &lt; {Number.isFinite(draft.weak_threshold) ? draft.weak_threshold : '—'}%</StatusBadge><StatusBadge tone="Okay">Okay {Number.isFinite(draft.weak_threshold) ? draft.weak_threshold : '—'}–{Number.isFinite(draft.strong_threshold) ? draft.strong_threshold : '—'}%</StatusBadge><StatusBadge tone="Strong">Strong &gt; {Number.isFinite(draft.strong_threshold) ? draft.strong_threshold : '—'}%</StatusBadge></div></div></NotebookCard>

      <NotebookCard className="settings-section"><SectionLabel icon={<RotateCcw size={18} />} title="Revision rhythm" note="When a chapter is first marked Done, these gaps create its revision schedule." /><div className="settings-section-content"><Field label="Days between revisions" error={errors.revision_gaps}><input value={gapsText} onChange={event => { setGapsText(event.target.value); setErrors(current => { const next = { ...current }; delete next.revision_gaps; return next }) }} placeholder="1, 7, 30" /><span className="field-hint">Comma-separated positive days, sorted automatically. Existing revisions are not moved.</span></Field><div className="revision-gap-preview">{gapsText.split(',').map(value => Number(value.trim())).filter(value => Number.isFinite(value) && value > 0).map((value, index) => <span key={`${value}-${index}`}>R{index + 1}<strong>{value}d</strong></span>)}</div></div></NotebookCard>

      <NotebookCard className="settings-section"><SectionLabel icon={<Timer size={18} />} title="Daily goal & focus" note="A gentle baseline for the timer and study heatmap." /><div className="settings-section-content"><div className="form-grid two"><Field label="Daily study goal (hours)" error={errors.daily_study_goal_minutes}><input type="number" min="0" max="24" step="any" value={dailyGoalText} onChange={event => { setDailyGoalText(event.target.value); setErrors(current => { const next = { ...current }; delete next.daily_study_goal_minutes; return next }) }} /><span className="field-hint">Use whole-minute increments (for example, 1.5 hours).</span></Field><label className="sound-toggle"><input type="checkbox" checked={draft.sound_enabled} onChange={event => patch('sound_enabled', event.target.checked)} /><span className="toggle-visual" /><span><strong>Focus timer sound</strong><small>Play a soft tone when a focus session ends.</small></span></label></div><div className="settings-note-line"><Bell size={15} /> Sound is generated locally in your browser; no audio is sent to a service.{draft.sound_enabled && <button className="text-button" type="button" onClick={playTestTone}>{soundTested ? 'Test tone played' : 'Try a tone'}</button>}</div></div></NotebookCard>

      <NotebookCard className="settings-section backup-status-settings"><SectionLabel icon={<Cloud size={18} />} title="Your data & backup" note="Your cloud data is private to your account. Keep an export somewhere safe." /><div className="settings-section-content"><div className="backup-status-line"><div><strong>{draft.last_backup_at ? `Last backup ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(draft.last_backup_at))}` : 'No backup recorded yet'}</strong><span>{draft.last_backup_at ? 'JSON, PDF and DOCX exports live in Export & Backup.' : 'A JSON backup is the easiest way to keep a portable copy.'}</span></div><Button variant="secondary" onClick={() => navigate('/backup')}>Open backup center</Button></div></div></NotebookCard>
      </fieldset>
    </form>

    <section className="danger-zone"><div className="danger-zone-head"><div className="danger-icon"><AlertOctagon size={18} /></div><div><h2>Dangerous actions</h2><p>These options affect your entire study notebook.</p></div></div><div className="danger-zone-row"><div><strong>Reset all study data</strong><span>Delete your cloud records, mistake images, and this device’s offline cache. This cannot be recovered unless you exported a backup.</span></div><Button variant="danger" onClick={() => setFirstResetOpen(true)}><RotateCcw size={15} /> Reset all data</Button></div></section>

    {passwordDialogOpen && <ChangePasswordDialog onClose={() => setPasswordDialogOpen(false)} />}
    {firstResetOpen && <Dialog title="This will erase your study history." subtitle="Chapters, tests, mistakes, revisions, tasks, goals, sessions and uploaded images will be permanently removed from the cloud and this device." onClose={() => setFirstResetOpen(false)} className="dialog-danger"><div className="reset-warning"><AlertOctagon size={22} /><p>Export a JSON backup first if you may want to restore your data later. This reset does not delete your Supabase login account.</p></div><div className="dialog-actions"><Button variant="secondary" onClick={() => setFirstResetOpen(false)}>Keep my data</Button><Button variant="danger" onClick={() => { setFirstResetOpen(false); setSecondResetOpen(true) }}>Continue to confirmation</Button></div></Dialog>}
    {secondResetOpen && <Dialog title="One last check." subtitle="To confirm, type RESET exactly. Your data will not be recoverable from Stracker after this." onClose={() => { setSecondResetOpen(false); setResetText('') }} className="dialog-danger"><Field label="Type RESET to confirm"><input autoFocus autoComplete="off" value={resetText} onChange={event => setResetText(event.target.value)} /></Field><div className="dialog-actions"><Button variant="secondary" onClick={() => { setSecondResetOpen(false); setResetText('') }} disabled={resetting}>Cancel</Button><Button variant="danger" loading={resetting} disabled={resetText !== 'RESET'} onClick={() => void resetAll()}><AlertOctagon size={15} /> {resetting ? 'Resetting…' : 'Permanently reset'}</Button></div></Dialog>}
  </div>
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const { updatePassword } = useAuth()
  const { notify } = useToast()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirmation?: string }>({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (savingRef.current) return
    const nextErrors: { password?: string; confirmation?: string } = {}
    if (password.length < 8) nextErrors.password = 'Use at least 8 characters.'
    if (password !== confirmation) nextErrors.confirmation = 'The passwords do not match.'
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return }

    savingRef.current = true
    setSaving(true)
    try {
      // The password is passed directly to Supabase Auth and is never persisted in Stracker data.
      await updatePassword(password)
      notify('Your password has been updated.')
      setPassword(''); setConfirmation(''); onClose()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update the password. Try again.', 'error')
    } finally { savingRef.current = false; setSaving(false) }
  }
  return <Dialog title="Change password" subtitle="Choose a new password for your secure owner account." onClose={onClose} className="dialog-narrow"><form className="form-stack" noValidate onSubmit={submit}>
    <Field label="New password" required hint="At least 8 characters." error={errors.password}><input type="password" autoComplete="new-password" value={password} onChange={event => { setPassword(event.target.value); setErrors(current => ({ ...current, password: undefined })) }} /></Field>
    <Field label="Confirm new password" required error={errors.confirmation}><input type="password" autoComplete="new-password" value={confirmation} onChange={event => { setConfirmation(event.target.value); setErrors(current => ({ ...current, confirmation: undefined })) }} /></Field>
    <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" loading={saving}><KeyRound size={15} /> {saving ? 'Updating…' : 'Update password'}</Button></div>
  </form></Dialog>
}

function SectionLabel({ icon, title, note }: { icon: React.ReactNode; title: string; note: string }) {
  return <div className="settings-section-heading"><span className="settings-section-icon">{icon}</span><div><h2>{title}</h2><p>{note}</p></div></div>
}
