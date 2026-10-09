import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useData, type DataContextValue } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { useTheme } from '../contexts/AppearanceContext'
import { getAccuracy, getAttemptRate, getMeanTestPercentage, getOverallTestPercentage, getOverallTestScore, validPercentage } from '../shared/lib/analytics'
import { fmtNumber } from '../shared/lib/format'
import { indiaToday, prettyDate } from '../shared/lib/date'
import { createId } from '../shared/lib/id'
import { MAX_MARKS_OBTAINED, MAX_TOTAL_MARKS, nullableNumberInput, subjectScoreInputSchema, testFormSchema } from '../shared/lib/test-validation'
import { SUBJECTS, type AppData, type Subject, type TestChapterLink, type TestRecord, type TestSubjectScore, type TestType } from '../shared/types'
import { ArrowDown, ArrowUp, BookOpen, Eye, Pencil, Plus, Search, Trash2, X } from '../components/icons'
import { Button } from '../components/ui/Button'
import { ConfirmDialog, Dialog } from '../components/ui/Overlays'
import { Screen } from '../components/ui/Screen'
import { DateField, SelectField, TextField } from '../components/ui/Forms'
import { EmptyState, NotebookCard, PageHeader, StatusBadge, SubjectBadge } from '../components/ui/Surfaces'
import { ChipFilter } from '../components/jee/shared'

type SortKey = 'date' | 'score' | 'title'
type TestFieldErrors = Record<string, string>
type TestFormValues = {
  title: string; test_date: string; test_type: TestType; subject: Subject | ''; chapter_id: string
  marks: string; total: string; correct: string; wrong: string; skipped: string; negative: string; time: string; notes: string
  mockScores: Record<Subject, { marks: string; total: string }>
}

const TEST_TYPES: TestType[] = ['Chapter Test', 'Subject Test', 'Full Mock', 'PYQ Practice']
const blankValues = (): TestFormValues => ({
  title: '', test_date: indiaToday(), test_type: 'Chapter Test', subject: '', chapter_id: '', marks: '', total: '',
  correct: '', wrong: '', skipped: '', negative: '', time: '', notes: '',
  mockScores: { Physics: { marks: '', total: '' }, Chemistry: { marks: '', total: '' }, Maths: { marks: '', total: '' } }
})

const FORM_FIELD_BY_SCHEMA_FIELD: Record<string, string> = { marks_obtained: 'marks', total_marks: 'total', test_date: 'test_date' }

function displayFieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]): TestFieldErrors {
  const errors: TestFieldErrors = {}
  for (const issue of issues) {
    const rawField = String(issue.path[0] ?? 'form')
    const field = FORM_FIELD_BY_SCHEMA_FIELD[rawField] ?? rawField
    errors[field] ??= issue.message
  }
  return errors
}

function subjectScoreMax(totalText: string): number {
  const total = nullableNumberInput(totalText)
  return total !== null && Number.isInteger(total) && total > 0 ? total : MAX_MARKS_OBTAINED
}

/** Test history: every chapter test, subject test, mock, and PYQ session, with filters, sorting, and a full editor. */
export function TestsScreen() {
  const theme = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ add?: string; chapter?: string }>()
  const { data, upsert, upsertMany, remove, refresh, syncState } = useData()
  const { notify } = useToast()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | TestType>('all')
  const [subjectFilter, setSubjectFilter] = useState<'all' | Subject>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sort, setSort] = useState<SortKey>('date')
  const [ascending, setAscending] = useState(false)
  const [editing, setEditing] = useState<TestRecord | null>(null)
  const [creating, setCreating] = useState(false)
  const [presetChapterId, setPresetChapterId] = useState<string | null>(null)
  const [viewing, setViewing] = useState<TestRecord | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TestRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)

  // A chapter preselect (e.g. from Weak areas) opens the same dialog with that chapter already chosen.
  // The request is handled once, during render, and the parameters are cleared straight after.
  const [openSeen, setOpenSeen] = useState(false)
  const openRequested = params.add === '1'
  if (openRequested !== openSeen) {
    setOpenSeen(openRequested)
    if (openRequested) {
      setPresetChapterId(typeof params.chapter === 'string' ? params.chapter : null)
      setEditing(null)
      setCreating(true)
    }
  }
  useEffect(() => {
    if (openRequested) router.setParams({ add: undefined, chapter: undefined })
  }, [openRequested, router])

  const sortedTests = useMemo(() => {
    const term = search.trim().toLowerCase()
    return data.tests.filter(test => {
      const displayedSubject = test.test_type === 'Full Mock' ? 'All subjects' : test.subject ?? ''
      if (term && !`${test.title} ${test.test_type} ${test.notes} ${displayedSubject} ${data.chapters.find(ch => ch.id === test.chapter_id)?.name ?? ''}`.toLowerCase().includes(term)) return false
      if (typeFilter !== 'all' && test.test_type !== typeFilter) return false
      // A Full Mock matches every subject filter; its row says “All subjects”.
      if (subjectFilter !== 'all' && test.test_type !== 'Full Mock' && test.subject !== subjectFilter) return false
      if (from && test.test_date < from) return false
      if (to && test.test_date > to) return false
      return true
    }).sort((a, b) => {
      let compared = 0
      if (sort === 'date') compared = a.test_date.localeCompare(b.test_date)
      else if (sort === 'title') compared = a.title.localeCompare(b.title)
      else compared = (getOverallTestPercentage(a, data.testSubjectScores) ?? -1) - (getOverallTestPercentage(b, data.testSubjectScores) ?? -1)
      return compared * (ascending ? 1 : -1)
    })
  }, [data, search, typeFilter, subjectFilter, from, to, sort, ascending])

  const accuracy = getAccuracy(data)
  const attempt = getAttemptRate(data)
  const average = getMeanTestPercentage(sortedTests, data.testSubjectScores)

  const saveTest = async (values: TestFormValues, current: TestRecord | undefined, stableId: string, upsertFn: DataContextValue['upsert'], upsertManyFn: DataContextValue['upsertMany'], removeFn: DataContextValue['remove']): Promise<TestFieldErrors | null> => {
    const parsed = testFormSchema.safeParse({
      title: values.title, test_date: values.test_date, test_type: values.test_type,
      marks_obtained: values.test_type === 'Full Mock' ? null : nullableNumberInput(values.marks),
      total_marks: values.test_type === 'Full Mock' ? null : nullableNumberInput(values.total),
      correct: nullableNumberInput(values.correct), wrong: nullableNumberInput(values.wrong), skipped: nullableNumberInput(values.skipped),
      negative_marks: nullableNumberInput(values.negative), time_minutes: nullableNumberInput(values.time), notes: values.notes.trim()
    })
    const errors: TestFieldErrors = parsed.success ? {} : displayFieldErrors(parsed.error.issues)
    const selectedChapter = values.chapter_id ? data.chapters.find(item => item.id === values.chapter_id) : null
    if (values.chapter_id && (!selectedChapter || (values.subject && selectedChapter.subject !== values.subject))) {
      errors.chapter_id = 'Choose a chapter that belongs to the selected subject.'
    }
    const now = new Date().toISOString()
    const testId = current?.id ?? stableId
    // The stable dialog ID lets a retry reuse rows already cached locally after a failed cloud sync.
    const existingTest = current ?? data.tests.find(test => test.id === testId)
    const oldScores = data.testSubjectScores.filter(score => score.test_id === testId)
    const subjectScores: TestSubjectScore[] = []
    if (values.test_type === 'Full Mock') {
      for (const subject of SUBJECTS) {
        const part = values.mockScores[subject]
        const result = subjectScoreInputSchema.safeParse({ marks_obtained: nullableNumberInput(part.marks), total_marks: nullableNumberInput(part.total) })
        if (!result.success) {
          for (const issue of result.error.issues) {
            const field = issue.path[0] === 'total_marks' ? `${subject}.total` : `${subject}.marks`
            errors[field] ??= issue.message
          }
          continue
        }
        const { marks_obtained, total_marks } = result.data
        if (marks_obtained !== null || total_marks !== null) {
          const existing = oldScores.find(score => score.subject === subject)
          subjectScores.push({ id: existing?.id ?? createId(), test_id: testId, subject, marks_obtained, total_marks, created_at: existing?.created_at ?? now, updated_at: now })
        }
      }
    }
    if (Object.keys(errors).length || !parsed.success) return errors
    const completeMock = values.test_type === 'Full Mock' && SUBJECTS.every(subject => {
      const score = subjectScores.find(item => item.subject === subject)
      return score?.marks_obtained != null && score.total_marks != null
    })
    const retainLegacyMockScore = values.test_type === 'Full Mock' && existingTest?.test_type === 'Full Mock' && oldScores.length === 0 && (existingTest.marks_obtained !== null || existingTest.total_marks !== null)
    const mockMarks = completeMock ? subjectScores.reduce((sum, score) => sum + (score.marks_obtained ?? 0), 0) : null
    const mockTotal = completeMock ? subjectScores.reduce((sum, score) => sum + (score.total_marks ?? 0), 0) : null
    if (completeMock && mockMarks !== null && mockTotal !== null && (!Number.isFinite(mockMarks) || !Number.isFinite(mockTotal) || mockMarks > mockTotal || mockMarks > MAX_MARKS_OBTAINED || mockTotal > MAX_TOTAL_MARKS)) {
      return { _form: 'The combined Full Mock result is outside the supported total-mark range. Check the three subject totals.' }
    }
    const test: TestRecord = {
      id: testId, title: parsed.data.title, test_date: parsed.data.test_date, test_type: parsed.data.test_type,
      subject: values.subject || selectedChapter?.subject || null, chapter_id: values.chapter_id || null,
      marks_obtained: completeMock ? mockMarks : retainLegacyMockScore ? existingTest?.marks_obtained ?? null : parsed.data.marks_obtained,
      total_marks: completeMock ? mockTotal : retainLegacyMockScore ? existingTest?.total_marks ?? null : parsed.data.total_marks,
      correct: parsed.data.correct, wrong: parsed.data.wrong, skipped: parsed.data.skipped,
      negative_marks: parsed.data.negative_marks, time_minutes: parsed.data.time_minutes, notes: parsed.data.notes,
      created_at: existingTest?.created_at ?? now, updated_at: now
    }
    const oldLinks = data.testChapterLinks.filter(link => link.test_id === testId)
    const matchingLink = oldLinks.find(link => link.chapter_id === test.chapter_id)
    const chapterLink: TestChapterLink | null = test.chapter_id ? {
      id: matchingLink?.id ?? createId(), test_id: test.id, chapter_id: test.chapter_id,
      marks_obtained: test.marks_obtained, total_marks: test.total_marks,
      created_at: matchingLink?.created_at ?? now, updated_at: now
    } : null
    try {
      await upsertFn('tests', test)
      const nextScores = subjectScores.map(score => ({ ...score, test_id: test.id }))
      if (nextScores.length) await upsertManyFn('test_subject_scores', nextScores)
      for (const score of oldScores) {
        if (!nextScores.some(next => next.subject === score.subject)) await removeFn('test_subject_scores', score, { undo: false })
      }
      if (chapterLink) await upsertFn('test_chapter_links', chapterLink)
      for (const link of oldLinks) {
        if (link.id !== chapterLink?.id) await removeFn('test_chapter_links', link, { undo: false })
      }
      notify(current ? 'Test details updated.' : 'Test saved. Your history starts here.')
      setCreating(false)
      setEditing(null)
      return null
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save test. Retry.', 'error')
      return null
    }
  }

  const deleteTest = async () => {
    if (!deleteTarget || deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    try {
      await remove('tests', deleteTarget)
      notify('Test deleted. Undo is available for a few seconds.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not delete test.', 'error')
    } finally {
      deletingRef.current = false
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  const toggleSort = (key: SortKey) => {
    if (sort === key) setAscending(value => !value)
    else {
      setSort(key)
      setAscending(key === 'title')
    }
  }

  return (
    <Screen refreshing={syncState === 'syncing'} onRefresh={() => void refresh()}>
      <PageHeader
        eyebrow="PRACTICE, THEN NOTICE"
        title="Test history"
        subtitle="A score is one signal. The pattern is the useful part."
        action={<Button onPress={() => { setEditing(null); setPresetChapterId(null); setCreating(true) }} icon={<Plus size={17} color={theme.colors.buttonPrimaryInk} />}>Add test</Button>}
      />

      <View style={styles.summary}>
        <Tile label="TESTS LOGGED" value={String(data.tests.length)} note="Across every practice type" />
        <Tile label="AVERAGE SCORE" value={average.average === null ? '—' : `${Math.round(average.average)}%`} note={average.count ? `Mean of ${average.count} usable test result${average.count === 1 ? '' : 's'}; one test counts once` : 'No usable scores in this view'} />
        <Tile label="ACCURACY" value={accuracy.rate === null ? '—' : `${Math.round(accuracy.rate)}%`} note={`${accuracy.correct}/${accuracy.attempted || '—'} correct / attempted`} />
        <Tile label="ATTEMPT RATE" value={attempt.rate === null ? '—' : `${Math.round(attempt.rate)}%`} note={`${attempt.attempted}/${attempt.total || '—'} attempted / total`} />
      </View>

      <NotebookCard padding={14} style={{ gap: 12 }}>
        <TextField label="Search tests" value={search} onChangeText={setSearch} placeholder="Search title, notes or chapter…" autoCorrect={false} leading={<Search size={17} color={theme.colors.muted} />} trailing={search ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch('')} style={styles.clear}><X size={14} color={theme.colors.muted} /></Pressable>
        ) : undefined} />
        <SelectField<'all' | TestType>
          label="Test type"
          value={typeFilter}
          options={[{ value: 'all', label: 'All test types' }, ...TEST_TYPES.map(type => ({ value: type, label: type }))]}
          onChange={setTypeFilter}
        />
        <ChipFilter<'all' | Subject> label="Subject" value={subjectFilter} onChange={setSubjectFilter} options={[{ value: 'all', label: 'All' }, ...SUBJECTS.map(item => ({ value: item, label: item }))]} />
        <View style={styles.dates}>
          <View style={{ flex: 1 }}><DateField label="From" value={from} allowClear onChange={setFrom} /></View>
          <View style={{ flex: 1 }}><DateField label="To" value={to} allowClear onChange={setTo} /></View>
        </View>
        <View style={styles.sortRow}>
          {(['date', 'score', 'title'] as SortKey[]).map(key => {
            const active = sort === key
            const label = key === 'date' ? 'Date' : key === 'score' ? 'Score' : 'Title'
            return (
              <Pressable key={key} accessibilityRole="button" accessibilityLabel={active ? `Sorted by ${label}, ${ascending ? 'ascending' : 'descending'}` : `Sort by ${label}`} onPress={() => toggleSort(key)} style={[styles.sortChip, { borderColor: active ? theme.colors.accent : theme.colors.line, backgroundColor: active ? theme.colors.accentLight : theme.colors.paper }]}>
                <Text style={[theme.type.badge, { color: active ? theme.colors.accentDark : theme.colors.inkSoft }]}>{label}</Text>
                {active ? (ascending ? <ArrowUp size={12} color={theme.colors.accentDark} /> : <ArrowDown size={12} color={theme.colors.accentDark} />) : null}
              </Pressable>
            )
          })}
        </View>
      </NotebookCard>

      <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{sortedTests.length} test{sortedTests.length === 1 ? '' : 's'} in view</Text>
      {sortedTests.length === 0 ? (
        <NotebookCard>
          <EmptyState icon={<Search size={25} color={theme.colors.muted} />} title={data.tests.length ? 'No tests match those filters.' : 'Your first test starts the graph.'} description={data.tests.length ? 'Clear a filter or search for another test.' : 'Add one practice session and start learning from the pattern.'} />
        </NotebookCard>
      ) : (
        <View style={{ gap: 10 }}>
          {sortedTests.map(test => (
            <TestCard key={test.id} test={test} onView={() => setViewing(test)} onEdit={() => { setEditing(test); setCreating(true) }} onDelete={() => setDeleteTarget(test)} />
          ))}
        </View>
      )}
      <Text style={[theme.type.caption, { color: theme.colors.muted, textAlign: 'center' }]}>Full Mocks match every subject filter and show one combined result; percentages compare different totals fairly.</Text>

      {creating ? (
        <TestDialog
          key={editing?.id ?? presetChapterId ?? 'new-test'}
          initial={editing}
          presetChapterId={presetChapterId}
          data={data}
          onClose={() => { setCreating(false); setEditing(null); setPresetChapterId(null) }}
          onSave={(values, stableId) => saveTest(values, editing ?? undefined, stableId, upsert, upsertMany, remove)}
        />
      ) : null}
      {viewing ? <TestDetails test={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); setCreating(true) }} /> : null}
      <ConfirmDialog
        visible={Boolean(deleteTarget)}
        title={`Delete “${deleteTarget?.title ?? ''}”?`}
        message="This test and its related subject scores will be removed. You can undo for a few seconds."
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void deleteTest()}
        loading={deleting}
      />
    </Screen>
  )
}

function Tile({ label, value, note }: { label: string; value: React.ReactNode; note: string }) {
  const theme = useTheme()
  return (
    <NotebookCard padding={14} style={styles.tile}>
      <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 10.5 }]}>{label}</Text>
      <Text style={[theme.type.metric, { color: theme.colors.ink, fontSize: 26, lineHeight: 28 }]}>{value}</Text>
      <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>{note}</Text>
    </NotebookCard>
  )
}

function TestCard({ test, onView, onEdit, onDelete }: { test: TestRecord; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  const theme = useTheme()
  const { data } = useData()
  const overallScore = getOverallTestScore(test, data.testSubjectScores)
  const score = overallScore ? getOverallTestPercentage(test, data.testSubjectScores) : null
  const rawScoreEntered = test.marks_obtained !== null || test.total_marks !== null
  const hasSubjectScores = data.testSubjectScores.some(item => item.test_id === test.id)
  const showRawScore = test.test_type !== 'Full Mock' || !hasSubjectScores
  const scoreLabel = overallScore ? `${fmtNumber(overallScore.marks, 1)} / ${fmtNumber(overallScore.total, 1)}` : rawScoreEntered && showRawScore ? `${fmtNumber(test.marks_obtained, 1)} / ${fmtNumber(test.total_marks, 1)}` : '—'
  const scoreReview = overallScore === null && (hasSubjectScores || rawScoreEntered)
  const accuracy = test.correct != null && test.wrong != null && Number.isInteger(test.correct) && Number.isInteger(test.wrong) && test.correct >= 0 && test.wrong >= 0 && test.correct + test.wrong > 0 ? Math.round((test.correct / (test.correct + test.wrong)) * 100) : null
  const chapter = data.chapters.find(item => item.id === test.chapter_id)
  return (
    <NotebookCard padding={14} style={{ gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`View ${test.title}`} onPress={onView} style={{ gap: 4 }}>
        <View style={styles.row}>
          <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{prettyDate(test.test_date, { day: 'numeric', month: 'short', year: '2-digit' })}</Text>
          <Text style={[theme.type.badge, { color: theme.colors.inkSoft }]}>{test.test_type}</Text>
          {test.test_type === 'Full Mock' ? <StatusBadge tone="muted">All subjects</StatusBadge> : <SubjectBadge subject={test.subject} />}
        </View>
        <Text accessibilityRole="header" style={[theme.type.label, { color: theme.colors.ink }]}>{test.title}</Text>
        <Text style={[theme.type.caption, { color: theme.colors.muted }]} numberOfLines={1}>{(chapter?.name ?? test.notes) || 'Open test details'}</Text>
      </Pressable>
      <View style={styles.row}>
        <Text style={[theme.type.metric, { color: theme.colors.ink, fontSize: 20, lineHeight: 22 }]}>{scoreLabel}</Text>
        {score !== null ? <StatusBadge tone={score < data.settings.weak_threshold ? 'bad' : score <= data.settings.strong_threshold ? 'warn' : 'good'}>{Math.round(score)}%</StatusBadge> : null}
        {scoreReview ? <Text style={[theme.type.badge, { color: theme.colors.orange }]}>Review record</Text> : null}
      </View>
      <View style={styles.row}>
        <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>Accuracy {accuracy === null ? '—' : `${accuracy}%`} · {test.correct ?? '—'} correct · {test.wrong ?? '—'} wrong</Text>
      </View>
      <View style={[styles.actions, { borderTopColor: theme.colors.line }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`View ${test.title}`} onPress={onView} style={styles.action}><Eye size={15} color={theme.colors.ink} /><Text style={[theme.type.label, { color: theme.colors.ink }]}>View</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${test.title}`} onPress={onEdit} style={styles.action}><Pencil size={15} color={theme.colors.ink} /><Text style={[theme.type.label, { color: theme.colors.ink }]}>Edit</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${test.title}`} onPress={onDelete} style={styles.action}><Trash2 size={15} color={theme.colors.red} /><Text style={[theme.type.label, { color: theme.colors.red }]}>Delete</Text></Pressable>
      </View>
    </NotebookCard>
  )
}

function TestDialog({ initial, presetChapterId, data, onClose, onSave }: {
  initial: TestRecord | null
  presetChapterId?: string | null
  data: AppData
  onClose: () => void
  onSave: (values: TestFormValues, stableId: string) => Promise<TestFieldErrors | null>
}) {
  const theme = useTheme()
  const { notify } = useToast()
  const [stableId] = useState(() => initial?.id ?? createId())
  const oldScores = initial ? data.testSubjectScores.filter(score => score.test_id === initial.id) : []
  const presetChapter = !initial && presetChapterId ? data.chapters.find(chapter => chapter.id === presetChapterId) ?? null : null
  const [values, setValues] = useState<TestFormValues>(() => {
    const base = blankValues()
    if (!initial) {
      if (presetChapter) return { ...base, subject: presetChapter.subject, chapter_id: presetChapter.id }
      return base
    }
    const scores = { ...base.mockScores }
    for (const score of oldScores) scores[score.subject] = { marks: score.marks_obtained?.toString() ?? '', total: score.total_marks?.toString() ?? '' }
    return {
      ...base, title: initial.title, test_date: initial.test_date, test_type: initial.test_type, subject: initial.subject ?? '', chapter_id: initial.chapter_id ?? '',
      marks: initial.marks_obtained?.toString() ?? '', total: initial.total_marks?.toString() ?? '', correct: initial.correct?.toString() ?? '',
      wrong: initial.wrong?.toString() ?? '', skipped: initial.skipped?.toString() ?? '', negative: initial.negative_marks?.toString() ?? '',
      time: initial.time_minutes?.toString() ?? '', notes: initial.notes, mockScores: scores
    }
  })
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<TestFieldErrors>({})
  const savingRef = useRef(false)
  const patch = <K extends keyof TestFormValues>(key: K, value: TestFormValues[K]) => {
    setValues(prev => ({ ...prev, [key]: value }))
    setErrors(current => {
      const next = { ...current }
      delete next[String(key)]
      delete next._form
      return next
    })
  }
  const patchScore = (subject: Subject, key: 'marks' | 'total', value: string) => {
    setValues(prev => ({ ...prev, mockScores: { ...prev.mockScores, [subject]: { ...prev.mockScores[subject], [key]: value } } }))
    setErrors(current => {
      const next = { ...current }
      delete next[`${subject}.${key}`]
      delete next._form
      return next
    })
  }
  const chapterOptions = data.chapters.filter(chapter => !values.subject || chapter.subject === values.subject)
  const submit = async () => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const result = await onSave(values, stableId)
      setErrors(result ?? {})
      if (result && Object.keys(result).length) notify('Please correct the highlighted test fields.', 'error')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const isMock = values.test_type === 'Full Mock'
  return (
    <Dialog visible onClose={onClose} title={initial ? 'Edit test record' : 'Log a test'} subtitle="Record only what you know. Leave unknown values blank.">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14 }}>
        {errors._form ? <Text accessibilityRole="alert" style={{ color: theme.colors.red }}>{errors._form}</Text> : null}
        <TextField label="Test title" required value={values.title} error={errors.title} maxLength={160} autoFocus placeholder="e.g. Rotational motion — chapter test" hint={values.title.length >= 120 ? `${values.title.length}/160 characters` : undefined} onChangeText={value => patch('title', value)} />
        <DateField label="Date" required value={values.test_date} error={errors.test_date} onChange={value => patch('test_date', value)} />
        <SelectField<TestType> label="Test type" value={values.test_type} options={TEST_TYPES.map(type => ({ value: type, label: type }))} onChange={value => patch('test_type', value)} />
        <SelectField<Subject | ''>
          label="Subject"
          value={values.subject}
          error={errors.subject}
          options={[{ value: '', label: 'Not specified' }, ...SUBJECTS.map(subject => ({ value: subject, label: subject }))]}
          onChange={value => { patch('subject', value); patch('chapter_id', '') }}
        />
        {presetChapter ? (
          <View style={[styles.preset, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
            <BookOpen size={15} color={theme.colors.accent} />
            <Text style={[theme.type.caption, { color: theme.colors.inkSoft, flex: 1 }]}>Chapter preselected from Weak areas: <Text style={{ fontFamily: theme.fonts.bodyBold, color: theme.colors.ink }}>{presetChapter.name}</Text></Text>
          </View>
        ) : null}
        <SelectField<string>
          label="Chapter (optional)"
          value={values.chapter_id}
          error={errors.chapter_id}
          options={[{ value: '', label: 'Choose chapter' }, ...chapterOptions.map(chapter => ({ value: chapter.id, label: chapter.name, description: chapter.subject }))]}
          onChange={value => patch('chapter_id', value)}
        />
        {isMock ? (
          <View style={{ gap: 10 }}>
            <Text style={[theme.type.label, { color: theme.colors.ink }]}>Subject scores <Text style={[theme.type.caption, { color: theme.colors.muted }]}>(enter each result that you have)</Text></Text>
            <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>The overall result sums all three subjects. Each subject score is checked against its own total; leave unknown scores blank.</Text>
            {SUBJECTS.map(subject => (
              <View key={subject} style={[styles.mockRow, { borderColor: errors[`${subject}.marks`] || errors[`${subject}.total`] ? theme.colors.red : theme.colors.line }]}>
                <SubjectBadge subject={subject} />
                <View style={{ flex: 1, flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}><TextField label={`${subject} marks`} value={values.mockScores[subject].marks} error={errors[`${subject}.marks`]} keyboardType="decimal-pad" max-length={6} onChangeText={value => patchScore(subject, 'marks', value)} /></View>
                  <View style={{ flex: 1 }}><TextField label={`${subject} total`} value={values.mockScores[subject].total} error={errors[`${subject}.total`]} keyboardType="number-pad" onChangeText={value => patchScore(subject, 'total', value)} /></View>
                </View>
                <Text style={[theme.type.badge, { color: theme.colors.muted }]}>max {subjectScoreMax(values.mockScores[subject].total)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.twoCol}>
            <View style={{ flex: 1 }}><TextField label="Marks obtained" value={values.marks} error={errors.marks} keyboardType="decimal-pad" placeholder="Leave blank if unknown" onChangeText={value => patch('marks', value)} /></View>
            <View style={{ flex: 1 }}><TextField label="Total marks" value={values.total} error={errors.total} keyboardType="number-pad" onChangeText={value => patch('total', value)} /></View>
          </View>
        )}
        <View style={styles.threeCol}>
          <View style={{ flex: 1 }}><TextField label="Correct" value={values.correct} error={errors.correct} keyboardType="number-pad" placeholder="—" onChangeText={value => patch('correct', value)} /></View>
          <View style={{ flex: 1 }}><TextField label="Wrong" value={values.wrong} error={errors.wrong} keyboardType="number-pad" placeholder="—" onChangeText={value => patch('wrong', value)} /></View>
          <View style={{ flex: 1 }}><TextField label="Skipped" value={values.skipped} error={errors.skipped} keyboardType="number-pad" placeholder="—" onChangeText={value => patch('skipped', value)} /></View>
        </View>
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}><TextField label="Negative marks" value={values.negative} error={errors.negative_marks} keyboardType="decimal-pad" placeholder="No estimate" onChangeText={value => patch('negative', value)} /></View>
          <View style={{ flex: 1 }}><TextField label="Time taken (minutes)" value={values.time} error={errors.time_minutes} keyboardType="number-pad" onChangeText={value => patch('time', value)} /></View>
        </View>
        <TextField label="Notes" multiline maxLength={10000} value={values.notes} error={errors.notes} placeholder="What felt easy? What deserves another look?" onChangeText={value => patch('notes', value)} />
        <View style={styles.dialogActions}>
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button loading={saving} onPress={() => void submit()}>{initial ? 'Save changes' : 'Save test'}</Button>
        </View>
      </ScrollView>
    </Dialog>
  )
}

function TestDetails({ test, onClose, onEdit }: { test: TestRecord; onClose: () => void; onEdit: () => void }) {
  const theme = useTheme()
  const { data } = useData()
  const chapter = data.chapters.find(item => item.id === test.chapter_id)
  const scores = data.testSubjectScores.filter(score => score.test_id === test.id)
  const overallScore = getOverallTestScore(test, data.testSubjectScores)
  const overallPercentage = overallScore ? getOverallTestPercentage(test, data.testSubjectScores) : null
  const rawParentResult = test.marks_obtained !== null || test.total_marks !== null
  const parentScoreLabel = overallScore ? `${fmtNumber(overallScore.marks, 1)} / ${fmtNumber(overallScore.total, 1)}` : rawParentResult ? `${fmtNumber(test.marks_obtained, 1)} / ${fmtNumber(test.total_marks, 1)}` : 'Score not recorded'
  const parentResultMessage = rawParentResult ? 'Stored result is incomplete or outside the valid range. Review this record.' : 'No score percentage available.'
  const facts: [string, string | number | null | undefined][] = [
    ['Correct', test.correct], ['Wrong', test.wrong], ['Skipped', test.skipped], ['Negative marks', test.negative_marks],
    ['Time taken', test.time_minutes == null ? null : `${test.time_minutes} min`]
  ]
  return (
    <Dialog visible onClose={onClose} title={test.title} subtitle={`${test.test_type} · ${prettyDate(test.test_date)}`}>
      <View style={{ gap: 12 }}>
        <View style={styles.row}>
          {test.test_type === 'Full Mock' ? <StatusBadge tone="muted">All subjects</StatusBadge> : <SubjectBadge subject={test.subject} />}
          <StatusBadge tone="info">{test.test_type}</StatusBadge>
          {chapter ? <StatusBadge tone="muted">{chapter.name}</StatusBadge> : null}
        </View>
        <View style={[styles.detailBox, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
          <Text style={[theme.type.metric, { color: theme.colors.ink, fontSize: 24, lineHeight: 26 }]}>{overallScore ? parentScoreLabel : scores.length ? 'Overall result incomplete' : parentScoreLabel}</Text>
          <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>{overallPercentage === null ? (scores.length ? 'A comparable percentage needs valid marks and totals for all three subjects.' : parentResultMessage) : `${Math.round(overallPercentage)}% of combined subject totals`}</Text>
        </View>
        {scores.length > 0 ? (
          <View style={{ gap: 8 }}>
            {scores.map(score => (
              <View key={score.id} style={[styles.detailBox, { borderColor: theme.colors.line }]}>
                <SubjectBadge subject={score.subject} />
                <Text style={[theme.type.label, { color: theme.colors.ink }]}>{score.marks_obtained == null ? '—' : `${fmtNumber(score.marks_obtained, 1)} / ${fmtNumber(score.total_marks, 1)}`}</Text>
                {score.marks_obtained !== null && score.total_marks !== null ? <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{subjectPercentageText(score.marks_obtained, score.total_marks)}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.factGrid}>
          {facts.map(([label, value]) => (
            <View key={label} style={[styles.fact, { borderColor: theme.colors.line }]}>
              <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>{label}</Text>
              <Text style={[theme.type.label, { color: theme.colors.ink }]}>{value ?? '—'}</Text>
            </View>
          ))}
        </View>
        {test.notes ? (
          <View style={{ gap: 4 }}>
            <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11 }]}>AFTER-TEST NOTES</Text>
            <Text style={[theme.type.body, { color: theme.colors.inkSoft }]}>{test.notes}</Text>
          </View>
        ) : null}
        <View style={styles.dialogActions}>
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button onPress={onEdit}>Edit record</Button>
        </View>
      </View>
    </Dialog>
  )
}

function subjectPercentageText(marks: number, total: number): string {
  const percentage = validPercentage(marks, total)
  return percentage === null ? 'Score outside valid range' : `${Math.round(percentage)}%`
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexBasis: '47%', flexGrow: 1, gap: 4 },
  clear: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  dates: { flexDirection: 'row', gap: 10 },
  sortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sortChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 42, paddingHorizontal: 4 },
  preset: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, padding: 10 },
  mockRow: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  twoCol: { flexDirection: 'row', gap: 10 },
  threeCol: { flexDirection: 'row', gap: 8 },
  detailBox: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fact: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderRadius: 10, padding: 10, gap: 2 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }
})
