import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownWideNarrow, ArrowUpWideNarrow, BookOpen, CalendarDays, ChartNoAxesCombined, Eye, Filter, ListFilter, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { Button, ConfirmDialog, Dialog, EmptyState, Field, NotebookCard, PageHeader, StatusBadge, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { getAccuracy, getAttemptRate, getMeanTestPercentage, getOverallTestPercentage, getOverallTestScore, validPercentage } from '../lib/analytics'
import { fmtNumber } from '../lib/format'
import { prettyDate, indiaToday } from '../lib/date'
import { createId } from '../lib/id'
import { MAX_MARKS_OBTAINED, MAX_NEGATIVE_MARKS, MAX_TOTAL_MARKS, POSTGRES_INTEGER_MAX, nullableNumberInput, subjectScoreInputSchema, testFormSchema } from '../lib/test-validation'
import type { Subject, TestRecord, TestType, TestSubjectScore, TestChapterLink } from '../types'
import { SUBJECTS } from '../types'

type SortKey = 'date' | 'score' | 'title'
type TestFieldErrors = Record<string, string>
type TestFormValues = {
  title: string; test_date: string; test_type: TestType; subject: Subject | ''; chapter_id: string;
  marks: string; total: string; correct: string; wrong: string; skipped: string; negative: string; time: string; notes: string;
  mockScores: Record<Subject, { marks: string; total: string }>
}
const TEST_TYPES: TestType[] = ['Chapter Test', 'Subject Test', 'Full Mock', 'PYQ Practice']
const blankValues = (): TestFormValues => ({
  title: '', test_date: indiaToday(), test_type: 'Chapter Test', subject: '', chapter_id: '', marks: '', total: '',
  correct: '', wrong: '', skipped: '', negative: '', time: '', notes: '',
  mockScores: { Physics: { marks: '', total: '' }, Chemistry: { marks: '', total: '' }, Maths: { marks: '', total: '' } }
})

const FORM_FIELD_BY_SCHEMA_FIELD: Record<string, string> = {
  marks_obtained: 'marks', total_marks: 'total', test_date: 'test_date'
}

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

export default function TestsPage() {
  const { data, upsert, upsertMany, remove } = useData()
  const { notify } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
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

  useEffect(() => {
    if (searchParams.get('add') === '1') {
      // A chapter preselect (e.g. from Weak areas) opens the same dialog with that
      // chapter already chosen, so the user never has to pick it twice.
      setPresetChapterId(searchParams.get('chapter'))
      setCreating(true)
      const params = new URLSearchParams(searchParams)
      params.delete('add')
      params.delete('chapter')
      setSearchParams(params, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const sortedTests = useMemo(() => {
    const term = search.trim().toLowerCase()
    return data.tests.filter(test => {
      const displayedSubject = test.test_type === 'Full Mock' ? 'All subjects' : test.subject ?? ''
      if (term && !`${test.title} ${test.test_type} ${test.notes} ${displayedSubject} ${data.chapters.find(ch => ch.id === test.chapter_id)?.name ?? ''}`.toLowerCase().includes(term)) return false
      if (typeFilter !== 'all' && test.test_type !== typeFilter) return false
      // A Full Mock is a multi-subject record regardless of its optional legacy/tag field.
      // Its row says “All subjects”, so it remains discoverable under every subject filter.
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
  const averageScore = average.average

  const saveTest = async (values: TestFormValues, current: TestRecord | undefined, stableId: string): Promise<TestFieldErrors | null> => {
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
    // The stable dialog ID also lets a retry reuse rows already cached locally when a
    // cloud sync failed after the first write, instead of creating duplicate children.
    const existingTest = current ?? data.tests.find(test => test.id === testId)
    const oldScores = data.testSubjectScores.filter(score => score.test_id === testId)
    const subjectScores: TestSubjectScore[] = []
    if (values.test_type === 'Full Mock') {
      for (const subject of SUBJECTS) {
        const part = values.mockScores[subject]
        const result = subjectScoreInputSchema.safeParse({
          marks_obtained: nullableNumberInput(part.marks), total_marks: nullableNumberInput(part.total)
        })
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
          subjectScores.push({
            id: existing?.id ?? createId(), test_id: testId, subject, marks_obtained, total_marks,
            created_at: existing?.created_at ?? now, updated_at: now
          })
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
    if (completeMock && mockMarks !== null && mockTotal !== null && (
      !Number.isFinite(mockMarks) || !Number.isFinite(mockTotal) || mockMarks > mockTotal ||
      mockMarks > MAX_MARKS_OBTAINED || mockTotal > MAX_TOTAL_MARKS
    )) {
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
      // Every test and subject score is validated before the first local/cloud write.
      await upsert('tests', test)
      const nextScores = subjectScores.map(score => ({ ...score, test_id: test.id }))
      if (nextScores.length) await upsertMany('test_subject_scores', nextScores)
      for (const score of oldScores) {
        if (!nextScores.some(next => next.subject === score.subject)) await remove('test_subject_scores', score, { undo: false })
      }
      if (chapterLink) await upsert('test_chapter_links', chapterLink)
      for (const link of oldLinks) {
        if (link.id !== chapterLink?.id) await remove('test_chapter_links', link, { undo: false })
      }
      notify(current ? 'Test details updated.' : 'Test saved. Your history starts here.')
      setCreating(false); setEditing(null)
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
    try { await remove('tests', deleteTarget); notify('Test deleted. Undo is available for a few seconds.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not delete test.', 'error') }
    finally { deletingRef.current = false; setDeleting(false); setDeleteTarget(null) }
  }

  const toggleSort = (key: SortKey) => {
    if (sort === key) setAscending(value => !value)
    else { setSort(key); setAscending(key === 'title') }
  }

  const sortHeader = (key: SortKey, label: string) => {
    const active = sort === key
    const direction = ascending ? 'ascending' : 'descending'
    return <th aria-sort={active ? direction : 'none'}><button className={active ? 'sort-active' : ''} onClick={() => toggleSort(key)} aria-label={active ? `Sorted by ${label}, ${direction}` : `Sort by ${label}`} title={active ? `Sorted by ${label} ${ascending ? '↑' : '↓'}` : `Sort by ${label}`}>
      {active ? `${label} ${ascending ? '↑' : '↓'}` : label.toUpperCase()}{active && (ascending ? <ArrowUpWideNarrow size={13} aria-hidden="true" /> : <ArrowDownWideNarrow size={13} aria-hidden="true" />)}
    </button></th>
  }

  return <div className="content-page tests-page">
    <PageHeader eyebrow="PRACTICE, THEN NOTICE" title="Test history" subtitle="A score is one signal. The pattern is the useful part." doodle={<ChartNoAxesCombined size={20} />} action={<Button onClick={() => { setEditing(null); setPresetChapterId(null); setCreating(true) }}><Plus size={17} /> Add test</Button>} />
    <div className="test-summary-grid"><NotebookCard className="test-summary-card"><span>TESTS LOGGED</span><strong>{data.tests.length}</strong><small>Across every practice type</small></NotebookCard><NotebookCard className="test-summary-card"><span>AVERAGE SCORE</span><strong>{averageScore === null ? '—' : `${Math.round(averageScore)}%`}</strong><small>{average.count ? `Mean of ${average.count} usable test result${average.count === 1 ? '' : 's'}; one test counts once` : 'No usable scores in this view'}</small></NotebookCard><NotebookCard className="test-summary-card"><span>ACCURACY</span><strong>{accuracy.rate === null ? '—' : `${Math.round(accuracy.rate)}%`}</strong><small>{accuracy.correct}/{accuracy.attempted || '—'} correct / attempted</small></NotebookCard><NotebookCard className="test-summary-card"><span>ATTEMPT RATE</span><strong>{attempt.rate === null ? '—' : `${Math.round(attempt.rate)}%`}</strong><small>{attempt.attempted}/{attempt.total || '—'} attempted / total</small></NotebookCard></div>
    <NotebookCard className="test-history-board">
      <div className="test-board-top"><div><span className="handwriting-label">Every attempt matters</span><p>{sortedTests.length} test{sortedTests.length === 1 ? '' : 's'} in view</p></div><div className="test-board-doodle" aria-hidden="true">∿✦</div></div>
      <div className="test-filter-row">
        <div className="search-field"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search title, notes or chapter…" aria-label="Search tests" />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}</div>
        <label className="filter-select"><ListFilter size={15} /><select aria-label="Filter by test type" value={typeFilter} onChange={event => setTypeFilter(event.target.value as 'all' | TestType)}><option value="all">All test types</option>{TEST_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
        <label className="filter-select"><SlidersHorizontal size={15} /><select aria-label="Filter by subject" value={subjectFilter} onChange={event => setSubjectFilter(event.target.value as 'all' | Subject)}><option value="all">All subjects</option>{SUBJECTS.map(subject => <option key={subject}>{subject}</option>)}</select></label>
        <details className="date-filter-popover"><summary><CalendarDays size={15} /> Dates</summary><div><Field label="From"><input type="date" value={from} onChange={event => setFrom(event.target.value)} /></Field><Field label="To"><input type="date" value={to} onChange={event => setTo(event.target.value)} /></Field></div></details>
      </div>
      <div className="table-scroll-wrap">
        {sortedTests.length === 0 ? <EmptyState icon={<ListFilter size={25} />} title={data.tests.length ? 'No tests match those filters.' : 'Your first test starts the graph.'} description={data.tests.length ? 'Clear a filter or search for another test.' : 'Add one practice session and start learning from the pattern.'} action={<Button variant="secondary" size="sm" onClick={() => data.tests.length ? (setSearch(''), setFrom(''), setTo(''), setSubjectFilter('all'), setTypeFilter('all')) : setCreating(true)}>{data.tests.length ? 'Clear filters' : <><Plus size={15} /> Add your first test</>}</Button>} /> : <table className="test-table">
          <thead><tr>{sortHeader('date', 'Date')}{sortHeader('title', 'Title')}<th>TYPE / SUBJECT</th>{sortHeader('score', 'Score')}<th>ACCURACY</th><th>ACTIONS</th></tr></thead>
          <tbody>{sortedTests.map(test => <TestRow key={test.id} test={test} onView={() => setViewing(test)} onEdit={() => { setEditing(test); setCreating(true) }} onDelete={() => setDeleteTarget(test)} />)}</tbody>
        </table>}
      </div>
      <div className="test-board-footer"><span><Filter size={14} /> Full Mocks match every subject filter and show one combined result; percentages compare different totals fairly.</span><button onClick={() => navigate('/backup')}>Export options are in Backup <ArrowRightIcon /></button></div>
    </NotebookCard>
    {creating && <TestDialog key={editing?.id ?? presetChapterId ?? 'new-test'} initial={editing} presetChapterId={presetChapterId} data={data} onClose={() => { setCreating(false); setEditing(null); setPresetChapterId(null) }} onSave={(values, stableId) => saveTest(values, editing ?? undefined, stableId)} />}
    {viewing && <TestDetails test={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); setCreating(true) }} />}
    {deleteTarget && <ConfirmDialog title={`Delete “${deleteTarget.title}”?`} message="This test and its related subject scores will be removed. You can undo for a few seconds." onCancel={() => setDeleteTarget(null)} onConfirm={() => void deleteTest()} loading={deleting} />}
  </div>
}

function ArrowRightIcon() { return <span aria-hidden="true">↗</span> }

function TestRow({ test, onView, onEdit, onDelete }: { test: TestRecord; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  const { data } = useData()
  const overallScore = getOverallTestScore(test, data.testSubjectScores)
  const score = overallScore ? getOverallTestPercentage(test, data.testSubjectScores) : null
  const rawScoreEntered = test.marks_obtained !== null || test.total_marks !== null
  const hasSubjectScores = data.testSubjectScores.some(item => item.test_id === test.id)
  const showRawScore = test.test_type !== 'Full Mock' || !hasSubjectScores
  const scoreLabel = overallScore ? `${fmtNumber(overallScore.marks, 1)} / ${fmtNumber(overallScore.total, 1)}` : rawScoreEntered && showRawScore ? `${fmtNumber(test.marks_obtained, 1)} / ${fmtNumber(test.total_marks, 1)}` : '—'
  const scoreReview = overallScore === null && (hasSubjectScores || rawScoreEntered)
  const accuracy = test.correct != null && test.wrong != null && Number.isInteger(test.correct) && Number.isInteger(test.wrong) && test.correct >= 0 && test.wrong >= 0 && test.correct + test.wrong > 0 ? Math.round(test.correct / (test.correct + test.wrong) * 100) : null
  const chapter = data.chapters.find(item => item.id === test.chapter_id)
  return <tr>
    <td data-label="Date"><span className="test-date-cell">{prettyDate(test.test_date, { day: 'numeric', month: 'short', year: '2-digit' })}</span></td>
    <td data-label="Test"><button className="test-title-button" title={test.title} onClick={onView}><strong>{test.title}</strong><span>{(chapter?.name ?? test.notes) || 'Open test details'}</span></button></td>
    <td data-label="Type / subject"><span className="test-type-label">{test.test_type}</span>{test.test_type === 'Full Mock' ? <StatusBadge tone="muted">All subjects</StatusBadge> : <SubjectBadge subject={test.subject} />}</td>
    <td data-label="Score"><div className="score-cell"><strong>{scoreLabel}</strong>{score !== null && <StatusBadge tone={score < data.settings.weak_threshold ? 'Weak' : score <= data.settings.strong_threshold ? 'Okay' : 'Strong'}>{Math.round(score)}%</StatusBadge>}{scoreReview && <small className="score-review-note">{hasSubjectScores ? 'Incomplete or invalid subject results' : 'Review saved score'}</small>}</div></td>
    <td data-label="Accuracy">{accuracy === null ? <span className="muted-dash">—</span> : `${accuracy}%`}<small>{test.correct ?? '—'} correct · {test.wrong ?? '—'} wrong</small></td>
    <td data-label="Actions"><div className="table-actions"><button onClick={onView} aria-label={`View ${test.title}`}><Eye size={15} /></button><button onClick={onEdit} aria-label={`Edit ${test.title}`}>Edit</button><button onClick={onDelete} aria-label={`Delete ${test.title}`}><Trash2 size={15} /></button></div></td>
  </tr>
}

function TestDialog({ initial, presetChapterId, data, onClose, onSave }: { initial: TestRecord | null; presetChapterId?: string | null; data: ReturnType<typeof useData>['data']; onClose: () => void; onSave: (values: TestFormValues, stableId: string) => Promise<TestFieldErrors | null> }) {
  const { notify } = useToast()
  const [stableId] = useState(() => initial?.id ?? createId())
  const oldScores = initial ? data.testSubjectScores.filter(score => score.test_id === initial.id) : []
  const presetChapter = !initial && presetChapterId ? data.chapters.find(chapter => chapter.id === presetChapterId) ?? null : null
  const [values, setValues] = useState<TestFormValues>(() => {
    const base = blankValues()
    if (!initial) {
      // Opened from a chapter chip: the chapter (and its subject) arrive preselected.
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
    setErrors(current => { const next = { ...current }; delete next[String(key)]; delete next._form; return next })
  }
  const patchScore = (subject: Subject, key: 'marks' | 'total', value: string) => {
    setValues(prev => ({ ...prev, mockScores: { ...prev.mockScores, [subject]: { ...prev.mockScores[subject], [key]: value } } }))
    setErrors(current => { const next = { ...current }; delete next[`${subject}.${key}`]; delete next._form; return next })
  }
  const chapterOptions = data.chapters.filter(chapter => !values.subject || chapter.subject === values.subject)
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
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
  return <Dialog title={initial ? 'Edit test record' : 'Log a test'} subtitle="Record only what you know. Leave unknown values blank." onClose={onClose} className="test-dialog">
    <form className="form-stack" noValidate onSubmit={handleSubmit}>
      {errors._form && <div className="form-error" role="alert">{errors._form}</div>}
      <div className="form-grid two"><Field label="Test title" required error={errors.title} hint={values.title.length >= 120 ? `${values.title.length}/160 characters — long titles are trimmed with an ellipsis in lists` : undefined}><input autoFocus required maxLength={160} value={values.title} onChange={event => patch('title', event.target.value)} placeholder="e.g. Electrostatics weekly test" /></Field><Field label="Date" required error={errors.test_date}><input type="date" required value={values.test_date} onChange={event => patch('test_date', event.target.value)} /></Field></div>
      <div className="form-grid two"><Field label="Test type"><select value={values.test_type} onChange={event => patch('test_type', event.target.value as TestType)}>{TEST_TYPES.map(type => <option key={type}>{type}</option>)}</select></Field><Field label="Subject"><select value={values.subject} onChange={event => { patch('subject', event.target.value as Subject | ''); patch('chapter_id', '') }}><option value="">— choose subject —</option>{SUBJECTS.map(subject => <option key={subject}>{subject}</option>)}</select></Field></div>
      {presetChapter && <div className="preset-chapter-note" role="status"><BookOpen size={15} aria-hidden="true" /><span>Chapter preselected from Weak areas: <strong>{presetChapter.name}</strong><SubjectBadge subject={presetChapter.subject} /></span></div>}
      <Field label="Chapter (optional)" error={errors.chapter_id}><select value={values.chapter_id} onChange={event => patch('chapter_id', event.target.value)}><option value="">— choose chapter —</option>{chapterOptions.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}</select></Field>
      {values.test_type === 'Full Mock' ? <div className="mock-score-section"><div><span className="field-label">Subject scores <small>(enter each result that you have)</small></span><span className="field-hint">The overall result sums all three subjects. Each subject score is checked against its own total; leave unknown scores blank.</span></div><div className="mock-score-grid">{SUBJECTS.map(subject => {
        const marksError = errors[`${subject}.marks`]
        const totalError = errors[`${subject}.total`]
        const marksErrorId = `mock-${subject.toLowerCase()}-marks-error`
        const totalErrorId = `mock-${subject.toLowerCase()}-total-error`
        return <div className={`mock-score-entry mock-${subject.toLowerCase()} ${marksError || totalError ? 'has-error' : ''}`} key={subject}><SubjectBadge subject={subject} /><div><input type="number" min="0" max={subjectScoreMax(values.mockScores[subject].total)} step="0.5" aria-label={`${subject} marks`} aria-invalid={marksError ? 'true' : undefined} aria-describedby={marksError ? marksErrorId : undefined} placeholder="Marks" value={values.mockScores[subject].marks} onChange={event => patchScore(subject, 'marks', event.target.value)} /><span>/</span><input type="number" min="1" max={MAX_TOTAL_MARKS} step="1" aria-label={`${subject} total marks`} aria-invalid={totalError ? 'true' : undefined} aria-describedby={totalError ? totalErrorId : undefined} placeholder="Total" value={values.mockScores[subject].total} onChange={event => patchScore(subject, 'total', event.target.value)} /></div>{marksError && <span className="field-error mock-score-error" id={marksErrorId} role="alert">{marksError}</span>}{totalError && <span className="field-error mock-score-error" id={totalErrorId} role="alert">{totalError}</span>}</div>
      })}</div></div> : <div className="form-grid two"><Field label="Marks obtained" error={errors.marks}><input type="number" min="0" max={subjectScoreMax(values.total)} step="0.5" value={values.marks} onChange={event => patch('marks', event.target.value)} placeholder="Leave blank if unknown" /></Field><Field label="Total marks" error={errors.total}><input type="number" min="1" max={MAX_TOTAL_MARKS} step="1" value={values.total} onChange={event => patch('total', event.target.value)} placeholder="e.g. 120" /></Field></div>}
      <div className="form-grid three"><Field label="Correct" error={errors.correct}><input type="number" min="0" max={POSTGRES_INTEGER_MAX} step="1" value={values.correct} onChange={event => patch('correct', event.target.value)} placeholder="—" /></Field><Field label="Wrong" error={errors.wrong}><input type="number" min="0" max={POSTGRES_INTEGER_MAX} step="1" value={values.wrong} onChange={event => patch('wrong', event.target.value)} placeholder="—" /></Field><Field label="Skipped" error={errors.skipped}><input type="number" min="0" max={POSTGRES_INTEGER_MAX} step="1" value={values.skipped} onChange={event => patch('skipped', event.target.value)} placeholder="—" /></Field></div>
      <div className="form-grid two"><Field label="Negative marks" error={errors.negative_marks}><input type="number" min="0" max={MAX_NEGATIVE_MARKS} step="0.25" value={values.negative} onChange={event => patch('negative', event.target.value)} placeholder="No estimate" /></Field><Field label="Time taken (minutes)" error={errors.time_minutes}><input type="number" min="0" max={POSTGRES_INTEGER_MAX} step="1" value={values.time} onChange={event => patch('time', event.target.value)} placeholder="Optional" /></Field></div>
      <Field label="Notes" error={errors.notes}><textarea rows={3} maxLength={10_000} value={values.notes} onChange={event => patch('notes', event.target.value)} placeholder="What felt easy? What deserves another look?" /></Field>
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>{initial ? 'Save changes' : 'Save test'}</Button></div>
    </form>
  </Dialog>
}

function TestDetails({ test, onClose, onEdit }: { test: TestRecord; onClose: () => void; onEdit: () => void }) {
  const { data } = useData()
  const chapter = data.chapters.find(item => item.id === test.chapter_id)
  const scores = data.testSubjectScores.filter(score => score.test_id === test.id)
  const overallScore = getOverallTestScore(test, data.testSubjectScores)
  const overallPercentage = overallScore ? getOverallTestPercentage(test, data.testSubjectScores) : null
  const rawParentResult = test.marks_obtained !== null || test.total_marks !== null
  const parentScoreLabel = overallScore ? `${fmtNumber(overallScore.marks, 1)} / ${fmtNumber(overallScore.total, 1)}` : rawParentResult ? `${fmtNumber(test.marks_obtained, 1)} / ${fmtNumber(test.total_marks, 1)}` : 'Score not recorded'
  const parentResultMessage = rawParentResult ? 'Stored result is incomplete or outside the valid range. Review this record.' : 'No score percentage available.'
  const subjectRows = scores.length > 0 ? <div className="mock-detail-grid">{scores.map(score => <div key={score.id}><SubjectBadge subject={score.subject} /><strong>{score.marks_obtained == null ? '—' : `${fmtNumber(score.marks_obtained, 1)} / ${fmtNumber(score.total_marks, 1)}`}</strong>{score.marks_obtained !== null && score.total_marks !== null && <small>{subjectPercentageText(score.marks_obtained, score.total_marks)}</small>}</div>)}</div> : null
  return <Dialog title={test.title} subtitle={`${test.test_type} · ${prettyDate(test.test_date)}`} onClose={onClose}>
    <div className="test-detail-content"><div className="test-detail-badges">{test.test_type === 'Full Mock' ? <StatusBadge tone="muted">All subjects</StatusBadge> : <SubjectBadge subject={test.subject} />}<StatusBadge>{test.test_type}</StatusBadge>{chapter && <StatusBadge tone="muted">{chapter.name}</StatusBadge>}</div>
      {test.test_type === 'Full Mock' ? <><div className="detail-score-box"><strong>{overallScore ? parentScoreLabel : scores.length ? 'Overall result incomplete' : parentScoreLabel}</strong><span>{overallPercentage === null ? scores.length ? 'A comparable percentage needs valid marks and totals for all three subjects.' : parentResultMessage : `${Math.round(overallPercentage)}% of combined subject totals`}</span></div>{subjectRows}</> : subjectRows ?? <div className="detail-score-box"><strong>{parentScoreLabel}</strong><span>{overallPercentage === null ? parentResultMessage : `${Math.round(overallPercentage)}% of total marks`}</span></div>}
      <div className="test-detail-facts">{[['Correct', test.correct], ['Wrong', test.wrong], ['Skipped', test.skipped], ['Negative marks', test.negative_marks], ['Time taken', test.time_minutes == null ? null : `${test.time_minutes} min`]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value ?? '—'}</strong></div>)}</div>
      {test.notes && <div className="test-detail-notes"><span className="eyebrow">AFTER-TEST NOTES</span><p>{test.notes}</p></div>}
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={onEdit}>Edit record</Button></div>
    </div>
  </Dialog>
}

function subjectPercentageText(marks: number, total: number): string {
  const percentage = validPercentage(marks, total)
  return percentage === null ? 'Score outside valid range' : `${Math.round(percentage)}%`
}
