import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useData, type DataContextValue } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { useTheme } from '../contexts/AppearanceContext'
import { createId } from '../shared/lib/id'
import { indiaToday, plusDays, prettyDate } from '../shared/lib/date'
import { aggregatePractice, PRACTICE_MIN_ATTEMPTS_FOR_SIGNAL } from '../shared/lib/jee/progress'
import { practiceStudySessionId } from '../shared/lib/jee/ids'
import { validatePractice, type PracticeFormInput, type PracticeValue } from '../shared/lib/jee/forms'
import { PRACTICE_SOURCES, type AppData, type Chapter, type PracticeSession, type PracticeSource, type StudySession, type Subject } from '../shared/types'
import { BarChart3, Check, ClipboardList, Pencil, Plus, Target, Trash2 } from '../components/icons'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Overlays'
import { Screen } from '../components/ui/Screen'
import { SelectField, TextField } from '../components/ui/Forms'
import { OverflowMenu } from '../components/ui/OverflowMenu'
import { EmptyState, NotebookCard, PageHeader, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui/Surfaces'
import { ChapterSelect, ChipFilter, Meter, Pct, SubjectSelect, minutesLabel } from '../components/jee/shared'

type Period = '7' | '30' | '90' | 'all'

/** Practice blocks: questions solved outside mocks. They feed chapter accuracy and weak areas, never the test journal. */
export function PracticeScreen() {
  const theme = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ add?: string; chapter?: string }>()
  const { data, upsert, remove, refresh, syncState } = useData()
  const { notify } = useToast()
  const [subject, setSubject] = useState<Subject | 'all'>('all')
  const [chapterFilter, setChapterFilter] = useState('')
  const [source, setSource] = useState<PracticeSource | 'all'>('all')
  const [period, setPeriod] = useState<Period>('30')
  const [editing, setEditing] = useState<PracticeSession | null>(null)
  const [creating, setCreating] = useState(false)
  const [presetChapter, setPresetChapter] = useState('')
  const today = indiaToday()
  const chapterById = useMemo(() => new Map(data.chapters.map(chapter => [chapter.id, chapter])), [data.chapters])

  // A "?add=1" link opens the form once, preselecting its chapter; the parameters are cleared straight after.
  const [openSeen, setOpenSeen] = useState(false)
  const openRequested = params.add === '1'
  if (openRequested !== openSeen) {
    setOpenSeen(openRequested)
    if (openRequested) {
      setPresetChapter(typeof params.chapter === 'string' ? params.chapter : '')
      setEditing(null)
      setCreating(true)
    }
  }
  useEffect(() => {
    if (openRequested) router.setParams({ add: undefined, chapter: undefined })
  }, [openRequested, router])

  const from = period === 'all' ? '' : plusDays(today, -Number(period))
  const filtered = useMemo(() => data.practiceSessions.filter(item => {
    const chapter = chapterById.get(item.chapter_id)
    if (!chapter) return false
    if (subject !== 'all' && chapter.subject !== subject) return false
    if (chapterFilter && item.chapter_id !== chapterFilter) return false
    if (source !== 'all' && item.source !== source) return false
    if (from && item.practice_date < from) return false
    return true
  }).sort((a, b) => b.practice_date.localeCompare(a.practice_date) || b.created_at.localeCompare(a.created_at)), [data.practiceSessions, chapterById, subject, chapterFilter, source, from])

  const overall = aggregatePractice(filtered)
  const byChapter = useMemo(() => {
    const groups = new Map<string, PracticeSession[]>()
    for (const item of filtered) groups.set(item.chapter_id, [...(groups.get(item.chapter_id) ?? []), item])
    return [...groups.entries()]
      .map(([chapterId, sessions]) => ({ chapter: chapterById.get(chapterId), agg: aggregatePractice(sessions) }))
      .filter((item): item is { chapter: Chapter; agg: ReturnType<typeof aggregatePractice> } => Boolean(item.chapter))
      .sort((a, b) => b.agg.attempted - a.agg.attempted)
  }, [filtered, chapterById])
  const subjectChapters = data.chapters.filter(chapter => subject === 'all' || chapter.subject === subject)
  const hasAny = data.practiceSessions.length > 0

  const openCreate = (chapterId = '') => {
    setPresetChapter(chapterId)
    setEditing(null)
    setCreating(true)
  }
  const removeBlock = async (session: PracticeSession) => {
    try {
      await remove('practice_sessions', session)
      notify('Practice block removed. Undo is available briefly.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not remove this block.', 'error')
    }
  }

  return (
    <Screen refreshing={syncState === 'syncing'} onRefresh={() => void refresh()}>
      <PageHeader
        eyebrow="DPP & PRACTICE, LOGGED SEPARATELY FROM TESTS"
        title="Practice log"
        subtitle="Questions you solved outside mocks — DPPs, modules, sheets. These feed chapter accuracy and Weak areas, but never count as a test."
        action={<Button onPress={() => openCreate()} icon={<Plus size={16} color={theme.colors.buttonPrimaryInk} />}>Log practice</Button>}
      />

      <View style={styles.statGrid}>
        <Stat label="Questions attempted" value={overall.attempted.toLocaleString('en-IN')} note={`${overall.sessions} block${overall.sessions === 1 ? '' : 's'} in view`} />
        <Stat label="Accuracy" value={<Pct value={overall.accuracy} digits={1} />} note={`${overall.correct} correct · ${overall.incorrect} incorrect`} />
        <Stat label="Recent accuracy" value={<Pct value={overall.recentAccuracy} digits={1} />} note="last three blocks" />
        <Stat label="Practice volume" value={minutesLabel(overall.timeMinutes)} note="time recorded in view" />
      </View>

      <NotebookCard padding={14} style={{ gap: 12 }}>
        <SubjectSelect value={subject} onChange={value => { setSubject(value as Subject | 'all'); setChapterFilter('') }} />
        <ChapterSelect chapters={subjectChapters} value={chapterFilter} onChange={setChapterFilter} allowNone noneLabel="All chapters" subject={subject} label="Chapter" />
        <SelectField<PracticeSource | 'all'>
          label="Source"
          value={source}
          options={[{ value: 'all', label: 'All sources' }, ...PRACTICE_SOURCES.map(item => ({ value: item, label: item }))]}
          onChange={setSource}
        />
        <ChipFilter<Period> label="Date" value={period} onChange={setPeriod} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: 'all', label: 'All time' }]} />
      </NotebookCard>

      {!hasAny ? (
        <NotebookCard>
          <EmptyState icon={<ClipboardList size={26} color={theme.colors.muted} />} title="No practice logged yet." description="Log a DPP or module block with how many you attempted and got right. Accuracy by chapter appears here straight away." action={<Button variant="secondary" size="sm" onPress={() => openCreate()} icon={<Plus size={15} color={theme.colors.ink} />}>Log your first block</Button>} />
        </NotebookCard>
      ) : (
        <>
          <SectionHeading title="Chapter performance" note={`${byChapter.length} chapter${byChapter.length === 1 ? '' : 's'} with practice in view`} />
          {byChapter.length === 0 ? (
            <NotebookCard><EmptyState icon={<Target size={22} color={theme.colors.muted} />} title="Nothing matches these filters." description="Widen the date range or clear the chapter or source filter." /></NotebookCard>
          ) : (
            <View style={{ gap: 10 }}>
              {byChapter.map(({ chapter, agg }) => (
                <ChapterPracticeRow key={chapter.id} chapter={chapter} agg={agg} weakThreshold={data.settings.weak_threshold} onLog={() => openCreate(chapter.id)} />
              ))}
            </View>
          )}
          <SectionHeading title="History" note="Newest first. Edit or remove any block." />
          <NotebookCard padding={14} style={{ gap: 12 }}>
            {filtered.length === 0 ? <Text style={[theme.type.caption, { color: theme.colors.muted }]}>No blocks in this view.</Text> : null}
            {filtered.slice(0, 80).map(item => {
              const chapter = chapterById.get(item.chapter_id)
              const accuracy = item.attempted > 0 ? (item.correct / item.attempted) * 100 : null
              return (
                <View key={item.id} style={[styles.historyRow, { borderBottomColor: theme.colors.line }]}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={[theme.type.label, { color: theme.colors.ink }]}>{chapter?.name}</Text>
                    <View style={styles.inline}>
                      {chapter ? <SubjectBadge subject={chapter.subject} /> : null}
                      <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{prettyDate(item.practice_date)}</Text>
                      <StatusBadge tone="muted">{item.source}</StatusBadge>
                    </View>
                    <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>
                      {item.attempted} attempted · {item.correct} correct · {item.incorrect} incorrect · <Pct value={accuracy} digits={0} /> accuracy{item.time_minutes !== null ? ` · ${minutesLabel(item.time_minutes)}` : ''}
                    </Text>
                    {item.notes ? <Text style={[theme.type.caption, { color: theme.colors.muted, fontStyle: 'italic' }]}>{item.notes}</Text> : null}
                  </View>
                  <OverflowMenu
                    label={`Actions for ${chapter?.name ?? 'practice block'} on ${item.practice_date}`}
                    title="Practice block"
                    items={[
                      { id: 'edit', label: 'Edit block', icon: <Pencil size={15} color={theme.colors.ink} />, onSelect: () => { setCreating(false); setEditing(item) } },
                      { id: 'delete', label: 'Delete block', icon: <Trash2 size={15} color={theme.colors.red} />, danger: true, onSelect: () => void removeBlock(item) }
                    ]}
                  />
                </View>
              )
            })}
            {filtered.length > 80 ? <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Showing the newest 80 of {filtered.length}. Narrow the filters to see older blocks.</Text> : null}
          </NotebookCard>
        </>
      )}

      {creating ? (
        <PracticeDialog key={`new-${presetChapter}`} data={data} initialChapterId={presetChapter} onClose={() => setCreating(false)} upsert={upsert} remove={remove} notifyText="Practice logged. Chapter accuracy is updated." />
      ) : null}
      {editing ? (
        <PracticeDialog key={editing.id} data={data} existing={editing} onClose={() => setEditing(null)} upsert={upsert} remove={remove} notifyText="Practice block updated." />
      ) : null}
    </Screen>
  )
}

async function savePractice(id: string, value: PracticeValue, data: AppData, upsert: DataContextValue['upsert'], remove: DataContextValue['remove'], createdAt?: string) {
  const now = new Date().toISOString()
  const existing = data.practiceSessions.find(item => item.id === id)
  const record: PracticeSession = {
    id, chapter_id: value.chapter_id, practice_date: value.practice_date, attempted: value.attempted, correct: value.correct,
    incorrect: value.incorrect, source: value.source, time_minutes: value.time_minutes, notes: value.notes,
    created_at: createdAt ?? existing?.created_at ?? now, updated_at: now
  }
  await upsert('practice_sessions', record)
  // Mirror practice minutes into study time (Practice activity) under a stable ID, so edits never double count.
  const chapter = data.chapters.find(item => item.id === value.chapter_id)
  const studyId = practiceStudySessionId(id)
  const studyExisting = data.sessions.find(item => item.id === studyId)
  if (value.time_minutes && value.time_minutes > 0) {
    const session: StudySession = {
      id: studyId, subject: chapter?.subject ?? null, chapter_id: value.chapter_id,
      started_at: `${value.practice_date}T12:00:00.000+05:30`, ended_at: null,
      duration_minutes: value.time_minutes, completion_state: 'completed', mode: 'Custom', activity: 'Practice',
      created_at: studyExisting?.created_at ?? now, updated_at: now
    }
    await upsert('study_sessions', session)
  } else if (studyExisting) {
    await remove('study_sessions', studyExisting, { undo: false })
  }
}

function ChapterPracticeRow({ chapter, agg, weakThreshold, onLog }: { chapter: Chapter; agg: ReturnType<typeof aggregatePractice>; weakThreshold: number; onLog: () => void }) {
  const theme = useTheme()
  const weak = agg.attempted >= PRACTICE_MIN_ATTEMPTS_FOR_SIGNAL && agg.accuracy !== null && agg.accuracy < weakThreshold
  const trend = agg.recentAccuracy !== null && agg.accuracy !== null ? agg.recentAccuracy - agg.accuracy : null
  return (
    <NotebookCard padding={14} accent={weak ? 'orange' : 'plain'} style={{ gap: 8 }}>
      <View style={styles.rowBetween}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[theme.type.label, { color: theme.colors.ink }]}>{chapter.name}</Text>
          <View style={styles.inline}>
            <SubjectBadge subject={chapter.subject} />
            {weak ? <StatusBadge tone="bad">Practice weak</StatusBadge> : null}
          </View>
        </View>
        <Button variant="quiet" size="sm" onPress={onLog} icon={<Plus size={14} color={theme.colors.accent} />}>Log</Button>
      </View>
      <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>
        {agg.attempted} attempted · <Pct value={agg.accuracy} digits={0} /> accuracy · recent <Pct value={agg.recentAccuracy} digits={0} />
        {trend !== null && trend !== 0 ? ` ${trend > 0 ? '▲' : '▼'} ${Math.abs(Math.round(trend))}` : ''} · {agg.incorrect} incorrect
      </Text>
      <Meter value={agg.accuracy} label={`${chapter.name} practice accuracy`} tone={weak ? 'orange' : 'green'} />
      <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>
        {agg.sessions} block{agg.sessions === 1 ? '' : 's'}{agg.timeMinutes ? ` · ${minutesLabel(agg.timeMinutes)}` : ''}{agg.attempted < PRACTICE_MIN_ATTEMPTS_FOR_SIGNAL ? ` · needs ${PRACTICE_MIN_ATTEMPTS_FOR_SIGNAL} questions before it flags weakness` : ''}
      </Text>
    </NotebookCard>
  )
}

function PracticeDialog({ data, initialChapterId = '', existing, onClose, upsert, remove, notifyText }: {
  data: AppData
  initialChapterId?: string
  existing?: PracticeSession
  onClose: () => void
  upsert: DataContextValue['upsert']
  remove: DataContextValue['remove']
  notifyText: string
}) {
  const theme = useTheme()
  const { notify } = useToast()
  const today = indiaToday()
  const [id] = useState(() => existing?.id ?? createId())
  const initialChapter = existing ? data.chapters.find(item => item.id === existing.chapter_id) : data.chapters.find(item => item.id === initialChapterId)
  const [subject, setSubject] = useState<Subject | 'all'>(initialChapter?.subject ?? 'all')
  const [form, setForm] = useState<PracticeFormInput>({
    chapterId: existing?.chapter_id ?? initialChapterId,
    date: existing?.practice_date ?? today,
    attempted: existing ? String(existing.attempted) : '',
    correct: existing ? String(existing.correct) : '',
    incorrect: existing ? String(existing.incorrect) : '',
    source: existing?.source ?? 'DPP',
    minutes: existing?.time_minutes != null ? String(existing.time_minutes) : '',
    notes: existing?.notes ?? ''
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const set = (key: keyof PracticeFormInput, value: string) => {
    setForm(current => ({ ...current, [key]: value }))
    setErrors(current => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }
  const submit = async () => {
    if (saving) return
    const result = validatePractice(form, today)
    if (!result.ok) {
      setErrors(result.errors)
      notify('Check the highlighted fields.', 'error')
      return
    }
    setSaving(true)
    try {
      await savePractice(id, result.value, data, upsert, remove, existing?.created_at)
      notify(notifyText)
      onClose()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save this block.', 'error')
    } finally {
      setSaving(false)
    }
  }
  const attempted = Number(form.attempted)
  const correct = Number(form.correct)
  const accuracy = attempted > 0 && Number.isFinite(correct) && form.correct !== '' ? (correct / attempted) * 100 : null
  return (
    <Dialog visible onClose={onClose} title={existing ? 'Edit practice block' : 'Log practice'} subtitle="Questions you attempted outside tests. Correct + incorrect can’t exceed attempted.">
      <View style={{ gap: 14 }}>
        <SubjectSelect value={subject} onChange={value => { setSubject(value as Subject | 'all'); set('chapterId', '') }} allowAll label="Subject filter" />
        <TextField label="Date" required value={form.date} error={errors.date} placeholder="YYYY-MM-DD" onChangeText={value => set('date', value)} autoCapitalize="none" />
        <ChapterSelect chapters={data.chapters} value={form.chapterId} onChange={value => set('chapterId', value)} subject={subject} label="Chapter" />
        {errors.chapterId ? <Text style={{ color: theme.colors.red }}>{errors.chapterId}</Text> : null}
        <View style={styles.threeCol}>
          <View style={{ flex: 1 }}><TextField label="Attempted" required error={errors.attempted} value={form.attempted} keyboardType="number-pad" placeholder="120" onChangeText={value => set('attempted', value)} /></View>
          <View style={{ flex: 1 }}><TextField label="Correct" required error={errors.correct} value={form.correct} keyboardType="number-pad" placeholder="92" onChangeText={value => set('correct', value)} /></View>
          <View style={{ flex: 1 }}><TextField label="Incorrect" required error={errors.incorrect} value={form.incorrect} keyboardType="number-pad" placeholder="28" onChangeText={value => set('incorrect', value)} /></View>
        </View>
        <SelectField<PracticeSource>
          label="Source"
          value={form.source}
          options={PRACTICE_SOURCES.map(item => ({ value: item, label: item }))}
          onChange={value => set('source', value)}
        />
        <TextField label="Time spent (min, optional)" error={errors.minutes} value={form.minutes} keyboardType="number-pad" placeholder="45" onChangeText={value => set('minutes', value)} />
        <TextField label="Notes (optional)" error={errors.notes} value={form.notes} multiline maxLength={5000} placeholder="e.g. DPP 7, Q14–20 were gauss-law heavy" onChangeText={value => set('notes', value)} />
        <View style={[styles.live, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]} accessibilityLiveRegion="polite">
          <BarChart3 size={15} color={theme.colors.accent} />
          <Text style={[theme.type.label, { color: theme.colors.ink }]}>Accuracy: {accuracy === null ? '—' : `${accuracy.toFixed(1)}%`}</Text>
          {accuracy !== null ? <Text style={[theme.type.caption, { color: theme.colors.muted }]}>({form.correct} of {form.attempted})</Text> : null}
        </View>
        <View style={styles.actions}>
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button loading={saving} onPress={() => void submit()} icon={<Check size={16} color={theme.colors.buttonPrimaryInk} />}>{existing ? 'Save changes' : 'Log practice'}</Button>
        </View>
      </View>
    </Dialog>
  )
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note: string }) {
  const theme = useTheme()
  return (
    <NotebookCard padding={14} style={styles.stat}>
      <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{label}</Text>
      <Text style={[theme.type.metric, { color: theme.colors.ink, fontSize: 26, lineHeight: 28 }]}>{value}</Text>
      <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>{note}</Text>
    </NotebookCard>
  )
}

const styles = StyleSheet.create({
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { flexBasis: '47%', flexGrow: 1, gap: 4 },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  historyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  threeCol: { flexDirection: 'row', gap: 8 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, padding: 10, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }
})
