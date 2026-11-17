import { useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertOctagon, Bell, CalendarDays, Check, Cloud, Database, KeyRound, LogOut, Palette, RotateCcw, Save, Shield, SlidersHorizontal, Target, Timer, Type, UserRound } from 'lucide-react'
import { Button, Dialog, Field, InfoTip, NotebookCard, PageHeader, StatusBadge } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../contexts/DataContext'
import { useAppearancePreview, useReadingFontPreview } from '../contexts/AppearanceContext'
import { useToast } from '../contexts/ToastContext'
import { clearLocalUserData } from '../lib/database'
import { supabase } from '../lib/supabase'
import { readingFontOption, READING_FONT_OPTIONS } from '../lib/fonts'
import { COLOR_THEME_OPTIONS } from '../lib/themes'
import { MAX_EXTRA_EXAMS, settingsFieldErrors, settingsFormSchema } from '../lib/settings-validation'
import { DateInput } from '../components/DateTimeInputs'
import { createId } from '../lib/id'
import { passwordLengthError } from '../lib/auth-rules'
import { AISettingsSection } from '../components/ai/AISettingsSection'
import { ExamTracksSection, ReminderSettingsSection } from '../components/jee/SettingsSections'
import { ExamSelectionSection } from '../components/jee/ExamSelectionSection'
import { ListChecks } from 'lucide-react'
import type { AppSettings, ExtraExam, Profile, ThemeMode } from '../types'
import { availableTracks, chosenExamTitle, isJeeSettings, trackLabels } from '../lib/jee/exam'
import { T } from '../lib/student-layout/T'
import { useLabelText, usePageSlots } from '../lib/student-layout/use-layout'
import { revealThemeChange } from '../lib/theme-reveal'

/** The light/dark mode a Theme preference renders as on this device right now. */
function resolvesTo(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'auto' ? (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode
}

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
  exam: ['main_exam_date', 'advanced_exam_date', 'target_score', 'active_track', 'exam_mode', 'weight_high', 'weight_medium', 'weight_low', 'pyq_from_year', 'pyq_to_year', 'extra_exams'],
  appearance: ['theme', 'interface_font', 'color_theme'],
  rhythm: ['weak_threshold', 'strong_threshold', 'dropping_threshold', 'revision_gaps', 'daily_study_goal_minutes', 'sound_enabled', 'reminders_enabled', 'reminder_time', 'reminder_types']
}

/** Field-level equality for persisted values, including arrays such as revision gaps. */
const sameSettingValue = (left: unknown, right: unknown): boolean =>
  Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right)

export default function SettingsPage() {
  const sl = usePageSlots('settings')
  const { data, upsert, updateSettings } = useData()
  const jeeExam = isJeeSettings(data.settings)
  const examTitle = chosenExamTitle(data.settings)
  const examTrackLabels = trackLabels(data.settings)
  const { user, signOut } = useAuth()
  // Accounts created with Google have no Stracker password until the student sets one.
  const signsInWithGoogle = Boolean(user?.providers?.includes('google'))
  const googleOnly = signsInWithGoogle && !user?.providers?.includes('email')
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
  // The unsaved Appearance draft previews live across the app. Leaving this page clears the
  // preview, so an unsaved font never outlives the draft that produced it.
  useReadingFontPreview(draft.interface_font)
  useAppearancePreview(draft.theme, draft.color_theme)

  // Layout phase: when saved settings arrive (or change externally), the draft adopts them before
  // the browser paints, so the live font preview never shows a stale draft for a frame.
  useLayoutEffect(() => {
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
    if (tab === 'rhythm') return TAB_FIELDS.rhythm.some(key => !sameSettingValue(draft[key], data.settings[key])) || rhythmTextsDirty()
    return TAB_FIELDS[tab].some(key => !sameSettingValue(draft[key], data.settings[key]))
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
    const validated = settingsFormSchema.safeParse(candidate)
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
      // This tab's validated values, normalised the way they are stored.
      const source: AppSettings = validated.success ? { ...candidate, ...validated.data } : candidate
      const values: Partial<Record<keyof AppSettings, unknown>> = {}
      for (const key of TAB_FIELDS[tab]) values[key] = source[key]
      if (tab === 'rhythm') values.revision_gaps = [...new Set(validated.success ? validated.data.revision_gaps : candidate.revision_gaps)].sort((a, b) => a - b)
      // Write only the fields this tab changed. The settings writer merges them into the latest
      // committed row, so saving here can never revert another tab or the header theme switch,
      // even when this draft still holds an older value for a field it did not touch.
      const changed = (Object.keys(values) as (keyof AppSettings)[]).filter(key => !sameSettingValue(values[key], data.settings[key]))
      let saved: AppSettings = data.settings
      if (changed.length) {
        const patch: Partial<AppSettings> = {}
        for (const key of changed) (patch as Record<string, unknown>)[key] = values[key]
        saved = await updateSettings(current => ({ ...current, ...patch }))
      }
      if (tab === 'account' && user) {
        const profile: Profile = data.profile
          ? { ...data.profile, display_name: saved.owner_name, updated_at: now }
          : { id: user.id, user_id: user.id, display_name: saved.owner_name, email: user.email, created_at: now, updated_at: now }
        await upsert('profiles', profile)
      }
      if (tab === 'rhythm') {
        setGapsText(saved.revision_gaps.join(', '))
        setDailyGoalText(String(saved.daily_study_goal_minutes / 60))
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
  const selectedReadingFont = readingFontOption(draft.interface_font)
  return <div className="content-page settings-page">
    <PageHeader layoutId="settings.header" title="Settings" doodle={<SlidersHorizontal size={19} />} />

    <div {...sl.attrs('tabs')} className="settings-tabs-wrap">
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
            {tab.icon}<span><T k={`settings:tab-${tab.id}`}>{tab.label}</T></span>
            {dirty && <i className="settings-tab-dot" aria-label="Unsaved changes" title="Unsaved changes" />}
          </button>
        })}
      </div>
    </div>

    <div {...sl.attrs('panels')} className="settings-tab-panels">
      {activeTab === 'account' && <div {...sl.attrs('panel-account')} className="settings-panel" role="tabpanel" id="settings-panel-account" aria-labelledby="settings-tab-account">
        <form className="settings-form" noValidate onSubmit={event => void saveTab('account', event)}>
          <fieldset className="settings-form-fields" disabled={savingTab === 'account'}>
            <NotebookCard className="settings-section"><SectionLabel lk="settings:owner" icon={<UserRound size={18} />} title="Owner" /><div className="settings-section-content">
              <div className="settings-owner-row"><div className="settings-avatar">{(draft.owner_name.trim()[0] ?? 'S').toUpperCase()}</div><div className="settings-owner-fields"><Field lk="settings:display-name" label="Display name" required error={errors.owner_name}><input required maxLength={100} value={draft.owner_name} onChange={event => patch('owner_name', event.target.value)} placeholder="What should Stracker call you?" /></Field><Field lk="settings:account-email" label="Account email"><input type="email" value={user?.email ?? ''} readOnly aria-readonly="true" /><span className="field-hint">{googleOnly ? 'You sign in with Google. Your email comes from your Google account.' : signsInWithGoogle ? 'You can sign in with Google or with your email and password.' : 'You sign in with your email and password.'}</span></Field></div></div>
              <div className="settings-note-line"><Shield size={15} />{' '}<T k="settings:your-records-stay-private-to-this-accoun">{"Your study records are private to your account."}</T></div>
              <div className="settings-account-actions"><Button type="button" variant="secondary" onClick={() => setPasswordDialogOpen(true)} disabled={!user || user.isLocal}><KeyRound size={15} /> {googleOnly ? 'Set a password' : 'Change password'}</Button></div>
              {googleOnly && <small className="settings-account-note"><T k="settings:optional-a-password-lets-you-also-log-in">{"Optional. Lets you also log in with email. Google still works."}</T></small>}
              {user?.isLocal && <small className="settings-account-note"><T k="settings:password-changes-are-available-for-a-clo">{"Password changes need a cloud account."}</T></small>}
            </div></NotebookCard>
            <AISettingsSection />
          </fieldset>
          <TabActions tab="account" dirty={isTabDirty('account')} saving={savingTab === 'account'} savedTick={savedTabTick === 'account'} onDiscard={() => discardTabChanges('account')} />
        </form>
      </div>}

      {activeTab === 'exam' && <div {...sl.attrs('panel-exam')} className="settings-panel" role="tabpanel" id="settings-panel-exam" aria-labelledby="settings-tab-exam">
        <ExamSelectionSection />
        <form className="settings-form" noValidate onSubmit={event => void saveTab('exam', event)}>
          <fieldset className="settings-form-fields" disabled={savingTab === 'exam'}>
            <NotebookCard className="settings-section"><SectionLabel lk="settings:exam-dates-target" icon={<CalendarDays size={18} />} title="Exam dates & target" /><div className="settings-section-content"><div className="form-grid three">
              <Field label={jeeExam ? 'JEE Main date' : `${examTitle} date`} error={errors.main_exam_date}><DateInput label={jeeExam ? 'JEE Main date' : `${examTitle} date`} value={draft.main_exam_date} invalid={Boolean(errors.main_exam_date)} onChange={value => patch('main_exam_date', value)} /></Field>
              {jeeExam && <Field lk="settings:jee-advanced-date" label="JEE Advanced date" error={errors.advanced_exam_date}><DateInput label="JEE Advanced date" value={draft.advanced_exam_date} invalid={Boolean(errors.advanced_exam_date)} onChange={value => patch('advanced_exam_date', value)} /></Field>}
              <Field lk="settings:target-score" label="Target score" error={errors.target_score}><input type="number" min="0" max="999999.99" step="0.01" value={Number.isFinite(draft.target_score) ? draft.target_score : ''} onChange={event => patch('target_score', event.target.value === '' ? Number.NaN : Number(event.target.value))} /><span className="field-hint">{jeeExam ? 'Compared to a mock with all three subject totals.' : 'Compared to a full mock with every subject total.'}</span></Field>
            </div>
            <ExtraExamRows exams={draft.extra_exams ?? []} error={errors.extra_exams} onChange={next => patch('extra_exams', next)} />
            <div className="settings-note-line"><Target size={15} />{' '}<T k="settings:leave-dates-blank-until-the-official-dat">{"Leave blank until official dates are out."}</T></div></div></NotebookCard>

            <NotebookCard className="settings-section"><SectionLabel lk="settings:active-track-exam-mode" lk2="settings:the-active-track-sets-the-countdown-and" icon={<CalendarDays size={18} />} title="Active track & Exam Mode" note="Sets your countdown and Exam Mode." /><div className="settings-section-content"><div className="form-grid three">
              <Field lk="settings:active-track" label="Active track" error={errors.active_track}><select value={draft.active_track} onChange={event => patch('active_track', event.target.value as AppSettings['active_track'])}>{availableTracks(data.settings).map(track => <option key={track} value={track}>{examTrackLabels[track]}</option>)}{!availableTracks(data.settings).includes(draft.active_track) && <option value={draft.active_track}>{examTrackLabels.main1}</option>}</select></Field>
              <Field lk="settings:exam-mode" label="Exam Mode" error={errors.exam_mode}><select value={draft.exam_mode} onChange={event => patch('exam_mode', event.target.value as AppSettings['exam_mode'])}><option value="auto">Automatic (final 30 days)</option><option value="on">Always on</option><option value="off">Off</option></select></Field>
            </div><p className="jee-small jee-muted"><T k="settings:exam-mode-needs-a-date-for-the-active-tr">{"Exam Mode needs a date for the active track."}</T></p></div></NotebookCard>

            <NotebookCard className="settings-section"><SectionLabel lk="settings:weighted-progress" lk2="settings:importance-multiplies-into-weighted-comp" icon={<Target size={18} />} title="Weighted progress" note="Importance multiplies into weighted completion." /><div className="settings-section-content"><div className="form-grid three">
              <Field lk="settings:high-importance" label="High importance ×" error={errors.weight_high}><input type="number" min="0.1" max="10" step="0.01" value={Number.isFinite(draft.weight_high) ? draft.weight_high : ''} onChange={event => patch('weight_high', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field>
              <Field lk="settings:medium-importance" label="Medium importance ×" error={errors.weight_medium}><input type="number" min="0.1" max="10" step="0.01" value={Number.isFinite(draft.weight_medium) ? draft.weight_medium : ''} onChange={event => patch('weight_medium', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field>
              <Field lk="settings:low-importance" label="Low importance ×" error={errors.weight_low}><input type="number" min="0.1" max="10" step="0.01" value={Number.isFinite(draft.weight_low) ? draft.weight_low : ''} onChange={event => patch('weight_low', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field>
            </div></div></NotebookCard>

            <NotebookCard className="settings-section"><SectionLabel lk="settings:pyq-year-range" lk2="settings:years-shown-per-chapter-in-the-pyq-track" icon={<ListChecks size={18} />} title="PYQ year range" note="Years shown in the PYQ tracker." /><div className="settings-section-content"><div className="form-grid two">
              <Field lk="settings:first-year" label="First year" error={errors.pyq_from_year}><input type="number" min="1990" max="2100" step="1" value={Number.isFinite(draft.pyq_from_year) ? draft.pyq_from_year : ''} onChange={event => patch('pyq_from_year', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field>
              <Field lk="settings:last-year" label="Last year" error={errors.pyq_to_year}><input type="number" min="1990" max="2100" step="1" value={Number.isFinite(draft.pyq_to_year) ? draft.pyq_to_year : ''} onChange={event => patch('pyq_to_year', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field>
            </div></div></NotebookCard>

            <ExamTracksSection />
          </fieldset>
          <TabActions tab="exam" dirty={isTabDirty('exam')} saving={savingTab === 'exam'} savedTick={savedTabTick === 'exam'} onDiscard={() => discardTabChanges('exam')} />
        </form>
      </div>}

      {activeTab === 'appearance' && <div {...sl.attrs('panel-appearance')} className="settings-panel" role="tabpanel" id="settings-panel-appearance" aria-labelledby="settings-tab-appearance">
        <form className="settings-form" noValidate onSubmit={event => void saveTab('appearance', event)}>
          <fieldset className="settings-form-fields" disabled={savingTab === 'appearance'}>
            <NotebookCard className="settings-section"><SectionLabel lk="settings:notebook-theme" icon={<Palette size={18} />} title="Notebook theme" /><div className="settings-section-content"><div className="theme-choice-grid" role="radiogroup" aria-label="Theme preference">{([['light','Warm paper','Light notebook paper'],['dark','Chalkboard','Dark, high-contrast study mode'],['auto','Auto','Follow your device setting']] as const).map(([value,title,desc]) => <label className={`theme-choice theme-choice-${value} ${draft.theme === value ? 'selected' : ''}`} key={value}><input type="radio" name="theme" value={value} checked={draft.theme === value} onChange={event => revealThemeChange(event.currentTarget.closest('label'), () => patch('theme', value as ThemeMode), resolvesTo(value) !== document.documentElement.dataset.theme)} /><span className="theme-swatch"><i /><i /><i /></span><strong>{title}</strong><small>{desc}</small>{draft.theme === value && <span className="theme-check"><Check size={13} /></span>}</label>)}</div><div className="settings-note-line"><Palette size={15} /> {auto ? 'Auto theme follows the device appearance.' : 'Live preview. Save to keep it.'}</div></div></NotebookCard>

            <NotebookCard className="settings-section"><SectionLabel lk="settings:color-theme" lk2="settings:light-dark-variant-follows-the-mode-abov" icon={<Palette size={18} />} title="Color theme" note="Light/dark variant follows the mode above." /><div className="settings-section-content"><div className="color-theme-grid" role="radiogroup" aria-label="Color theme">{COLOR_THEME_OPTIONS.map(option => <label className={`color-theme-choice ${draft.color_theme === option.value ? 'selected' : ''}`} key={option.value}><input type="radio" name="color_theme" value={option.value} checked={draft.color_theme === option.value} onChange={() => patch('color_theme', option.value)} /><span className="color-theme-swatch" aria-hidden="true"><span className="swatch-half light"><i style={{ background: option.light[0] }} /><i style={{ background: option.light[1] }} /><i style={{ background: option.light[2] }} /></span><span className="swatch-half dark"><i style={{ background: option.dark[0] }} /><i style={{ background: option.dark[1] }} /><i style={{ background: option.dark[2] }} /></span></span><strong>{option.label}</strong><small>{option.description}</small>{draft.color_theme === option.value && <span className="theme-check"><Check size={13} /></span>}</label>)}</div><div className="settings-note-line"><Palette size={15} />{' '}<T k="settings:the-top-right-light-night-switch-keeps-t">{"The Light/Night switch only changes the mode."}</T></div></div></NotebookCard>

            <NotebookCard className="settings-section">
              <SectionLabel lk="settings:reading-font" lk2="settings:body-text-menus-and-buttons" icon={<Type size={18} />} title="Reading font" note="Body text, menus and buttons." />
              <div className="settings-section-content">
                <div className="font-choice-grid" role="radiogroup" aria-label="Reading font">
                  {READING_FONT_OPTIONS.map(option => <label className={`font-choice ${draft.interface_font === option.value ? 'selected' : ''}`} key={option.value} style={{ '--body-scale': option.scale } as CSSProperties}>
                    <input type="radio" name="interface_font" value={option.value} checked={draft.interface_font === option.value} onChange={() => patch('interface_font', option.value)} />
                    {/* These samples intentionally preview each candidate; the rest of the UI uses the applied Reading font. */}
                    <span className="font-choice-sample" style={{ fontFamily: option.stack }} aria-hidden="true"><T k="settings:aa">{"Aa"}</T></span>
                    <span className="font-choice-copy" style={{ fontFamily: option.stack }}><strong>{option.label}</strong><small>{option.description}</small></span>
                    {draft.interface_font === option.value && <span className="theme-check"><Check size={13} /></span>}
                  </label>)}
                </div>
                <div className="typography-live-preview" style={{ '--font-body': selectedReadingFont.stack, '--body-scale': selectedReadingFont.scale } as CSSProperties} aria-live="polite">
                  <div className="typography-preview-copy">
                    <span className="type-overline"><T k="settings:live-preview">{"LIVE PREVIEW"}</T></span>
                    <h2 className="type-h2"><T k="settings:a-clearer-study-session">{"A clearer study session"}</T></h2>
                    <p className="type-body"><T k="settings:keep-your-notes-easy-to-follow-so-you-ca">{"Keep your notes easy to follow, so you can spend more time understanding each idea."}</T></p>
                    <span className="type-caption"><T k="settings:your-saved-preference-changes-content-te">{"Changes body text, not headings."}</T></span>
                  </div>
                  <button className="type-button typography-preview-button" type="button"><T k="settings:review-todays-plan">{"Review today’s plan"}</T></button>
                </div>
                <div className="settings-note-line"><Type size={15} /> Previews while Settings is open. Save to keep it. Headings don’t change.</div>
              </div>
            </NotebookCard>
          </fieldset>
          <TabActions tab="appearance" dirty={isTabDirty('appearance')} saving={savingTab === 'appearance'} savedTick={savedTabTick === 'appearance'} onDiscard={() => discardTabChanges('appearance')} />
        </form>
      </div>}

      {activeTab === 'rhythm' && <div {...sl.attrs('panel-rhythm')} className="settings-panel" role="tabpanel" id="settings-panel-rhythm" aria-labelledby="settings-tab-rhythm">
        <form className="settings-form" noValidate onSubmit={event => void saveTab('rhythm', event)}>
          <fieldset className="settings-form-fields" disabled={savingTab === 'rhythm'}>
            <NotebookCard className="settings-section"><SectionLabel lk="settings:revision-rhythm" lk2="settings:gaps-after-a-chapter-is-first-marked-don" icon={<RotateCcw size={18} />} title="Revision rhythm" note="Days after a chapter is marked Done." /><div className="settings-section-content"><Field lk="settings:days-between-revisions" label="Days between revisions" error={errors.revision_gaps}><input value={gapsText} onChange={event => { setGapsText(event.target.value); setErrors(current => { const next = { ...current }; delete next.revision_gaps; return next }) }} placeholder="1, 7, 30" /><span className="field-hint"><T k="settings:comma-separated-positive-days-sorted-aut">{"Days, separated by commas. Existing revisions don’t move."}</T></span></Field><div className="revision-gap-preview">{gapsText.split(',').map(value => Number(value.trim())).filter(value => Number.isFinite(value) && value > 0).map((value, index) => <span key={`${value}-${index}`}>R{index + 1}<strong>{value}d</strong></span>)}</div></div></NotebookCard>

            <NotebookCard className="settings-section"><SectionLabel lk="settings:daily-goal-focus" icon={<Timer size={18} />} title="Daily goal & focus" /><div className="settings-section-content"><div className="form-grid two"><Field lk="settings:daily-study-goal-hours" label="Daily study goal (hours)" error={errors.daily_study_goal_minutes}><input type="number" min={1 / 60} max="24" step="any" value={dailyGoalText} onChange={event => { setDailyGoalText(event.target.value); setErrors(current => { const next = { ...current }; delete next.daily_study_goal_minutes; return next }) }} /><span className="field-hint"><T k="settings:use-whole-minute-increments-for-example">{"Whole minutes only, e.g. 1.5 hours."}</T></span></Field><label className="sound-toggle"><input type="checkbox" checked={draft.sound_enabled} onChange={event => patch('sound_enabled', event.target.checked)} /><span className="toggle-visual" /><span><strong><T k="settings:focus-timer-sound">{"Focus timer sound"}</T></strong><small><T k="settings:play-a-soft-tone-when-a-focus-session-en">{"Play a sound when a session ends."}</T></small></span></label></div><div className="settings-note-line"><Bell size={15} /> Sound is generated locally in your browser; no audio is sent to a service.{draft.sound_enabled && <button className="text-button" type="button" onClick={playTestTone}>{soundTested ? 'Test tone played' : 'Try a tone'}</button>}</div></div></NotebookCard>

            <ReminderSettingsSection draft={draft} patch={patch} errors={errors} />

            <NotebookCard className="settings-section"><SectionLabel lk="settings:weak-area-thresholds" lk2="settings:bands-for-test-results" icon={<Target size={18} />} title="Weak-area thresholds" note="Bands for test results." /><div className="settings-section-content"><div className="form-grid three">
              <Field lk="settings:weak-below" label="Weak below (%)" error={errors.weak_threshold}><input type="number" min="0" max="99.99" step="0.01" value={Number.isFinite(draft.weak_threshold) ? draft.weak_threshold : ''} onChange={event => patch('weak_threshold', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field>
              <Field lk="settings:strong-above" label="Strong above (%)" error={errors.strong_threshold}><input type="number" min="0.01" max="100" step="0.01" value={Number.isFinite(draft.strong_threshold) ? draft.strong_threshold : ''} onChange={event => patch('strong_threshold', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field>
              <Field lk="settings:dropping-when-down-by-points" label="Dropping when down by (points)" error={errors.dropping_threshold}><input type="number" min="0" max="100" step="0.01" value={Number.isFinite(draft.dropping_threshold) ? draft.dropping_threshold : ''} onChange={event => patch('dropping_threshold', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></Field>
            </div><div className="threshold-preview"><StatusBadge tone="Weak">Weak &lt; {Number.isFinite(draft.weak_threshold) ? draft.weak_threshold : '—'}%</StatusBadge><StatusBadge tone="Okay">Okay {Number.isFinite(draft.weak_threshold) ? draft.weak_threshold : '—'}–{Number.isFinite(draft.strong_threshold) ? draft.strong_threshold : '—'}%</StatusBadge><StatusBadge tone="Strong">Strong &gt; {Number.isFinite(draft.strong_threshold) ? draft.strong_threshold : '—'}%</StatusBadge></div></div></NotebookCard>
          </fieldset>
          <TabActions tab="rhythm" dirty={isTabDirty('rhythm')} saving={savingTab === 'rhythm'} savedTick={savedTabTick === 'rhythm'} onDiscard={() => discardTabChanges('rhythm')} />
        </form>
      </div>}

      {activeTab === 'data' && <div {...sl.attrs('panel-data')} className="settings-panel" role="tabpanel" id="settings-panel-data" aria-labelledby="settings-tab-data">
        <form className="settings-form" noValidate onSubmit={event => event.preventDefault()}>
          <fieldset className="settings-form-fields">
            <NotebookCard className="settings-section backup-status-settings"><SectionLabel lk="settings:export-backup" lk2="settings:private-to-your-account-keep-an-export-s" icon={<Cloud size={18} />} title="Export & backup" note="Private to your account. Keep an export safe." /><div className="settings-section-content"><div className="backup-status-line"><div><strong>{data.settings.last_backup_at ? `Last backup ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(data.settings.last_backup_at))}` : 'No backup recorded yet'}</strong><span>{data.settings.last_backup_at ? 'JSON, PDF and DOCX exports live in Export & Backup.' : 'A JSON backup is the easiest way to keep a portable copy.'}</span></div><Button variant="secondary" type="button" onClick={() => navigate('/backup')}><T k="settings:open-export-backup">{"Open Export & backup"}</T></Button></div></div></NotebookCard>

            <section className="danger-zone" aria-label="Danger zone"><div className="danger-zone-head"><div className="danger-icon"><AlertOctagon size={18} /></div><div><h2><T k="settings:danger-zone">{"Danger zone"}</T></h2><p><T k="settings:these-options-affect-your-entire-study-n">{"These affect your whole notebook."}</T></p></div></div><div className="danger-zone-row"><div><strong><T k="settings:reset-all-study-data">{"Reset all study data"}</T></strong><span><T k="settings:delete-your-cloud-records-mistake-images">{"Delete your cloud records, mistake images, and this device’s offline cache. This cannot be recovered unless you exported a backup."}</T></span></div><Button variant="danger" type="button" onClick={() => setFirstResetOpen(true)}><RotateCcw size={15} />{' '}<T k="settings:reset-all-data">{"Reset all data"}</T></Button></div></section>
          </fieldset>
        </form>
      </div>}
    </div>

    {anyDirty && <p className="settings-unsaved-note" role="status">Unsaved changes in the marked tab{anyDirty && TABS.filter(tab => isTabDirty(tab.id)).length > 1 ? 's' : ''}.</p>}
    <div className="settings-signout"><Button type="button" variant="quiet" onClick={() => void signOutFromSettings()} loading={signingOut}><LogOut size={15} />{' '}<T k="settings:sign-out">{"Sign out"}</T></Button></div>

    {passwordDialogOpen && <ChangePasswordDialog mode={googleOnly ? 'set' : 'change'} onClose={() => setPasswordDialogOpen(false)} />}
    {firstResetOpen && <Dialog lk="settings:this-will-erase-your-study-history" lk2="settings:chapters-tests-mistakes-revisions-tasks" title="This will erase your study history." subtitle="Chapters, tests, mistakes, revisions, tasks, goals, sessions and uploaded images will be permanently removed from the cloud and this device." onClose={() => setFirstResetOpen(false)} className="dialog-danger"><div className="reset-warning"><AlertOctagon size={22} /><p><T k="settings:export-a-json-backup-first-if-you-may-wa">{"Export a JSON backup first if you may want to restore your data later. This reset does not delete your Supabase login account."}</T></p></div><div className="dialog-actions"><Button variant="secondary" onClick={() => setFirstResetOpen(false)}><T k="settings:keep-my-data">{"Keep my data"}</T></Button><Button variant="danger" onClick={() => { setFirstResetOpen(false); setSecondResetOpen(true) }}><T k="settings:continue-to-confirmation">{"Continue to confirmation"}</T></Button></div></Dialog>}
    {secondResetOpen && <Dialog lk="settings:one-last-check" lk2="settings:to-confirm-type-reset-exactly-your-data" title="One last check." subtitle="To confirm, type RESET exactly. Your data will not be recoverable from Stracker after this." onClose={() => { setSecondResetOpen(false); setResetText('') }} className="dialog-danger"><Field lk="settings:type-reset-to-confirm" label="Type RESET to confirm"><input autoFocus autoComplete="off" value={resetText} onChange={event => setResetText(event.target.value)} /></Field><div className="dialog-actions"><Button variant="secondary" onClick={() => { setSecondResetOpen(false); setResetText('') }} disabled={resetting}><T k="settings:cancel">{"Cancel"}</T></Button><Button variant="danger" loading={resetting} disabled={resetText !== 'RESET'} onClick={() => void resetAll()}><AlertOctagon size={15} /> {resetting ? 'Resetting…' : 'Permanently reset'}</Button></div></Dialog>}
  </div>
}

function TabActions({ tab, dirty, saving, savedTick, onDiscard }: { tab: SettingsTab; dirty: boolean; saving: boolean; savedTick: boolean; onDiscard: () => void }) {
  const label = TABS.find(item => item.id === tab)?.label ?? 'Settings'
  return <div className="settings-tab-actions">
    <span className="settings-save-state" aria-live="polite">
      {savedTick ? <><Check size={15} /> Saved</> : dirty ? 'Unsaved changes in this tab' : 'All changes in this tab are saved'}
    </span>
    <div className="settings-tab-buttons">
      {dirty && <Button type="button" variant="quiet" onClick={onDiscard} disabled={saving}><T k="settings:discard-changes">{"Discard changes"}</T></Button>}
      {tab !== 'data' && <Button type="submit" loading={saving} disabled={!dirty && !saving} aria-busy={saving}><Save size={16} /> {saving ? 'Saving…' : `Save ${label.toLowerCase()} settings`}</Button>}
    </div>
  </div>
}

function ChangePasswordDialog({ onClose, mode = 'change' }: { onClose: () => void; mode?: 'change' | 'set' }) {
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
      notify(mode === 'set' ? 'Password set. You can now also log in with your email.' : 'Your password has been updated.')
      setPassword(''); setConfirmation(''); onClose()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update the password. Try again.', 'error')
    } finally { savingRef.current = false; setSaving(false) }
  }
  return <Dialog title={mode === 'set' ? 'Set a password' : 'Change password'} onClose={onClose} className="dialog-narrow"><form className="form-stack" noValidate onSubmit={submit}>
    <Field lk="settings:new-password" lk2="settings:at-least-8-characters" label="New password" required hint="At least 8 characters." error={errors.password}><input type="password" autoComplete="new-password" value={password} onChange={event => { setPassword(event.target.value); setErrors(current => ({ ...current, password: undefined })) }} /></Field>
    <Field lk="settings:confirm-new-password" label="Confirm new password" required error={errors.confirmation}><input type="password" autoComplete="new-password" value={confirmation} onChange={event => { setConfirmation(event.target.value); setErrors(current => ({ ...current, confirmation: undefined })) }} /></Field>
    <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={saving}><T k="settings:cancel">{"Cancel"}</T></Button><Button type="submit" loading={saving}><KeyRound size={15} /> {saving ? 'Saving…' : mode === 'set' ? 'Set password' : 'Update password'}</Button></div>
  </form></Dialog>
}

function SectionLabel({ icon, title, note, lk, lk2 }: { icon: React.ReactNode; title: string; note?: string; lk?: string; lk2?: string }) {
  const tip = useLabelText(lk2, note)
  return <div className="settings-section-heading"><span className="settings-section-icon">{icon}</span><div><h2>{lk ? <T k={lk}>{title}</T> : title}{tip && <InfoTip text={tip} />}</h2></div></div>
}

/** "Add exam" rows: extra exams (name + optional date) kept beside the main exam. */
function ExtraExamRows({ exams, error, onChange }: { exams: ExtraExam[]; error?: string; onChange: (next: ExtraExam[]) => void }) {
  const update = (id: string, change: Partial<ExtraExam>) => onChange(exams.map(item => item.id === id ? { ...item, ...change } : item))
  return <div className="settings-extra-exams">
    {exams.length > 0 && <ul className="settings-extra-exam-list" aria-label="Extra exams">
      {exams.map((exam, index) => <li key={exam.id} className="settings-extra-exam-row">
        <Field label={`Exam ${index + 2} name`}><input maxLength={60} value={exam.label} placeholder="e.g. BITSAT" onChange={event => update(exam.id, { label: event.target.value })} /></Field>
        <Field label={`Exam ${index + 2} date`}><DateInput label={`${exam.label.trim() || `Exam ${index + 2}`} date`} value={exam.exam_date} onChange={value => update(exam.id, { exam_date: value })} /></Field>
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange(exams.filter(item => item.id !== exam.id))} aria-label={`Remove ${exam.label.trim() || `exam ${index + 2}`}`}><T k="settings:remove">{"Remove"}</T></Button>
      </li>)}
    </ul>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <Button type="button" variant="secondary" size="sm" disabled={exams.length >= MAX_EXTRA_EXAMS} onClick={() => onChange([...exams, { id: createId(), label: '', exam_date: '' }])}><T k="settings:add-exam">{"+ Add exam"}</T></Button>
    {exams.length >= MAX_EXTRA_EXAMS && <small className="field-hint">Up to {MAX_EXTRA_EXAMS} extra exams.</small>}
  </div>
}
