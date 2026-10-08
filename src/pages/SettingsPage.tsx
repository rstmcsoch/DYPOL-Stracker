import { useEffect, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertOctagon, Bell, CalendarDays, Check, Cloud, Palette, RotateCcw, Save, Shield, SlidersHorizontal, Target, Timer, UserRound } from 'lucide-react'
import { Button, Dialog, Field, NotebookCard, PageHeader, StatusBadge } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { clearLocalUserData } from '../lib/database'
import { supabase } from '../lib/supabase'
import { settingsSchema } from '../lib/settings-validation'
import type { AppSettings, Profile, ThemeMode } from '../types'

export default function SettingsPage() {
  const { data, upsert } = useData()
  const { user, signOut } = useAuth()
  const { notify } = useToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<AppSettings>(data.settings)
  const [gapsText, setGapsText] = useState(data.settings.revision_gaps.join(', '))
  const [saving, setSaving] = useState(false)
  const [firstResetOpen, setFirstResetOpen] = useState(false)
  const [secondResetOpen, setSecondResetOpen] = useState(false)
  const [resetText, setResetText] = useState('')
  const [resetting, setResetting] = useState(false)
  const [soundTested, setSoundTested] = useState(false)

  useEffect(() => { setDraft(data.settings); setGapsText(data.settings.revision_gaps.join(', ')) }, [data.settings])
  const patch = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setDraft(current => ({ ...current, [key]: value }))

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const gaps = gapsText.split(',').map(value => Number(value.trim()))
    const validated = settingsSchema.safeParse({
      owner_name: draft.owner_name, target_score: Number(draft.target_score), weak_threshold: Number(draft.weak_threshold),
      strong_threshold: Number(draft.strong_threshold), dropping_threshold: Number(draft.dropping_threshold),
      revision_gaps: gaps, daily_study_goal_minutes: Number(draft.daily_study_goal_minutes)
    })
    if (!validated.success) { notify(validated.error.issues[0]?.message ?? 'Check the settings values.', 'error'); return }
    setSaving(true)
    try {
      const settings: AppSettings = {
        ...draft, ...validated.data,
        revision_gaps: [...new Set(validated.data.revision_gaps)].sort((a, b) => a - b),
        updated_at: new Date().toISOString()
      }
      await upsert('app_settings', settings)
      if (user) {
        const now = new Date().toISOString()
        const profile: Profile = data.profile ? { ...data.profile, display_name: settings.owner_name, updated_at: now } : { id: user.id, user_id: user.id, display_name: settings.owner_name, email: user.email, created_at: now, updated_at: now }
        await upsert('profiles', profile)
      }
      setDraft(settings)
      notify('Settings saved to your notebook.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save settings. Retry.', 'error') }
    finally { setSaving(false) }
  }

  const playTestTone = () => {
    try {
      const AudioContextCtor = window.AudioContext
      const context = new AudioContextCtor()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'; oscillator.frequency.value = 660
      gain.gain.setValueAtTime(0.001, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.11, context.currentTime + 0.025); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.35)
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.36)
      void context.close()
      setSoundTested(true)
    } catch { notify('This browser could not play the notification sound.', 'error') }
  }

  const resetAll = async () => {
    if (!user || resetText !== 'RESET') return
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
    } catch (error) { notify(error instanceof Error ? error.message : 'Reset did not finish. Your session is still active.', 'error') }
    finally { setResetting(false); setFirstResetOpen(false); setSecondResetOpen(false); setResetText('') }
  }

  const auto = draft.theme === 'auto'
  return <div className="content-page settings-page">
    <PageHeader eyebrow="MAKE IT YOUR OWN" title="Settings" subtitle="Small adjustments for the way you study." doodle={<SlidersHorizontal size={19} />} action={<Button form="settings-form" type="submit" loading={saving}><Save size={16} /> Save settings</Button>} />
    <form id="settings-form" className="settings-form" noValidate onSubmit={save}>
      <NotebookCard className="settings-section"><SectionLabel icon={<UserRound size={18} />} title="Owner" note="Your notebook belongs to this account." /><div className="settings-section-content"><div className="settings-owner-row"><div className="settings-avatar">{(draft.owner_name.trim()[0] ?? 'S').toUpperCase()}</div><div className="settings-owner-fields"><Field label="Name in your notebook"><input maxLength={100} value={draft.owner_name} onChange={event => patch('owner_name', event.target.value)} placeholder="What should Stracker call you?" /></Field><Field label="Account email"><input type="email" value={user?.email ?? ''} readOnly aria-readonly="true" /><span className="field-hint">Email and password are managed by secure Supabase authentication.</span></Field></div></div><div className="settings-note-line"><Shield size={15} /> Public registration is disabled. Only the signed-in account can read or change its rows.</div></div></NotebookCard>

      <NotebookCard className="settings-section"><SectionLabel icon={<CalendarDays size={18} />} title="Exam dates & target" note="A countdown is only useful when the date is yours to choose." /><div className="settings-section-content"><div className="form-grid three"><Field label="JEE Main date"><input type="date" value={draft.main_exam_date} onChange={event => patch('main_exam_date', event.target.value)} /></Field><Field label="JEE Advanced date"><input type="date" value={draft.advanced_exam_date} onChange={event => patch('advanced_exam_date', event.target.value)} /></Field><Field label="Target score"><input type="number" min="0" max="10000" step="any" value={draft.target_score} onChange={event => patch('target_score', Number(event.target.value))} /><span className="field-hint">Compared to a mock with all three subject totals.</span></Field></div><div className="settings-note-line"><Target size={15} /> Leave dates blank until the official dates are confirmed.</div></div></NotebookCard>

      <NotebookCard className="settings-section"><SectionLabel icon={<Palette size={18} />} title="Notebook theme" note="Choose paper, blackboard, or follow this device." /><div className="settings-section-content"><div className="theme-choice-grid" role="radiogroup" aria-label="Theme preference">{([['light','Warm paper','Light notebook paper'],['dark','Chalkboard','Dark, high-contrast study mode'],['auto','Auto','Follow your device setting']] as const).map(([value,title,desc]) => <label className={`theme-choice theme-choice-${value} ${draft.theme === value ? 'selected' : ''}`} key={value}><input type="radio" name="theme" value={value} checked={draft.theme === value} onChange={() => patch('theme', value as ThemeMode)} /><span className="theme-swatch"><i /><i /><i /></span><strong>{title}</strong><small>{desc}</small>{draft.theme === value && <span className="theme-check"><Check size={13} /></span>}</label>)}</div><div className="settings-note-line"><Palette size={15} /> {auto ? 'Auto theme follows the device appearance.' : 'Theme choice is saved with your account.'}</div></div></NotebookCard>

      <NotebookCard className="settings-section"><SectionLabel icon={<Target size={18} />} title="Weak-area thresholds" note="These bands describe test results; they do not judge your preparation." /><div className="settings-section-content"><div className="form-grid three"><Field label="Weak below (%)"><input type="number" min="0" max="99.99" step="any" value={draft.weak_threshold} onChange={event => patch('weak_threshold', Number(event.target.value))} /></Field><Field label="Strong above (%)"><input type="number" min="0.01" max="100" step="any" value={draft.strong_threshold} onChange={event => patch('strong_threshold', Number(event.target.value))} /></Field><Field label="Dropping when down by (points)"><input type="number" min="0" max="100" step="any" value={draft.dropping_threshold} onChange={event => patch('dropping_threshold', Number(event.target.value))} /></Field></div><div className="threshold-preview"><StatusBadge tone="Weak">Weak &lt; {draft.weak_threshold}%</StatusBadge><StatusBadge tone="Okay">Okay {draft.weak_threshold}–{draft.strong_threshold}%</StatusBadge><StatusBadge tone="Strong">Strong &gt; {draft.strong_threshold}%</StatusBadge></div></div></NotebookCard>

      <NotebookCard className="settings-section"><SectionLabel icon={<RotateCcw size={18} />} title="Revision rhythm" note="When a chapter is first marked Done, these gaps create its revision schedule." /><div className="settings-section-content"><Field label="Days between revisions"><input inputMode="numeric" value={gapsText} onChange={event => setGapsText(event.target.value)} placeholder="1, 7, 30" aria-describedby="revision-gaps-hint" /><span className="field-hint" id="revision-gaps-hint">Comma-separated positive days, sorted automatically. Existing revisions are not moved.</span></Field><div className="revision-gap-preview">{gapsText.split(',').map(value => Number(value.trim())).filter(value => Number.isFinite(value) && value > 0).map((value, index) => <span key={`${value}-${index}`}>R{index + 1}<strong>{value}d</strong></span>)}</div></div></NotebookCard>

      <NotebookCard className="settings-section"><SectionLabel icon={<Timer size={18} />} title="Daily goal & focus" note="A gentle baseline for the timer and study heatmap." /><div className="settings-section-content"><div className="form-grid two"><Field label="Daily study goal (hours)"><input type="number" min="0" max="24" step="any" value={draft.daily_study_goal_minutes / 60} onChange={event => patch('daily_study_goal_minutes', Math.round(Number(event.target.value) * 60))} /></Field><label className="sound-toggle"><input type="checkbox" checked={draft.sound_enabled} onChange={event => patch('sound_enabled', event.target.checked)} /><span className="toggle-visual" /><span><strong>Focus timer sound</strong><small>Play a soft tone when a focus session ends.</small></span></label></div><div className="settings-note-line"><Bell size={15} /> Sound is generated locally in your browser; no audio is sent to a service.{draft.sound_enabled && <button className="text-button" type="button" onClick={playTestTone}>{soundTested ? 'Test tone played' : 'Try a tone'}</button>}</div></div></NotebookCard>

      <NotebookCard className="settings-section backup-status-settings"><SectionLabel icon={<Cloud size={18} />} title="Your data & backup" note="Your cloud data is private to your account. Keep an export somewhere safe." /><div className="settings-section-content"><div className="backup-status-line"><div><strong>{draft.last_backup_at ? `Last backup ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(draft.last_backup_at))}` : 'No backup recorded yet'}</strong><span>{draft.last_backup_at ? 'JSON, PDF and DOCX exports live in Export & Backup.' : 'A JSON backup is the easiest way to keep a portable copy.'}</span></div><Button variant="secondary" onClick={() => navigate('/backup')}>Open backup center</Button></div></div></NotebookCard>
    </form>

    <section className="danger-zone"><div className="danger-zone-head"><div className="danger-icon"><AlertOctagon size={18} /></div><div><h2>Dangerous actions</h2><p>These options affect your entire study notebook.</p></div></div><div className="danger-zone-row"><div><strong>Reset all study data</strong><span>Delete your cloud records, mistake images, and this device’s offline cache. This cannot be recovered unless you exported a backup.</span></div><Button variant="danger" onClick={() => setFirstResetOpen(true)}><RotateCcw size={15} /> Reset all data</Button></div></section>

    {firstResetOpen && <Dialog title="This will erase your study history." subtitle="Chapters, tests, mistakes, revisions, tasks, goals, sessions and uploaded images will be permanently removed from the cloud and this device." onClose={() => setFirstResetOpen(false)} className="dialog-danger"><div className="reset-warning"><AlertOctagon size={22} /><p>Export a JSON backup first if you may want to restore your data later. This reset does not delete your Supabase login account.</p></div><div className="dialog-actions"><Button variant="secondary" onClick={() => setFirstResetOpen(false)}>Keep my data</Button><Button variant="danger" onClick={() => { setFirstResetOpen(false); setSecondResetOpen(true) }}>Continue to confirmation</Button></div></Dialog>}
    {secondResetOpen && <Dialog title="One last check." subtitle="To confirm, type RESET exactly. Your data will not be recoverable from Stracker after this." onClose={() => { setSecondResetOpen(false); setResetText('') }} className="dialog-danger"><Field label="Type RESET to confirm"><input autoFocus autoComplete="off" value={resetText} onChange={event => setResetText(event.target.value)} /></Field><div className="dialog-actions"><Button variant="secondary" onClick={() => { setSecondResetOpen(false); setResetText('') }}>Cancel</Button><Button variant="danger" loading={resetting} disabled={resetText !== 'RESET'} onClick={() => void resetAll()}><AlertOctagon size={15} /> Permanently reset</Button></div></Dialog>}
  </div>
}

function SectionLabel({ icon, title, note }: { icon: React.ReactNode; title: string; note: string }) {
  return <div className="settings-section-heading"><span className="settings-section-icon">{icon}</span><div><h2>{title}</h2><p>{note}</p></div></div>
}
