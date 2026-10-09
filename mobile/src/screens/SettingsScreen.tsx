import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { format } from 'date-fns'
import {
  AlertOctagon, Bell, CalendarDays, Check, Cloud, Database, KeyRound, ListChecks, LogOut, Palette, RotateCcw, Save,
  Shield, SlidersHorizontal, Target, Timer, Type, UserRound
} from '../components/icons'
import { AISettingsSection } from '../components/ai/AISettingsSection'
import { ExamTracksSection, ReminderSettingsSection } from '../components/jee/SettingsSections'
import { Button } from '../components/ui/Button'
import { DateField, SelectField, SwitchRow, TextField } from '../components/ui/Forms'
import { ConfirmDialog, Dialog } from '../components/ui/Overlays'
import { Screen } from '../components/ui/Screen'
import { NotebookCard, PageHeader, StatusBadge } from '../components/ui/Surfaces'
import { useTheme } from '../contexts/AppearanceContext'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { playFocusTone } from '../lib/tone'
import { READING_FONT_OPTIONS, readingFontOption } from '../shared/lib/fonts'
import { COLOR_THEME_OPTIONS } from '../shared/lib/themes'
import { settingsFieldErrors, settingsSchema } from '../shared/lib/settings-validation'
import { passwordLengthError } from '../shared/lib/auth-rules'
import { READING_FAMILIES, IDENTITY_FONT } from '../theme/fonts'
import { resolvePalette } from '../theme/theme'
import type { AppSettings, ColorTheme, Profile, ReadingFont, ThemeMode } from '../shared/types'

type SettingsTab = 'account' | 'exam' | 'appearance' | 'rhythm' | 'data'
type EditableTab = Exclude<SettingsTab, 'data'>

const TABS: { id: SettingsTab; label: string; icon: (color: string) => ReactNode }[] = [
  { id: 'account', label: 'Account', icon: color => <UserRound size={15} color={color} /> },
  { id: 'exam', label: 'Exam', icon: color => <CalendarDays size={15} color={color} /> },
  { id: 'appearance', label: 'Appearance', icon: color => <Palette size={15} color={color} /> },
  { id: 'rhythm', label: 'Study rhythm', icon: color => <Timer size={15} color={color} /> },
  { id: 'data', label: 'Data', icon: color => <Database size={15} color={color} /> }
]

/** Which persisted settings each tab owns. Saving a tab writes only its own fields. */
const TAB_FIELDS: Record<EditableTab, (keyof AppSettings)[]> = {
  account: ['owner_name'],
  exam: ['main_exam_date', 'advanced_exam_date', 'target_score', 'active_track', 'exam_mode', 'weight_high', 'weight_medium', 'weight_low', 'pyq_from_year', 'pyq_to_year'],
  appearance: ['theme', 'interface_font', 'color_theme'],
  rhythm: ['weak_threshold', 'strong_threshold', 'dropping_threshold', 'revision_gaps', 'daily_study_goal_minutes', 'sound_enabled', 'reminders_enabled', 'reminder_time', 'reminder_types']
}

const THEME_CHOICES: { value: ThemeMode; title: string; description: string }[] = [
  { value: 'light', title: 'Warm paper', description: 'Light notebook paper' },
  { value: 'dark', title: 'Chalkboard', description: 'Dark, high-contrast study mode' },
  { value: 'auto', title: 'Auto', description: 'Follow your device setting' }
]

const TRACK_OPTIONS: { value: AppSettings['active_track']; label: string }[] = [
  { value: 'main1', label: 'JEE Main — Session 1' },
  { value: 'main2', label: 'JEE Main — Session 2' },
  { value: 'advanced', label: 'JEE Advanced' },
  { value: 'boards', label: 'Boards' }
]

const EXAM_MODE_OPTIONS: { value: AppSettings['exam_mode']; label: string }[] = [
  { value: 'auto', label: 'Automatic (final 30 days)' },
  { value: 'on', label: 'Always on' },
  { value: 'off', label: 'Off' }
]

const RESET_TABLES_NOTE = 'Your cloud data is private to your account. Keep an export somewhere safe.'

/** Empty text for a missing number, so a cleared field never shows "NaN". */
function numberText(value: number): string {
  return Number.isFinite(value) ? String(value) : ''
}

function parseNumber(text: string): number {
  return text.trim() === '' ? Number.NaN : Number(text)
}

export function SettingsScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { data, upsert, resetAccount } = useData()
  const { user, signOut } = useAuth()
  const { notify } = useToast()
  const [activeTab, setActiveTab] = useState<SettingsTab>('account')
  const [draft, setDraft] = useState<AppSettings>(data.settings)
  const [gapsText, setGapsText] = useState(data.settings.revision_gaps.join(', '))
  const [dailyGoalText, setDailyGoalText] = useState(String(data.settings.daily_study_goal_minutes / 60))
  // Text the user is typing into a numeric field. Kept as text so "1." survives until it is a number.
  const [numericTexts, setNumericTexts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [savingTab, setSavingTab] = useState<SettingsTab | null>(null)
  const savingRef = useRef(false)
  const [savedTabTick, setSavedTabTick] = useState<SettingsTab | null>(null)
  const savedTickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The snapshot the draft was last reconciled against, so external changes (cloud sync, the
  // Appearance switch) land without wiping unsaved edits in another tab.
  const savedRef = useRef<AppSettings>(data.settings)
  const savedGapsRef = useRef(data.settings.revision_gaps.join(', '))
  const savedGoalRef = useRef(String(data.settings.daily_study_goal_minutes / 60))
  const [signingOut, setSigningOut] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [firstResetOpen, setFirstResetOpen] = useState(false)
  const [secondResetOpen, setSecondResetOpen] = useState(false)
  const [resetText, setResetText] = useState('')
  const [resetting, setResetting] = useState(false)
  const [soundTested, setSoundTested] = useState(false)

  useEffect(() => {
    const previous = savedRef.current
    setDraft(current => {
      const next = { ...data.settings }
      // Keep this user's unsaved edits; adopt external updates for untouched fields.
      for (const key of Object.keys(next) as (keyof AppSettings)[]) {
        if (current[key] !== previous[key]) (next as Record<string, unknown>)[key] = current[key]
      }
      return next
    })
    setGapsText(current => (current !== savedGapsRef.current ? current : data.settings.revision_gaps.join(', ')))
    setDailyGoalText(current => (current !== savedGoalRef.current ? current : String(data.settings.daily_study_goal_minutes / 60)))
    setErrors(current => (Object.keys(current).length ? {} : current))
    savedRef.current = data.settings
    savedGapsRef.current = data.settings.revision_gaps.join(', ')
    savedGoalRef.current = String(data.settings.daily_study_goal_minutes / 60)
  }, [data.settings])

  useEffect(() => () => {
    if (savedTickTimer.current) clearTimeout(savedTickTimer.current)
  }, [])

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

  /** A numeric field: the displayed text is what the user typed, and the draft receives the parsed number. */
  const numeric = (key: keyof AppSettings & string, value: number) => ({
    value: numericTexts[key] ?? numberText(value),
    onChangeText: (text: string) => {
      setNumericTexts(current => ({ ...current, [key]: text }))
      patch(key as keyof AppSettings, parseNumber(text) as AppSettings[keyof AppSettings])
    }
  })

  const rhythmTextsDirty = () => gapsText !== data.settings.revision_gaps.join(', ') || dailyGoalText !== String(data.settings.daily_study_goal_minutes / 60)

  const isTabDirty = (tab: SettingsTab): boolean => {
    if (tab === 'data') return false
    if (tab === 'rhythm') return TAB_FIELDS.rhythm.some(key => draft[key] !== data.settings[key]) || rhythmTextsDirty()
    return TAB_FIELDS[tab].some(key => draft[key] !== data.settings[key])
  }

  const anyDirty = TABS.some(tab => isTabDirty(tab.id))
  const dirtyTabLabels = TABS.filter(tab => isTabDirty(tab.id)).map(tab => tab.label)

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
    setNumericTexts({})
    setErrors({})
  }

  const flashSaved = (tab: SettingsTab) => {
    setSavedTabTick(tab)
    if (savedTickTimer.current) clearTimeout(savedTickTimer.current)
    savedTickTimer.current = setTimeout(() => setSavedTabTick(null), 2600)
  }

  /** The candidate this tab would save: saved settings plus this tab's draft fields. */
  const tabCandidate = (tab: EditableTab): AppSettings => {
    const hours = tab === 'rhythm' && dailyGoalText.trim() === '' ? Number.NaN : Number(dailyGoalText)
    const rawMinutes = hours * 60
    const roundedMinutes = Math.round(rawMinutes)
    const minutesAreWhole = Number.isFinite(rawMinutes) && Math.abs(rawMinutes - roundedMinutes) < 1e-6
    const revisionGaps = gapsText.split(',').map(value => (value.trim() === '' ? Number.NaN : Number(value.trim())))
    const tabDraft: Record<string, unknown> = {}
    for (const key of TAB_FIELDS[tab]) tabDraft[key] = draft[key]
    return {
      ...data.settings,
      ...(tabDraft as Partial<AppSettings>),
      revision_gaps: tab === 'rhythm' ? revisionGaps : data.settings.revision_gaps,
      daily_study_goal_minutes: tab === 'rhythm' ? (minutesAreWhole ? roundedMinutes : Number.NaN) : data.settings.daily_study_goal_minutes
    }
  }

  const saveTab = async (tab: EditableTab) => {
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
      // Write the saved settings plus this tab's validated fields, so unsaved edits in other tabs are never overwritten.
      const source: AppSettings = validated.success ? { ...candidate, ...validated.data } : candidate
      const tabValues: Record<string, unknown> = {}
      for (const key of TAB_FIELDS[tab]) tabValues[key] = source[key]
      const settings: AppSettings = {
        ...data.settings,
        ...(tabValues as Partial<AppSettings>),
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
      setNumericTexts({})
      setErrors({})
      flashSaved(tab)
      notify(`${TABS.find(item => item.id === tab)?.label ?? 'Settings'} settings saved to your notebook.`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save settings. Retry.', 'error')
    } finally {
      savingRef.current = false
      setSavingTab(null)
    }
  }

  const signOutFromSettings = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await signOut()
      router.replace('/login')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not sign out. Try again.', 'error')
    } finally {
      setSigningOut(false)
    }
  }

  const runReset = async () => {
    if (!user || resetText !== 'RESET' || resetting) return
    setResetting(true)
    try {
      await resetAccount()
      notify('Study data was reset. You are being signed out.')
      setSecondResetOpen(false)
      setFirstResetOpen(false)
      setResetText('')
      await signOut()
      router.replace('/login')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Reset did not finish. Your session is still active.', 'error')
    } finally {
      setResetting(false)
    }
  }

  const auto = draft.theme === 'auto'
  const selectedReading = readingFontOption(draft.interface_font)
  const previewFamily = READING_FAMILIES[draft.interface_font as ReadingFont]?.regular ?? IDENTITY_FONT
  const gapPreview = gapsText.split(',').map(value => Number(value.trim())).filter(value => Number.isFinite(value) && value > 0)
  const weak = draft.weak_threshold
  const strong = draft.strong_threshold

  const tabActions = (tab: EditableTab) => (
    <View style={styles.tabActions}>
      <Text accessibilityLiveRegion="polite" style={[theme.type.caption, { color: theme.colors.muted, flex: 1 }]}>
        {savedTabTick === tab ? '✓ Saved' : isTabDirty(tab) ? 'Unsaved changes in this tab' : 'All changes in this tab are saved'}
      </Text>
      <View style={styles.tabButtons}>
        {isTabDirty(tab) ? (
          <Button variant="quiet" onPress={() => discardTabChanges(tab)} disabled={savingTab === tab}>Discard changes</Button>
        ) : null}
        <Button
          onPress={() => void saveTab(tab)}
          loading={savingTab === tab}
          disabled={!isTabDirty(tab) && savingTab !== tab}
          icon={<Save size={16} color={theme.colors.buttonPrimaryInk} />}
        >
          {savingTab === tab ? 'Saving…' : `Save ${(TABS.find(item => item.id === tab)?.label ?? '').toLowerCase()} settings`}
        </Button>
      </View>
    </View>
  )

  const section = (icon: ReactNode, title: string, note: string, body: ReactNode) => (
    <NotebookCard>
      <View style={styles.sectionHead}>
        <View style={[styles.sectionIcon, { backgroundColor: theme.colors.surfaceCoolAccentBg }]}>{icon}</View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" style={[theme.type.label, { color: theme.colors.ink }]}>{title}</Text>
          <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13 }]}>{note}</Text>
        </View>
      </View>
      <View style={styles.sectionBody}>{body}</View>
    </NotebookCard>
  )

  const note = (icon: ReactNode, text: string) => (
    <View style={[styles.noteLine, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
      {icon}
      <Text style={[theme.type.caption, { color: theme.colors.inkSoft, flex: 1 }]}>{text}</Text>
    </View>
  )

  const ink = theme.colors.accent
  const muted = theme.colors.muted
  const busy = savingTab !== null

  return (
    <Screen>
      <PageHeader eyebrow="MAKE IT YOUR OWN" title="Settings" subtitle="Small adjustments for the way you study." action={<SlidersHorizontal size={19} color={theme.colors.muted} />} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabStrip} accessibilityRole="tablist" accessibilityLabel="Settings sections">
        {TABS.map(tab => {
          const active = activeTab === tab.id
          const dirty = isTabDirty(tab.id)
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={dirty ? `${tab.label}, unsaved changes` : tab.label}
              onPress={() => setActiveTab(tab.id)}
              style={[styles.tab, { borderColor: active ? theme.colors.lineStrong : theme.colors.line, backgroundColor: active ? theme.colors.paperSoft : 'transparent' }]}
            >
              {tab.icon(active ? ink : muted)}
              <Text style={[theme.type.label, { color: active ? theme.colors.ink : theme.colors.inkSoft }]}>{tab.label}</Text>
              {dirty ? <View style={[styles.dot, { backgroundColor: theme.colors.orange }]} /> : null}
            </Pressable>
          )
        })}
      </ScrollView>

      <View style={styles.panel} pointerEvents={busy ? 'none' : 'auto'} accessibilityRole="none">
        {activeTab === 'account' ? (
          <>
            <NotebookCard>
              <View style={styles.sectionHead}>
                <View style={[styles.avatar, { backgroundColor: theme.colors.buttonPrimaryBg }]}>
                  <Text style={[theme.type.h3, { color: theme.colors.buttonPrimaryInk }]}>{(draft.owner_name.trim()[0] ?? 'S').toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text accessibilityRole="header" style={[theme.type.label, { color: theme.colors.ink }]}>Owner</Text>
                  <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13 }]}>Your notebook belongs to this account.</Text>
                </View>
              </View>
              <View style={styles.sectionBody}>
                <TextField label="Name in your notebook" value={draft.owner_name} onChangeText={value => patch('owner_name', value)} placeholder="What should Stracker call you?" maxLength={100} error={errors.owner_name} />
                <TextField label="Account email" value={user?.email ?? ''} editable={false} hint="Email and password are managed by secure Supabase authentication." />
                {note(<Shield size={15} color={muted} />, 'Your records stay private to this account — only you can read or change them. New accounts are created from the sign-up page whenever your Supabase project allows sign-ups.')}
                <View style={styles.accountActions}>
                  <Button variant="secondary" onPress={() => setPasswordOpen(true)} disabled={!user || user.isLocal} icon={<KeyRound size={15} color={theme.colors.ink} />}>
                    Change password
                  </Button>
                  <Button variant="quiet" onPress={() => void signOutFromSettings()} loading={signingOut} icon={<LogOut size={15} color={theme.colors.ink} />}>
                    Sign out
                  </Button>
                </View>
                {user?.isLocal ? <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13 }]}>Password changes are available for a cloud-authenticated owner account.</Text> : null}
              </View>
            </NotebookCard>
            <AISettingsSection />
            {tabActions('account')}
          </>
        ) : null}

        {activeTab === 'exam' ? (
          <>
            {section(<CalendarDays size={18} color={ink} />, 'Exam dates & target', 'A countdown is only useful when the date is yours to choose.', (
              <>
                <DateField label="JEE Main date" value={draft.main_exam_date} onChange={value => patch('main_exam_date', value)} error={errors.main_exam_date} allowClear />
                <DateField label="JEE Advanced date" value={draft.advanced_exam_date} onChange={value => patch('advanced_exam_date', value)} error={errors.advanced_exam_date} allowClear />
                <TextField label="Target score" hint="Compared to a mock with all three subject totals." keyboardType="decimal-pad" error={errors.target_score} {...numeric('target_score', draft.target_score)} />
                {note(<Target size={15} color={muted} />, 'Leave dates blank until the official dates are confirmed.')}
              </>
            ))}
            {section(<CalendarDays size={18} color={ink} />, 'Active track & Exam Mode', 'Tracks share one syllabus. The active track sets the countdown and when Exam Mode turns on.', (
              <>
                <SelectField<AppSettings['active_track']> label="Active track" value={draft.active_track} options={TRACK_OPTIONS} onChange={value => patch('active_track', value)} error={errors.active_track} />
                <SelectField<AppSettings['exam_mode']> label="Exam Mode" value={draft.exam_mode} options={EXAM_MODE_OPTIONS} onChange={value => patch('exam_mode', value)} error={errors.exam_mode} />
                <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13 }]}>Automatic Exam Mode needs a date for the active track. It favours revision, PYQs, mocks and weak-area fixes, and stops suggesting new theory.</Text>
              </>
            ))}
            {section(<Target size={18} color={ink} />, 'Weighted progress', 'Chapter importance multiplies into weighted completion. These numbers are yours to set — no JEE weightage is assumed.', (
              <>
                <TextField label="High importance ×" keyboardType="decimal-pad" error={errors.weight_high} {...numeric('weight_high', draft.weight_high)} />
                <TextField label="Medium importance ×" keyboardType="decimal-pad" error={errors.weight_medium} {...numeric('weight_medium', draft.weight_medium)} />
                <TextField label="Low importance ×" keyboardType="decimal-pad" error={errors.weight_low} {...numeric('weight_low', draft.weight_low)} />
              </>
            ))}
            {section(<ListChecks size={18} color={ink} />, 'PYQ year range', 'Years shown as tappable chips for each chapter in the PYQ tracker.', (
              <>
                <TextField label="First year" keyboardType="number-pad" error={errors.pyq_from_year} {...numeric('pyq_from_year', draft.pyq_from_year)} />
                <TextField label="Last year" keyboardType="number-pad" error={errors.pyq_to_year} {...numeric('pyq_to_year', draft.pyq_to_year)} />
              </>
            ))}
            <ExamTracksSection />
            {tabActions('exam')}
          </>
        ) : null}

        {activeTab === 'appearance' ? (
          <>
            {section(<Palette size={18} color={ink} />, 'Notebook theme', 'Choose paper, blackboard, or follow this device.', (
              <>
                <View accessibilityRole="radiogroup" style={styles.choiceList}>
                  {THEME_CHOICES.map(choice => {
                    const checked = draft.theme === choice.value
                    const light = resolvePalette('light', draft.color_theme as ColorTheme)
                    const dark = resolvePalette('dark', draft.color_theme as ColorTheme)
                    const swatch = choice.value === 'dark' ? dark : light
                    return (
                      <Pressable
                        key={choice.value}
                        accessibilityRole="radio"
                        accessibilityState={{ checked }}
                        accessibilityLabel={`${choice.title}. ${choice.description}`}
                        onPress={() => patch('theme', choice.value)}
                        style={[styles.choice, { borderColor: checked ? theme.colors.accent : theme.colors.line, backgroundColor: checked ? theme.colors.surfaceCoolAccentBg : theme.colors.paperSoft }]}
                      >
                        <View style={styles.swatchRow}>
                          {choice.value === 'auto' ? (
                            <>
                              <View style={[styles.swatch, { backgroundColor: light.paper }]} />
                              <View style={[styles.swatch, { backgroundColor: dark.paper }]} />
                            </>
                          ) : (
                            <>
                              <View style={[styles.swatch, { backgroundColor: swatch.bg }]} />
                              <View style={[styles.swatch, { backgroundColor: swatch.paper }]} />
                              <View style={[styles.swatch, { backgroundColor: swatch.accent }]} />
                            </>
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[theme.type.label, { color: theme.colors.ink }]}>{choice.title}</Text>
                          <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13 }]}>{choice.description}</Text>
                        </View>
                        {checked ? <Check size={14} color={theme.colors.accent} /> : null}
                      </Pressable>
                    )
                  })}
                </View>
                {note(<Palette size={15} color={muted} />, auto ? 'Auto theme follows the device appearance.' : 'Theme choice is saved with your account.')}
              </>
            ))}
            {section(<Palette size={18} color={ink} />, 'Color theme', 'A palette for the whole notebook. It ships light and dark variants — the mode controls above pick which one you see.', (
              <>
                <View accessibilityRole="radiogroup" style={styles.colorGrid}>
                  {COLOR_THEME_OPTIONS.map(option => {
                    const checked = draft.color_theme === option.value
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        accessibilityState={{ checked }}
                        accessibilityLabel={`${option.label}. ${option.description}`}
                        onPress={() => patch('color_theme', option.value)}
                        style={[styles.colorChoice, { borderColor: checked ? theme.colors.accent : theme.colors.line, backgroundColor: checked ? theme.colors.surfaceCoolAccentBg : theme.colors.paperSoft }]}
                      >
                        <View style={styles.halfSwatches}>
                          <View style={styles.halfSwatch}>{option.light.map(color => <View key={`l-${color}`} style={[styles.dotSwatch, { backgroundColor: color }]} />)}</View>
                          <View style={styles.halfSwatch}>{option.dark.map(color => <View key={`d-${color}`} style={[styles.dotSwatch, { backgroundColor: color }]} />)}</View>
                        </View>
                        <Text style={[theme.type.label, { color: theme.colors.ink }]}>{option.label}</Text>
                        <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>{option.description}</Text>
                        {checked ? <Check size={13} color={theme.colors.accent} /> : null}
                      </Pressable>
                    )
                  })}
                </View>
                {note(<Palette size={15} color={muted} />, 'The mode switch on the top bar keeps this palette and only changes the mode.')}
              </>
            ))}
            {section(<Type size={18} color={ink} />, 'Reading font', 'Changes body text, menus and buttons. Headings and the Stracker identity stay the same.', (
              <>
                <View accessibilityRole="radiogroup" style={styles.choiceList}>
                  {READING_FONT_OPTIONS.map(option => {
                    const checked = draft.interface_font === option.value
                    const family = READING_FAMILIES[option.value].regular
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        accessibilityState={{ checked }}
                        accessibilityLabel={`${option.label}. ${option.description}`}
                        onPress={() => patch('interface_font', option.value)}
                        style={[styles.choice, { borderColor: checked ? theme.colors.accent : theme.colors.line, backgroundColor: checked ? theme.colors.surfaceCoolAccentBg : theme.colors.paperSoft }]}
                      >
                        <Text style={{ fontFamily: family, fontSize: 22, color: theme.colors.ink, width: 40 }}>Aa</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: family, fontSize: 15, color: theme.colors.ink }}>{option.label}</Text>
                          <Text style={{ fontFamily: family, fontSize: 13, color: theme.colors.muted }}>{option.description}</Text>
                        </View>
                        {checked ? <Check size={14} color={theme.colors.accent} /> : null}
                      </Pressable>
                    )
                  })}
                </View>
                <View accessibilityLiveRegion="polite" style={[styles.preview, { borderColor: theme.colors.line, backgroundColor: theme.colors.paper }]}>
                  <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11 }]}>LIVE PREVIEW</Text>
                  <Text style={[theme.type.h2, { color: theme.colors.ink }]}>A clearer study session</Text>
                  <Text style={{ fontFamily: previewFamily, fontSize: 16 * selectedReading.scale, lineHeight: 16 * selectedReading.scale * 1.45, color: theme.colors.inkSoft }}>
                    Keep your notes easy to follow, so you can spend more time understanding each idea.
                  </Text>
                  <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Your saved preference changes content text, not headings.</Text>
                </View>
                {note(<Type size={15} color={muted} />, 'The preview updates as you choose. Save applies the Reading font to authenticated content.')}
              </>
            ))}
            {tabActions('appearance')}
          </>
        ) : null}

        {activeTab === 'rhythm' ? (
          <>
            {section(<RotateCcw size={18} color={ink} />, 'Revision rhythm', 'When a chapter is first marked Done, these gaps create its revision schedule.', (
              <>
                <TextField
                  label="Days between revisions"
                  hint="Comma-separated positive days, sorted automatically. Existing revisions are not moved."
                  value={gapsText}
                  onChangeText={value => { setGapsText(value); setErrors(current => { const next = { ...current }; delete next.revision_gaps; return next }) }}
                  placeholder="1, 7, 30"
                  keyboardType="numbers-and-punctuation"
                  error={errors.revision_gaps}
                />
                <View style={styles.chips}>
                  {gapPreview.map((value, index) => (
                    <View key={`${value}-${index}`} style={[styles.gapChip, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
                      <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{`R${index + 1}`}</Text>
                      <Text style={[theme.type.label, { color: theme.colors.ink }]}>{`${value}d`}</Text>
                    </View>
                  ))}
                </View>
              </>
            ))}
            {section(<Timer size={18} color={ink} />, 'Daily goal & focus', 'A gentle baseline for the timer and study heatmap.', (
              <>
                <TextField
                  label="Daily study goal (hours)"
                  hint="Use whole-minute increments (for example, 1.5 hours)."
                  value={dailyGoalText}
                  onChangeText={value => { setDailyGoalText(value); setErrors(current => { const next = { ...current }; delete next.daily_study_goal_minutes; return next }) }}
                  keyboardType="decimal-pad"
                  error={errors.daily_study_goal_minutes}
                />
                <SwitchRow label="Focus timer sound" description="Play a soft tone when a focus session ends." value={draft.sound_enabled} onValueChange={value => patch('sound_enabled', value)} />
                {note(<Bell size={15} color={muted} />, 'The tone is bundled with the app; no audio is sent to a service.')}
                {draft.sound_enabled ? (
                  <View style={styles.actionRow}>
                    <Button
                      variant="quiet"
                      size="sm"
                      onPress={() => {
                        const played = playFocusTone()
                        if (played) setSoundTested(true)
                        else notify('This device could not play the notification sound.', 'error')
                      }}
                    >
                      {soundTested ? 'Test tone played — play again' : 'Try a tone'}
                    </Button>
                  </View>
                ) : null}
              </>
            ))}
            <ReminderSettingsSection draft={draft} patch={patch} errors={errors} />
            {section(<Target size={18} color={ink} />, 'Weak-area thresholds', 'These bands describe test results; they do not judge your preparation.', (
              <>
                <TextField label="Weak below (%)" keyboardType="decimal-pad" error={errors.weak_threshold} {...numeric('weak_threshold', draft.weak_threshold)} />
                <TextField label="Strong above (%)" keyboardType="decimal-pad" error={errors.strong_threshold} {...numeric('strong_threshold', draft.strong_threshold)} />
                <TextField label="Dropping when down by (points)" keyboardType="decimal-pad" error={errors.dropping_threshold} {...numeric('dropping_threshold', draft.dropping_threshold)} />
                <View style={styles.chips}>
                  <StatusBadge tone="bad">{`Weak < ${Number.isFinite(weak) ? weak : '—'}%`}</StatusBadge>
                  <StatusBadge tone="warn">{`Okay ${Number.isFinite(weak) ? weak : '—'}–${Number.isFinite(strong) ? strong : '—'}%`}</StatusBadge>
                  <StatusBadge tone="good">{`Strong > ${Number.isFinite(strong) ? strong : '—'}%`}</StatusBadge>
                </View>
              </>
            ))}
            {tabActions('rhythm')}
          </>
        ) : null}

        {activeTab === 'data' ? (
          <>
            {section(<Cloud size={18} color={ink} />, 'Your data & backup', RESET_TABLES_NOTE, (
              <>
                <View style={styles.backupLine}>
                  <Text style={[theme.type.label, { color: theme.colors.ink }]}>
                    {data.settings.last_backup_at
                      ? `Last backup ${format(new Date(data.settings.last_backup_at), 'd MMM yyyy')}`
                      : 'No backup recorded yet'}
                  </Text>
                  <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13 }]}>
                    {data.settings.last_backup_at ? 'JSON, PDF and DOCX exports live in Export & Backup.' : 'A JSON backup is the easiest way to keep a portable copy.'}
                  </Text>
                </View>
                <Button variant="secondary" onPress={() => router.navigate('/backup' as never)}>Open backup center</Button>
              </>
            ))}
            <View style={[styles.danger, { borderColor: theme.colors.redBg, backgroundColor: theme.colors.redBg }]} accessibilityLabel="Danger zone">
              <View style={styles.dangerHead}>
                <AlertOctagon size={18} color={theme.colors.red} />
                <View style={{ flex: 1 }}>
                  <Text accessibilityRole="header" style={[theme.type.h3, { color: theme.colors.red }]}>Danger zone</Text>
                  <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>These options affect your entire study notebook and cannot be triggered by a normal Save.</Text>
                </View>
              </View>
              <View style={styles.dangerRow}>
                <Text style={[theme.type.label, { color: theme.colors.ink }]}>Reset all study data</Text>
                <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>
                  Delete your cloud records, mistake photos, and this device’s offline cache. This cannot be recovered unless you exported a backup.
                </Text>
                <View style={styles.actionRow}>
                  <Button variant="danger" onPress={() => setFirstResetOpen(true)} icon={<RotateCcw size={15} color={theme.colors.buttonDangerInk} />}>Reset all data</Button>
                </View>
              </View>
            </View>
          </>
        ) : null}
      </View>

      {anyDirty ? (
        <Text accessibilityRole="alert" style={[theme.type.caption, styles.unsaved, { color: theme.colors.inkSoft, borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
          You have unsaved changes in {dirtyTabLabels.join(', ')}. Each tab saves on its own.
        </Text>
      ) : null}

      <ChangePasswordDialog visible={passwordOpen} onClose={() => setPasswordOpen(false)} />

      <ConfirmDialog
        visible={firstResetOpen}
        title="This will erase your study history."
        message="Chapters, tests, mistakes, revisions, tasks, goals, sessions and uploaded photos will be permanently removed from the cloud and this device. Export a JSON backup first if you may want to restore later. This reset does not delete your login account."
        confirmLabel="Continue to confirmation"
        danger
        onConfirm={() => { setFirstResetOpen(false); setSecondResetOpen(true) }}
        onCancel={() => setFirstResetOpen(false)}
      />

      <Dialog
        visible={secondResetOpen}
        onClose={() => { if (!resetting) { setSecondResetOpen(false); setResetText('') } }}
        title="One last check."
        subtitle="To confirm, type RESET exactly. Your data will not be recoverable from Stracker after this."
      >
        <View style={{ gap: 14 }}>
          <TextField label="Type RESET to confirm" value={resetText} onChangeText={setResetText} autoCapitalize="characters" autoCorrect={false} autoComplete="off" />
          <View style={styles.dialogActions}>
            <Button variant="secondary" onPress={() => { setSecondResetOpen(false); setResetText('') }} disabled={resetting}>Cancel</Button>
            <Button variant="danger" loading={resetting} disabled={resetText !== 'RESET' || resetting} onPress={() => void runReset()} icon={<AlertOctagon size={15} color={theme.colors.buttonDangerInk} />}>
              {resetting ? 'Resetting…' : 'Permanently reset'}
            </Button>
          </View>
        </View>
      </Dialog>
    </Screen>
  )
}

/** Password change. The new password goes straight to Supabase Auth and is never stored by Stracker. */
function ChangePasswordDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme()
  const { updatePassword } = useAuth()
  const { notify } = useToast()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirmation?: string }>({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const submit = async () => {
    if (savingRef.current) return
    const nextErrors: { password?: string; confirmation?: string } = {}
    const lengthError = passwordLengthError(password)
    if (lengthError) nextErrors.password = lengthError
    if (password !== confirmation) nextErrors.confirmation = 'The passwords do not match.'
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return }
    savingRef.current = true
    setSaving(true)
    try {
      await updatePassword(password)
      notify('Your password has been updated.')
      setPassword('')
      setConfirmation('')
      onClose()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update the password. Try again.', 'error')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog visible={visible} onClose={() => { if (!saving) onClose() }} title="Change password" subtitle="Choose a new password for your secure owner account.">
      <View style={{ gap: 14 }}>
        <TextField label="New password" required hint="At least 8 characters." value={password} onChangeText={value => { setPassword(value); setErrors(current => ({ ...current, password: undefined })) }} secureTextEntry autoComplete="new-password" autoCapitalize="none" error={errors.password} />
        <TextField label="Confirm new password" required value={confirmation} onChangeText={value => { setConfirmation(value); setErrors(current => ({ ...current, confirmation: undefined })) }} secureTextEntry autoComplete="new-password" autoCapitalize="none" error={errors.confirmation} />
        <View style={styles.dialogActions}>
          <Button variant="secondary" onPress={onClose} disabled={saving}>Cancel</Button>
          <Button loading={saving} onPress={() => void submit()} icon={<KeyRound size={15} color={theme.colors.buttonPrimaryInk} />}>
            {saving ? 'Updating…' : 'Update password'}
          </Button>
        </View>
      </View>
    </Dialog>
  )
}

const styles = StyleSheet.create({
  tabStrip: { gap: 8, paddingBottom: 4 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, minHeight: 42 },
  dot: { width: 7, height: 7, borderRadius: 999 },
  panel: { gap: 14 },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  sectionIcon: { width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  sectionBody: { marginTop: 14, gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  accountActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  noteLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 12, padding: 11 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  gapChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  tabActions: { gap: 10, paddingTop: 4 },
  tabButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 },
  choiceList: { gap: 10 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 12 },
  swatchRow: { flexDirection: 'row', gap: 4 },
  swatch: { width: 18, height: 26, borderRadius: 5 },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorChoice: { width: '48%', borderWidth: 1, borderRadius: 14, padding: 10, gap: 6 },
  halfSwatches: { flexDirection: 'row', gap: 6 },
  halfSwatch: { flexDirection: 'row', gap: 3, flex: 1 },
  dotSwatch: { flex: 1, height: 14, borderRadius: 4 },
  preview: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  backupLine: { gap: 4 },
  danger: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 14 },
  dangerHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dangerRow: { gap: 8 },
  unsaved: { borderWidth: 1, borderRadius: 12, padding: 11, overflow: 'hidden' },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10 }
})

