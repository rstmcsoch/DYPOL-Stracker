import { useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { useData, type DataContextValue } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { useTheme } from '../contexts/AppearanceContext'
import { createId, stableId } from '../shared/lib/id'
import { prettyDate } from '../shared/lib/date'
import { categoryTotals, mockInsights, mockSummary, subjectTimeRows } from '../shared/lib/jee/mock-analysis'
import { validateErrorLog, type ErrorLogFormInput, type ErrorLogValue } from '../shared/lib/jee/forms'
import { ERROR_CATEGORIES, SUBJECTS, type AppData, type ErrorCategory, type Subject, type TestErrorLog, type TestRecord, type TestTimeEntry } from '../shared/types'
import { Check, Clock, Lightbulb, Pencil, Plus, Trash2 } from '../components/icons'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Overlays'
import { Screen } from '../components/ui/Screen'
import { SelectField, TextField } from '../components/ui/Forms'
import { OverflowMenu } from '../components/ui/OverflowMenu'
import { EmptyState, NotebookCard, PageHeader, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui/Surfaces'
import { Meter, Pct, minutesLabel, wholeNumber } from '../components/jee/shared'

/** Mock analysis: recorded numbers, your own classifications, and derived insights, kept visibly separate. */
export function MockAnalysisScreen() {
  const theme = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ test?: string }>()
  const { data, upsert, upsertMany, remove, refresh, syncState } = useData()
  const { notify } = useToast()
  const tests = useMemo(() => [...data.tests].sort((a, b) => b.test_date.localeCompare(a.test_date)), [data.tests])
  const [selectedId, setSelectedId] = useState(typeof params.test === 'string' ? params.test : tests[0]?.id ?? '')
  const [classifying, setClassifying] = useState<TestErrorLog | 'new' | null>(null)
  const [timing, setTiming] = useState(false)
  const selected = tests.find(test => test.id === selectedId) ?? tests[0] ?? null
  const go = (to: string) => router.navigate(to as Href)

  if (!selected) {
    return (
      <Screen refreshing={syncState === 'syncing'} onRefresh={() => void refresh()}>
        <PageHeader eyebrow="WHY DID I LOSE MARKS?" title="Mock analysis" subtitle="Record a test first, then come back to classify what went wrong." />
        <NotebookCard>
          <EmptyState title="No tests to analyse yet." description="Log a mock or a subject test with its marks. Then you can add time per subject and tag lost marks." action={<Button variant="secondary" size="sm" onPress={() => go('/tests?add=1')}>Log a test</Button>} />
        </NotebookCard>
      </Screen>
    )
  }

  const logs = data.testErrorLogs.filter(log => log.test_id === selected.id).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const times = subjectTimeRows(selected, data)
  const summary = mockSummary(selected, data)
  const totals = categoryTotals(logs)
  const insights = mockInsights(selected, data)
  const hasRecordedTime = data.testTimeEntries.some(entry => entry.test_id === selected.id)

  const removeLog = async (log: TestErrorLog) => {
    try {
      await remove('test_error_logs', log)
      notify('Classification removed. Undo is available briefly.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not remove this classification.', 'error')
    }
  }

  return (
    <Screen refreshing={syncState === 'syncing'} onRefresh={() => void refresh()}>
      <PageHeader eyebrow="WHAT SHOULD I FIX BEFORE THE NEXT MOCK?" title="Mock analysis" subtitle="Recorded numbers, your own classifications, and derived insights are kept separate, so every claim shows its basis." />

      <NotebookCard padding={14} style={{ gap: 12 }}>
        <SelectField<string>
          label="Test"
          value={selected.id}
          options={tests.map(test => ({ value: test.id, label: test.title, description: `${prettyDate(test.test_date)} · ${test.test_type}` }))}
          onChange={setSelectedId}
        />
        <View style={styles.summary}>
          <SummaryTile label="Recorded score" value={summary.score === null ? '—' : <Pct value={summary.score} digits={1} />} />
          <SummaryTile label="Type" value={selected.test_type} />
          <SummaryTile label="Lost marks tagged" value={String(summary.taggedMarks ?? '—')} />
          <SummaryTile label="Questions tagged" value={String(summary.taggedQuestions || '—')} />
        </View>
      </NotebookCard>

      <SectionHeading title="Recorded time & attempts" note="Only what you entered. Missing values stay blank." action={<Button variant="secondary" size="sm" onPress={() => setTiming(true)} icon={<Clock size={15} color={theme.colors.ink} />}>{hasRecordedTime ? 'Edit' : 'Add'} time</Button>} />
      <NotebookCard padding={14} style={{ gap: 12 }}>
        {times.length === 0 ? (
          <Text style={[theme.type.caption, { color: theme.colors.muted }]}>No time or attempt data recorded for this test. Nothing is estimated — add it if you tracked it.</Text>
        ) : times.map(row => (
          <View key={row.subject} style={{ gap: 6 }}>
            <SubjectBadge subject={row.subject} />
            <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>
              Time <Text style={styles.strong}>{row.minutes === null ? '—' : minutesLabel(row.minutes)}</Text> · Attempted <Text style={styles.strong}>{row.attempted ?? '—'}</Text> · Unattempted <Text style={styles.strong}>{row.unattempted ?? '—'}</Text> · Marks <Text style={styles.strong}>{row.marks ?? '—'}{row.total ? `/${row.total}` : ''}</Text>
            </Text>
            {row.marksPerMinute !== null ? <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>{row.marksPerMinute.toFixed(2)} marks per minute spent</Text> : null}
          </View>
        ))}
      </NotebookCard>

      <SectionHeading title="Lost marks, classified" note="Tag each lost question or chunk of marks with why it happened." action={<Button size="sm" onPress={() => setClassifying('new')} icon={<Plus size={15} color={theme.colors.buttonPrimaryInk} />}>Classify</Button>} />
      <NotebookCard padding={14} style={{ gap: 12 }}>
        {logs.length === 0 ? (
          <Text style={[theme.type.caption, { color: theme.colors.muted }]}>No classifications yet. Try tagging the three biggest causes — that is usually enough to see a pattern.</Text>
        ) : logs.map(log => (
          <View key={log.id} style={[styles.logRow, { borderBottomColor: theme.colors.line }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[theme.type.label, { color: theme.colors.ink }]}>{log.category}</Text>
              <View style={styles.inline}>
                {log.subject ? <SubjectBadge subject={log.subject} /> : null}
                {log.marks_lost !== null ? <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{log.marks_lost} marks</Text> : null}
                {log.questions !== null ? <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{log.questions} question{log.questions === 1 ? '' : 's'}</Text> : null}
              </View>
              {log.note ? <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>{log.note}</Text> : null}
            </View>
            <OverflowMenu label={`Actions for ${log.category}`} title="Classification" items={[
              { id: 'edit', label: 'Edit', icon: <Pencil size={15} color={theme.colors.ink} />, onSelect: () => setClassifying(log) },
              { id: 'delete', label: 'Delete', icon: <Trash2 size={15} color={theme.colors.red} />, danger: true, onSelect: () => void removeLog(log) }
            ]} />
          </View>
        ))}
      </NotebookCard>

      <SectionHeading title="Where the marks went" note="Your classifications, summed." />
      <NotebookCard padding={14} style={{ gap: 12 }}>
        {totals.length === 0 ? (
          <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Classify some lost marks to see the breakdown.</Text>
        ) : totals.map(total => {
          const max = Math.max(...totals.map(item => item.marksLost ?? item.entries))
          const value = total.marksLost ?? total.entries
          return (
            <View key={total.category} style={{ gap: 6 }}>
              <View style={styles.rowBetween}>
                <Text style={[theme.type.label, { color: theme.colors.ink }]}>{total.category}</Text>
                <Text style={[theme.type.badge, { color: theme.colors.inkSoft }]}>{total.marksLost !== null ? `${total.marksLost} marks` : `${total.entries} tag${total.entries === 1 ? '' : 's'}`}</Text>
              </View>
              <Meter value={max ? (value / max) * 100 : 0} label={`${total.category} share`} tone="orange" />
            </View>
          )
        })}
      </NotebookCard>

      <SectionHeading title="Fix before your next mock" note="Derived from the data above — each line says what it is based on." />
      <NotebookCard padding={14} style={{ gap: 12 }}>
        {insights.length === 0 ? (
          <View style={styles.inline}>
            <Lightbulb size={18} color={theme.colors.muted} />
            <Text style={[theme.type.caption, { color: theme.colors.muted, flex: 1 }]}>Not enough recorded detail to draw a conclusion. Add subject marks, time, or a few classifications.</Text>
          </View>
        ) : insights.map((insight, index) => (
          <View key={index} style={{ gap: 6 }}>
            <StatusBadge tone={insight.kind === 'recorded' ? 'good' : insight.kind === 'classified' ? 'warn' : 'muted'}>{insight.kind === 'recorded' ? 'Recorded' : insight.kind === 'classified' ? 'You classified' : 'Derived'}</StatusBadge>
            <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>{insight.text}</Text>
          </View>
        ))}
      </NotebookCard>
      <Button variant="quiet" size="sm" onPress={() => go('/weak-areas')}>See weak areas →</Button>

      {classifying ? (
        <ClassifyDialog test={selected} existing={classifying === 'new' ? undefined : classifying} onClose={() => setClassifying(null)} onSave={async value => {
          const now = new Date().toISOString()
          const existing = classifying === 'new' ? undefined : classifying
          await upsert('test_error_logs', { id: existing?.id ?? createId(), ...value, chapter_id: null, created_at: existing?.created_at ?? now, updated_at: now })
          notify('Classification saved.')
        }} />
      ) : null}
      {timing ? (
        <TimeDialog data={data} test={selected} upsertMany={upsertMany} onClose={() => setTiming(false)} />
      ) : null}
    </Screen>
  )
}

function SummaryTile({ label, value }: { label: string; value: React.ReactNode }) {
  const theme = useTheme()
  return (
    <View style={[styles.tile, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
      <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>{label}</Text>
      <Text style={[theme.type.label, { color: theme.colors.ink }]}>{value}</Text>
    </View>
  )
}

function ClassifyDialog({ test, existing, onClose, onSave }: {
  test: TestRecord
  existing?: TestErrorLog
  onClose: () => void
  onSave: (value: ErrorLogValue) => Promise<void>
}) {
  const theme = useTheme()
  const [form, setForm] = useState<ErrorLogFormInput>({
    testId: test.id,
    subject: existing?.subject ?? '',
    category: existing?.category ?? 'Silly mistake',
    marksLost: existing?.marks_lost != null ? String(existing.marks_lost) : '',
    questions: existing?.questions != null ? String(existing.questions) : '',
    note: existing?.note ?? ''
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const { notify } = useToast()
  const set = <K extends keyof ErrorLogFormInput>(key: K, value: ErrorLogFormInput[K]) => {
    setForm(current => ({ ...current, [key]: value }))
    setErrors(current => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }
  const submit = async () => {
    if (saving) return
    const result = validateErrorLog(form)
    if (!result.ok) {
      setErrors(result.errors)
      notify('Check the highlighted fields.', 'error')
      return
    }
    setSaving(true)
    try {
      await onSave(result.value)
      onClose()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save the classification.', 'error')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog visible onClose={onClose} title={existing ? 'Edit classification' : 'Classify lost marks'} subtitle="What went wrong on this question or chunk of marks?">
      <View style={{ gap: 14 }}>
        <SelectField<string>
          label="Subject"
          value={form.subject}
          options={[{ value: '', label: 'Not specified' }, ...SUBJECTS.map(subject => ({ value: subject, label: subject }))]}
          onChange={value => set('subject', value as Subject | '')}
        />
        <SelectField<ErrorCategory>
          label="Why did it happen?"
          required
          value={form.category}
          error={errors.category}
          options={ERROR_CATEGORIES.map(category => ({ value: category, label: category }))}
          onChange={value => set('category', value)}
        />
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}><TextField label="Questions" error={errors.questions} value={form.questions} keyboardType="number-pad" placeholder="4" onChangeText={value => set('questions', value)} /></View>
          <View style={{ flex: 1 }}><TextField label="Marks lost" error={errors.marksLost} value={form.marksLost} keyboardType="decimal-pad" placeholder="16" onChangeText={value => set('marksLost', value)} /></View>
        </View>
        <TextField label="Note (optional)" error={errors.note} value={form.note} multiline maxLength={5000} placeholder="e.g. sign error in Q12 after long substitution" onChangeText={value => set('note', value)} />
        <View style={styles.dialogActions}>
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button loading={saving} onPress={() => void submit()} icon={<Check size={16} color={theme.colors.buttonPrimaryInk} />}>{existing ? 'Save' : 'Add classification'}</Button>
        </View>
      </View>
    </Dialog>
  )
}

function TimeDialog({ data, test, upsertMany, onClose }: {
  data: AppData
  test: TestRecord
  upsertMany: DataContextValue['upsertMany']
  onClose: () => void
}) {
  const theme = useTheme()
  const existing = data.testTimeEntries.filter(entry => entry.test_id === test.id)
  const [rows, setRows] = useState(() => SUBJECTS.map(subject => {
    const row = existing.find(entry => entry.subject === subject)
    return {
      subject,
      minutes: row?.minutes != null ? String(row.minutes) : '',
      attempted: row?.attempted != null ? String(row.attempted) : '',
      unattempted: row?.unattempted != null ? String(row.unattempted) : ''
    }
  }))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { notify } = useToast()
  const update = (subject: Subject, key: 'minutes' | 'attempted' | 'unattempted', value: string) =>
    setRows(current => current.map(row => (row.subject === subject ? { ...row, [key]: value } : row)))
  const submit = async () => {
    if (saving) return
    const entries: TestTimeEntry[] = []
    const now = new Date().toISOString()
    for (const [index, row] of rows.entries()) {
      const fields = [row.minutes, row.attempted, row.unattempted]
      if (fields.every(value => value.trim() === '')) {
        const previous = existing.find(entry => entry.subject === row.subject)
        if (previous) entries.push({ ...previous, minutes: null, attempted: null, unattempted: null, updated_at: now })
        continue
      }
      const minutes = row.minutes.trim() === '' ? null : wholeNumber(row.minutes)
      const attempted = row.attempted.trim() === '' ? null : wholeNumber(row.attempted)
      const unattempted = row.unattempted.trim() === '' ? null : wholeNumber(row.unattempted)
      if ((minutes !== null && (Number.isNaN(minutes) || minutes < 0 || minutes > 1440)) || (attempted !== null && (Number.isNaN(attempted) || attempted < 0)) || (unattempted !== null && (Number.isNaN(unattempted) || unattempted < 0))) {
        setError(`Use whole numbers for ${row.subject}: minutes 0–1440, and counts 0 or more.`)
        return
      }
      entries.push({
        id: stableId(`${test.id}:time:${row.subject}`), test_id: test.id, subject: row.subject, label: '',
        minutes, attempted, unattempted, order_index: index,
        created_at: existing.find(entry => entry.subject === row.subject)?.created_at ?? now, updated_at: now
      })
    }
    setSaving(true)
    try {
      await upsertMany('test_time_entries', entries)
      notify('Time and attempts saved for this test.')
      onClose()
    } catch (saveError) {
      notify(saveError instanceof Error ? saveError.message : 'Could not save time data.', 'error')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog visible onClose={onClose} title="Time & attempts by subject" subtitle="Leave a field blank if you did not record it — nothing is estimated.">
      <View style={{ gap: 14 }}>
        {rows.map(row => (
          <View key={row.subject} style={[styles.fieldset, { borderColor: theme.colors.line }]}>
            <SubjectBadge subject={row.subject} />
            <View style={styles.threeCol}>
              <View style={{ flex: 1 }}><TextField label="Minutes" value={row.minutes} keyboardType="number-pad" onChangeText={value => update(row.subject, 'minutes', value)} /></View>
              <View style={{ flex: 1 }}><TextField label="Attempted" value={row.attempted} keyboardType="number-pad" onChangeText={value => update(row.subject, 'attempted', value)} /></View>
              <View style={{ flex: 1 }}><TextField label="Unattempted" value={row.unattempted} keyboardType="number-pad" onChangeText={value => update(row.subject, 'unattempted', value)} /></View>
            </View>
          </View>
        ))}
        {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.red }}>{error}</Text> : null}
        <View style={styles.dialogActions}>
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button loading={saving} onPress={() => void submit()} icon={<Check size={16} color={theme.colors.buttonPrimaryInk} />}>Save time data</Button>
        </View>
      </View>
    </Dialog>
  )
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderRadius: 12, padding: 10, gap: 2 },
  strong: { fontWeight: '700' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  logRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  twoCol: { flexDirection: 'row', gap: 10 },
  threeCol: { flexDirection: 'row', gap: 8 },
  fieldset: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }
})
