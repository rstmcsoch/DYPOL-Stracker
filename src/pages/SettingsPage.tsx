import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertOctagon, Bell, CalendarDays, Check, Cloud, Database, KeyRound, LogOut, Palette, RotateCcw, Save, Shield, SlidersHorizontal, Target, Timer, Type, UserRound } from 'lucide-react'
import { Button, Dialog, Field, NotebookCard, PageHeader, StatusBadge } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../contexts/DataContext'
import { useAppearance } from '../contexts/AppearanceContext'
import { useToast } from '../contexts/ToastContext'
import { clearLocalUserData } from '../lib/database'
import { supabase } from '../lib/supabase'
import { INTERFACE_FONT_OPTIONS } from '../lib/fonts'
import { settingsFieldErrors, settingsSchema } from '../lib/settings-validation'
import { passwordLengthError } from '../lib/auth-rules'
import { AISettingsSection } from '../components/ai/AISettingsSection'
import { ExamTracksSection, ReminderSettingsSection } from '../components/jee/SettingsSections'
import { ListChecks } from 'lucide-react'
import type { AppSettings, Profile, ThemeMode } from '../types'

type SettingsTab = 'account' | 'exam' | 'appearance' | 'rhythm' | 'data'

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'account', label: 'Account', icon: <UserRound size={15} /> },
  { id: 'exam', label: 'Exam', icon: <CalendarDays size={15} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={15} /> },
  { id: 'rhythm', label: 'Study rhythm', icon: <Timer size={15} /> },
  { id: 'data', label: 'Data', icon: <Database size={15} /> }
]

/** Which persisted settings each tab owns. Saving a tab writes only its own fields. */
const TAB_FIELDS: Record<Exclude<SettingsTab, 'data'>, (keyof AppSettings)[]> = {
  account: ['owner_name'],
  exam: ['main_exam_date', 'advanced_exam_date', 'target_score', 'active_track', 'exam_mode', 'weight_high', 'weight_medium', 'weight_low', 'pyq_from_year', 'pyq_to_year'],
  appearance: ['theme', 'interface_font'],
  rhythm: ['weak_threshold', 'strong_threshold', 'dropping_threshold', 'revision_gaps', 'daily_study_goal_minutes', 'sound_enabled', 'reminders_enabled', 'reminder_time', 'reminder_types']
}

export default function SettingsPage() {
  const { data, upsert } = useData()
  const { setInterfaceFont } = useAppearance()
  const { user, signOut } = useAuth()
  const { notify } = useToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<SettingsTab>('account')
  const [draft, setDraft] = useState<AppSettings>(data.settings)
  const [gapsText, setGapsText] = useState(data.settings.revision_gaps.join(', '))
  const [dailyGoalText, setDailyGoalText] = useState(String(data.settings.daily_study_goal_minutes / 60))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [savingTab, setSavingTab] = useState<SettingsTab | null>(null)
  const savingRef = useRef(false)
  const [savedTabTick, setSavedTabTick] = useState<SettingsTab | null>(null)
  const savedTickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The snapshot the draft was last reconciled against, so external settings changes
  // (cloud sync, the header theme switch) land without clobbering unsaved tab edits.
  const savedRef = useRef<AppSettings>(data.settings)
  const savedGapsRef = useRef(data.settings.revision_gaps.join(', '))
  const savedGoalRef = useRef(String(data.settings.daily_study_goal_minutes / 60))
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
    const previous = savedRef.current
    setDraft(current => {
      const next = { ...data.settings }
      // Keep this user's unsaved edits; adopt external updates for untouched fields.
      const keys = Object.keys(next) as (keyof AppSettings)[]
      for (const key of keys) {
        if (current[key] !== previous[key]) (next as Record<string, unknown>)[key] = current[key]
      }
      return next
    })
    setGapsText(current => current !== savedGapsRef.current ? current : data.settings.revision_gaps.join(', '))
    setDailyGoalText(current => current !== savedGoalRef.current ? current : String(data.settings.daily_study_goal_minutes / 60))
    setErrors(current => (Object.keys(current).length ? {} : current))
    savedRef.current = data.settings
    savedGapsRef.current = data.settings.revision_gaps.join(', ')
    savedGoalRef.current = String(data.settings.daily_study_goal_minutes / 60)
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

  const rhythmTextsDirty = () => gapsText !== data.settings.revision_gaps.join(', ') || dailyGoalText !== String(data.settings.daily_study_goal_minutes / 60)

  const isTabDirty = (tab: SettingsTab): boolean => {
    if (tab === 'data') return false
    if (tab === 'rhythm') return TAB_FIELDS.rhythm.some(key => draft[key] !== data.settings[key]) || rhythmTextsDirty()
    return TAB_FIELDS[tab].some(key => draft[key] !== data.settings[key])
  }

  const anyDirty = TABS.some(tab => isTabDirty(tab.id))

  const discardTabChanges = (tab: SettingsTab) => {
    if (tab === 'data') return
    setDraft(current => {
      const next = { ...current }
      for (const key of TAB_FIELDS[tab]) (next as Record<string, unknown>)[key] = data.settings[key]
      return next
    })
    if (tab === 'rhythm') {
      setGapsText(data.settings.revision_gaps.join(', '))
      setDailyGoalText(String(data.settings.daily_study_goal_minutes / 60))
    }
    setErrors({})
  }

  const flashSaved = (tab: SettingsTab) => {
    setSavedTabTick(tab)
    if (savedTickTimer.current) clearTimeout(savedTickTimer.current)
    savedTickTimer.current = setTimeout(() => setSavedTabTick(null), 2600)
  }

  /** Build the candidate this tab would save: saved settings + this tab's draft fields. */
  const tabCandidate = (tab: Exclude<SettingsTab, 'data'>): AppSettings => {
    const hours = tab === 'rhythm' && dailyGoalText.trim() === '' ? Number.NaN : Number(dailyGoalText)
    const rawMinutes = hours * 60
    const roundedMinutes = Math.round(rawMinutes)
    const minutesAreWhole = Number.isFinite(rawMinutes) && Math.abs(rawMinutes - roundedMinutes) < 1e-6
    const revisionGaps = gapsText.split(',').map(value => value.trim() === '' ? Number.NaN : Number(value.trim()))
    const tabDraft: Record<string, unknown> = {}
    for (const key of TAB_FIELDS[tab]) tabDraft[key] = draft[key]
    return {
      ...data.settings,
      ...tabDraft as Partial<AppSettings>,
      revision_gaps: tab === 'rhythm' ? revisionGaps : data.settings.revision_gaps,
      daily_study_goal_minutes: tab === 'rhythm' ? (minutesAreWhole ? roundedMinutes : Number.NaN) : data.settings.daily_study_goal_minutes
    }
  }

  const saveTab = async (tab: Exclude<SettingsTab, 'data'>, event: FormEvent) => {
    event.preventDefault()
    if (savingRef.current) return
    savingRef.current = true
    setSavingTab(tab)

    const candidate = tabCandidate(tab)
    const validated = settingsSchema.safeParse(candidate)
    if (!validated.success) {
      const allErrors = settingsFieldErrors(validated.error)
      // Only this tab's fields can be at fault: every other value comes from saved settings.
      const tabErrors: Record<string, string> = {}
      for (const [key, message] of Object.entries(allErrors)) if (TAB_FIELDS[tab].includes(key as keyof AppSettings)) tabErrors[key] = message
      if (Object.keys(tabErrors).length) {
        setErrors(tabErrors)
        notify('Please correct the highlighted fields.', 'error')
        savingRef.current = false
        setSavingTab(null)
        return
      }
    }

    try {
      const now = new Date().toISOString()
      // Write the saved settings + this tab's validated fields, so unsaved edits in
      // other tabs are never overwritten by saving here.
      const source: AppSettings = validated.success ? { ...candidate, ...validated.data } : candidate
      const tabValues: Record<string, unknown> = {}
      for (const key of TAB_FIELDS[tab]) tabValues[key] = source[key]
      const settings: AppSettings = {
        ...data.settings,
        ...tabValues as Partial<AppSettings>,
        ...(tab === 'rhythm' ? { revision_gaps: [...new Set(validated.success ? validated.data.revision_gaps : candidate.revision_gaps)].sort((a, b) => a - b) } : {}),
        updated_at: now
      }
      await upsert('app_settings', settings)
      if (tab === 'account' && user) {
        const profile: Profile = data.profile
          ? { ...data.profile, display_name: settings.owner_name, updated_at: now }
          : { id: user.id, user_id: user.id, display_name: settings.owner_name, email: user.email, created_at: now, updated_at: now }
        await upsert('profiles', profile)
      }
      if (tab === 'rhythm') {
        setGapsText(settings.revision_gaps.join(', '))
        setDailyGoalText(String(settings.daily_study_goal_minutes / 60))
      }
      setErrors({})
      flashSaved(tab)
      notify(`${TABS.find(item => item.id === tab)?.label} settings saved to your notebook.`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save settings. Retry.', 'error')
    } finally {
      savingRef.current = false
      setSavingTab(null)
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

  const onTablistKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = TABS.findIndex(tab => tab.id === activeTab)
    const offset = event.key === 'ArrowRight' ? 1 : -1
    const next = TABS[(index + offset + TABS.length) % TABS.length]!
    setActiveTab(next.id)
    document.getElementById(`settings-tab-${next.id}`)?.focus()
  }

  const auto = draft.theme === 'auto'
  return <div className="content-page settings-page">
    <PageHeader eyebrow="MAKE IT YOUR OWN" title="Settings" subtitle="Small adjustments for the way you study." doodle={<SlidersHorizontal size={19} />} />

    <div className="settings-tabs-wrap">
      <div className="settings-tabs" role="tablist" aria-label="Settings sections" onKeyDown={onTablistKeyDown}>
        {TABS.map(tab => {
          const active = activeTab === tab.id
          const dirty = isTabDirty(tab.id)
          return <button
            key={tab.id}
            id={`settings-tab-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={`settings-panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            className={`settings-tab ${active ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}<span>{tab.label}</span>
            {dirty && <i className="settings-tab-dot" aria-label="Unsaved changes" title="Unsaved changes" />}
          </button>
        })}
      </div>
    </div>

    <div className="settings-tab-panels">
      {activeTab === 'account' && <div className="settings-panel" role="tabpanel" id="settings-panel-account" aria-labelledby="settings-tab-account">
        <form className="settings-form" noValidate onSubmit={event => void saveTab('account', event)}>
          <fieldset className="settings-form-fields" disabled={savingTab === 'account'}>
            <NotebookCard className="settings-section"><SectionLabel icon={<UserRound size={18} />} title="Owner" note="Your notebook belongs to this account." /><div className="settings-section-content">
              <div className="settings-owner-row"><div className="settings-avatar">{(draft.owner_name.trim()[0] ?? 'S').toUpperCase()}</div><div className="settings-owner-fields"><Field label="Name in your notebook" error={errors.owner_name}><input maxLength={100} value={draft.owner_name} onChange={event => patch('owner_name', event.target.value)} placeholder="What should Stracker call you?" /></Field><Field label="Account email"><input type="email" value={user?.email ?? ''} readOnly aria-readonly="true" /><span className="field-hint">Email and password are managed by secure Supabase authentication.</span></Field></div></div>
              <div className="settings-note-line"><Shield size={15} /> Your records stay private to this account — only you can read or change them. New accounts are created from the sign-up page whenever your Supabase project allows sign-ups.</div>
              <div className="settings-account-actions"><Button type="button" variant="secondary" onClick={() => setPasswordDialogOpen(true)} disabled={!user || user.isLocal}><KeyRound size={15} /> Change password</Button><Button type="button" variant="quiet" onClick={() => void signOutFromSettings()} loading={signingOut}><LogOut size={15} /> Sign out</Button></div>
              {user?.isLocal && <small className="settings-account-note">Password changes are available for a cloud-authenticated owner account.</small>}
            </div></NotebookCard>
            <AISettingsSection />
          </fieldset>
          <TabActions tab="account" dirty={isTabDirty('account')} saving={savingTab === 'account'} savedTick={savedTabTick === 'account'} onDiscard={() => discardTabChanges('account')} />
        </form>
      </div>}

      {activeTab === 'exam' && <div className="settings-panel" role="tabpanel" id="settings-panel-exam" aria-labelledby="settings-tab-exam">
        <form className="settings-form" noValidate onSubmit={event => void saveTab('exam', event)}>
          <fieldset className="settings-form-fields" disabled={savingTab === 'exam'}>
            <NotebookCard className="settings-section"><SectionLabel icon={<CalendarDays size={18} />} title="Exam dates & target" note="A countdown is only useful when the date is yours to choose." /><div className="settings-section-content"><div className="form-grid three">
              <Field label="JEE Main date" error={errors.main_exam_date}><input type="date" value={draft.main_exam_date} onChange={event => patch('main_exam_date', event.target.value)} /></Field>
              <Field label="JEE Advanced date" error={errors.advanced_exam_date}><input type="date" value={draft.advanced_exam_date} onChange={event => patch('advanced_exam_date', event.target.value)} /></Field>
              <Field label="Target score" error={errors.target_score}><input type="number" min="0" max="999999.99" step="0.01" value={Number.isFinite(draft.target_score) ? draft.target_score : ''} onChange={event => patch('target_score', event.target.value === '' ? Number.NaN : Number(event.target.value))} /><span className="field-hint">Compared to a mock with all three subject totals.</span></Field>
            </div><div className="settings-note-line"><Target size={15} /> Leave dates blank until the official dates are confirmed.</div></div></NotebookCard>

            <NotebookCard className="settings-section"><SectionLabel icon={<CalendarDays size={18} />} title="Active track & Exam Mode" note="Tracks share one syllabus. The active track sets the countdown and when Exam Mode turns on." /><div className="settings-section-content"><div className="form-grid three">
              <Field label="Active track" error={errors.active_track}><select value={draft.active_track} onChange={event => patch('active_track', event.target.value as AppSettings['active_track'])}><option value="main1">JEE Main — Session 1</option><option value="main2">JEE Main — Session 2</option><option value="advanced">JEE Advanced</option><option value="boards">Boards</option></select></Field>
              <Field label="Exam Mode" error={errors.exam_mode}><select value={draft.exam_mode} onChange={event => patch('exam_mode', event.target.value as AppSettings['exam_mode'])}><option value="auto">Automatic (final 30 days)</option><option value="on">Always on</option><option value="off">Off</option></select></Field>
            </div><p className="jee-small jee-muted">Automatic Exam Mode needs a date for the active track. It favours revision, PYQs, mocks and weak-area fixes, and stops suggesting new theory.</p></div></NotebookCard>

            <NotebookCard className="settings-section"><SectionLabel icon={<Target size={18} />} title="Weighted progress" note="Chapter importance multiplies into weighted completion. These numbers are yours to set — no JEE weightage is assumed." /><div className="settings-section-content"><div className="form-grid three">
              <Field label="High importance ×" error={errors.weight_high}><input type="number" min="0.1" max="10" step="0.01" value={Number.isFinite(draft.weight_high) ? draft.weight_high : ''} onChange={event => patch('weight_high', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field>
              <Field label="Medium importance ×" error={errors.weight_medium}><input type="number" min="0.1" max="10" step="0.01" value={Number.isFinite(draft.weight_medium) ? draft.weight_medium : ''} onChange={event => patch('weight_medium', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field>
              <Field label="Low importance ×" error={errors.weight_low}><input type="number" min="0.1" max="10" step="0.01" value={Number.isFinite(draft.weight_low) ? draft.weight_low : ''} onChange={event => patch('weight_low', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field>
            </div></div></NotebookCard>

            <NotebookCard className="settings-section"><SectionLabel icon={<ListChecks size={18} />} title="PYQ year range" note="Years shown as tappable chips for each chapter in the PYQ tracker." /><div className="settings-section-content"><div className="form-grid two">
              <Field label="First year" error={errors.pyq_from_year}><input type="number" min="1990" max="2100" step="1" value={Number.isFinite(draft.pyq_from_year) ? draft.pyq_from_year : ''} onChange={event => patch('pyq_from_year', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field>
              <Field label="Last year" error={errors.pyq_to_year}><input type="number" min="1990" max="2100" step="1" value={Number.isFinite(draft.pyq_to_year) ? draft.pyq_to_year : ''} onChange={event => patch('pyq_to_year', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field>
            </div></div></NotebookCard>

            <ExamTracksSection />
          </fieldset>
          <TabActions tab="exam" dirty={isTabDirty('exam')} saving={savingTab === 'exam'} savedTick={savedTabTick === 'exam'} onDiscard={() => discardTabChanges('exam')} />
        </form>
      </div>}

      {activeTab === 'appearance' && <div className="settings-panel" role="tabpanel" id="settings-panel-appearance" aria-labelledby="settings-tab-appearance">
        <form className="settings-form" noValidate onSubmit={event => void saveTab('appearance', event)}>
          <fieldset className="settings-form-fields" disabled={savingTab === 'appearance'}>
            <NotebookCard className="settings-section"><SectionLabel icon={<Palette size={18} />} title="Notebook theme" note="Choose paper, blackboard, or follow this device." /><div className="settings-section-content"><div className="theme-choice-grid" role="radiogroup" aria-label="Theme preference">{([['light','Warm paper','Light notebook paper'],['dark','Chalkboard','Dark, high-contrast study mode'],['auto','Auto','Follow your device setting']] as const).map(([value,title,desc]) => <label className={`theme-choice theme-choice-${value} ${draft.theme === value ? 'selected' : ''}`} key={value}><input type="radio" name="theme" value={value} checked={draft.theme === value} onChange={() => patch('theme', value as ThemeMode)} /><span className="theme-swatch"><i /><i /><i /></span><strong>{title}</strong><small>{desc}</small>{draft.theme === value && <span className="theme-check"><Check size={13} /></span>}</label>)}</div><div className="settings-note-line"><Palette size={15} /> {auto ? 'Auto theme follows the device appearance.' : 'Theme choice is saved with your account.'}</div></div></NotebookCard>

            <NotebookCard className="settings-section">
              <SectionLabel icon={<Type size={18} />} title="Interface font" note="One font across the entire app, including headings, navigation and controls." />
              <div className="settings-section-content">
                <div className="font-choice-grid" role="radiogroup" aria-label="Interface font">
                  {INTERFACE_FONT_OPTIONS.map(option => <label className={`font-choice ${draft.interface_font === option.value ? 'selected' : ''}`} key={option.value}>
                    <input type="radio" name="interface_font" value={option.value} checked={draft.interface_font === option.value} onChange={() => { patch('interface_font', option.value); setInterfaceFont(option.value) }} />
                    {/* These two samples intentionally preview each option; the rest of the UI inherits the global token. */}
                    <span className="font-choice-sample" style={{ fontFamily: option.stack }} aria-hidden="true">Aa</span>
                    <span className="font-choice-copy"><strong style={{ fontFamily: option.stack }}>{option.label}</strong><small>{option.note}</small></span>
                    {draft.interface_font === option.value && <span className="theme-check"><Check size={13} /></span>}
                  </label>)}
                </div>
                <div className="settings-note-line"><Type size={15} /> Applies immediately to every page, heading, sidebar, button, form, dialog, chart label and notification. JSON, CSV, PDF and DOCX exports keep their own typography.</div>
              </div>
            </NotebookCard>
          </fieldset>
          <TabActions tab="appearance" dirty={isTabDirty('appearance')} saving={savingTab === 'appearance'} savedTick={savedTabTick === 'appearance'} onDiscard={() => discardTabChanges('appearance')} />
        </form>
      </div>}

      {activeTab === 'rhythm' && <div className="settings-panel" role="tabpanel" id="settings-panel-rhythm" aria-labelledby="settings-tab-rhythm">
        <form className="settings-form" noValidate onSubmit={event => void saveTab('rhythm', event)}>
          <fieldset className="settings-form-fields" disabled={savingTab === 'rhythm'}>
            <NotebookCard className="settings-section"><SectionLabel icon={<RotateCcw size={18} />} title="Revision rhythm" note="When a chapter is first marked Done, these gaps create its revision schedule." /><div className="settings-section-content"><Field label="Days between revisions" error={errors.revision_gaps}><input value={gapsText} onChange={event => { setGapsText(event.target.value); setErrors(current => { const next = { ...current }; delete next.revision_gaps; return next }) }} placeholder="1, 7, 30" /><span className="field-hint">Comma-separated positive days, sorted automatically. Existing revisions are not moved.</span></Field><div className="revision-gap-preview">{gapsText.split(',').map(value => Number(value.trim())).filter(value => Number.isFinite(value) && value > 0).map((value, index) => <span key={`${value}-${index}`}>R{index + 1}<strong>{value}d</strong></span>)}</div></div></NotebookCard>

            <NotebookCard className="settings-section"><SectionLabel icon={<Timer size={18} />} title="Daily goal & focus" note="A gentle baseline for the timer and study heatmap." /><div className="settings-section-content"><div className="form-grid two"><Field label="Daily study goal (hours)" error={errors.daily_study_goal_minutes}><input type="number" min="0" max="24" step="any" value={dailyGoalText} onChange={event => { setDailyGoalText(event.target.value); setErrors(current => { const next = { ...current }; delete next.daily_study_goal_minutes; return next }) }} /><span className="field-hint">Use whole-minute increments (for example, 1.5 hours).</span></Field><label className="sound-toggle"><input type="checkbox" checked={draft.sound_enabled} onChange={event => patch('sound_enabled', event.target.checked)} /><span className="toggle-visual" /><span><strong>Focus timer sound</strong><small>Play a soft tone when a focus session ends.</small></span></label></div><div className="settings-note-line"><Bell size={15} /> Sound is generated locally in your browser; no audio is sent to a service.{draft.sound_enabled && <button className="text-button" type="button" onClick={playTestTone}>{soundTested ? 'Test tone played' : 'Try a tone'}</button>}</div></div></NotebookCard>

            <ReminderSettingsSection draft={draft} patch={patch} errors={errors} />

            <NotebookCard className="settings-section"><SectionLabel icon={<Target size={18} />} title="Weak-area thresholds" note="These bands describe test results; they do not judge your preparation." /><div className="settings-section-content"><div className="form-grid three">
              <Field label="Weak below (%)" error={errors.weak_threshold}><input type="number" min="0" max="99.99" step="0.01" value={Number.isFinite(draft.weak_threshold) ? draft.weak_threshold : ''} onChange={event => patch('weak_threshold', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field>
              <Field label="Strong above (%)" error={errors.strong_threshold}><input type="number" min="0.01" max="100" step="0.01" value={Number.isFinite(draft.strong_threshold) ? draft.strong_threshold : ''} onChange={event => patch('strong_threshold', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field>
              <Field label="Dropping when down by (points)" error={errors.dropping_threshold}><input type="number" min="0" max="100" step="0.01" value={Number.isFinite(draft.dropping_threshold) ? draft.dropping_threshold : ''} onChange={event => patch('dropping_threshold', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field>
            </div><div className="threshold-preview"><StatusBadge tone="Weak">Weak &lt; {Number.isFinite(draft.weak_threshold) ? draft.weak_threshold : '—'}%</StatusBadge><StatusBadge tone="Okay">Okay {Number.isFinite(draft.weak_threshold) ? draft.weak_threshold : '—'}–{Number.isFinite(draft.strong_threshold) ? draft.strong_threshold : '—'}%</StatusBadge><StatusBadge tone="Strong">Strong &gt; {Number.isFinite(draft.strong_threshold) ? draft.strong_threshold : '—'}%</StatusBadge></div></div></NotebookCard>
          </fieldset>
          <TabActions tab="rhythm" dirty={isTabDirty('rhythm')} saving={savingTab === 'rhythm'} savedTick={savedTabTick === 'rhythm'} onDiscard={() => discardTabChanges('rhythm')} />
        </form>
      </div>}

      {activeTab === 'data' && <div className="settings-panel" role="tabpanel" id="settings-panel-data" aria-labelledby="settings-tab-data">
        <form className="settings-form" noValidate onSubmit={event => event.preventDefault()}>
          <fieldset className="settings-form-fields">
            <NotebookCard className="settings-section backup-status-settings"><SectionLabel icon={<Cloud size={18} />} title="Your data & backup" note="Your cloud data is private to your account. Keep an export somewhere safe." /><div className="settings-section-content"><div className="backup-status-line"><div><strong>{data.settings.last_backup_at ? `Last backup ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(data.settings.last_backup_at))}` : 'No backup recorded yet'}</strong><span>{data.settings.last_backup_at ? 'JSON, PDF and DOCX exports live in Export & Backup.' : 'A JSON backup is the easiest way to keep a portable copy.'}</span></div><Button variant="secondary" type="button" onClick={() => navigate('/backup')}>Open backup center</Button></div></div></NotebookCard>

            <section className="danger-zone" aria-label="Danger zone"><div className="danger-zone-head"><div className="danger-icon"><AlertOctagon size={18} /></div><div><h2>Danger zone</h2><p>These options affect your entire study notebook and cannot be triggered by a normal Save.</p></div></div><div className="danger-zone-row"><div><strong>Reset all study data</strong><span>Delete your cloud records, mistake images, and this device’s offline cache. This cannot be recovered unless you exported a backup.</span></div><Button variant="danger" type="button" onClick={() => setFirstResetOpen(true)}><RotateCcw size={15} /> Reset all data</Button></div></section>
          </fieldset>
        </form>
      </div>}
    </div>

    {anyDirty && <p className="settings-unsaved-note" role="status">You have unsaved changes — look for the marked tab{anyDirty && TABS.filter(tab => isTabDirty(tab.id)).length > 1 ? 's' : ''}. Each tab saves on its own.</p>}

    {passwordDialogOpen && <ChangePasswordDialog onClose={() => setPasswordDialogOpen(false)} />}
    {firstResetOpen && <Dialog title="This will erase your study history." subtitle="Chapters, tests, mistakes, revisions, tasks, goals, sessions and uploaded images will be permanently removed from the cloud and this device." onClose={() => setFirstResetOpen(false)} className="dialog-danger"><div className="reset-warning"><AlertOctagon size={22} /><p>Export a JSON backup first if you may want to restore your data later. This reset does not delete your Supabase login account.</p></div><div className="dialog-actions"><Button variant="secondary" onClick={() => setFirstResetOpen(false)}>Keep my data</Button><Button variant="danger" onClick={() => { setFirstResetOpen(false); setSecondResetOpen(true) }}>Continue to confirmation</Button></div></Dialog>}
    {secondResetOpen && <Dialog title="One last check." subtitle="To confirm, type RESET exactly. Your data will not be recoverable from Stracker after this." onClose={() => { setSecondResetOpen(false); setResetText('') }} className="dialog-danger"><Field label="Type RESET to confirm"><input autoFocus autoComplete="off" value={resetText} onChange={event => setResetText(event.target.value)} /></Field><div className="dialog-actions"><Button variant="secondary" onClick={() => { setSecondResetOpen(false); setResetText('') }} disabled={resetting}>Cancel</Button><Button variant="danger" loading={resetting} disabled={resetText !== 'RESET'} onClick={() => void resetAll()}><AlertOctagon size={15} /> {resetting ? 'Resetting…' : 'Permanently reset'}</Button></div></Dialog>}
  </div>
}

function TabActions({ tab, dirty, saving, savedTick, onDiscard }: { tab: SettingsTab; dirty: boolean; saving: boolean; savedTick: boolean; onDiscard: () => void }) {
  const label = TABS.find(item => item.id === tab)?.label ?? 'Settings'
  return <div className="settings-tab-actions">
    <span className="settings-save-state" aria-live="polite">
      {savedTick ? <><Check size={15} /> Saved</> : dirty ? 'Unsaved changes in this tab' : 'All changes in this tab are saved'}
    </span>
    <div className="settings-tab-buttons">
      {dirty && <Button type="button" variant="quiet" onClick={onDiscard} disabled={saving}>Discard changes</Button>}
      {tab !== 'data' && <Button type="submit" loading={saving} disabled={!dirty && !saving} aria-busy={saving}><Save size={16} /> {saving ? 'Saving…' : `Save ${label.toLowerCase()} settings`}</Button>}
    </div>
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
    const lengthError = passwordLengthError(password)
    if (lengthError) nextErrors.password = lengthError
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
