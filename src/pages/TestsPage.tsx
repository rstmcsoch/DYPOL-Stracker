import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownWideNarrow, ArrowUpWideNarrow, CalendarDays, ChartNoAxesCombined, Eye, Filter, ListFilter, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { Button, ConfirmDialog, Dialog, EmptyState, Field, NotebookCard, PageHeader, StatusBadge, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { testPercentage, subjectPercentage, getAccuracy, getAttemptRate } from '../lib/analytics'
import { fmtNumber } from '../lib/format'
import { prettyDate, indiaToday } from '../lib/date'
import { createId } from '../lib/id'
import { MAX_MARKS_OBTAINED, MAX_NEGATIVE_MARKS, MAX_TOTAL_MARKS, POSTGRES_INTEGER_MAX, nullableNumberInput, subjectScoreInputSchema, testFormSchema } from '../lib/test-validation'
import type { Subject, TestRecord, TestType, TestSubjectScore, TestChapterLink } from '../types'
import { SUBJECTS } from '../types'

const TEST_TYPES: TestType[] = ['Chapter Test', 'Subject Test', 'Full Mock', 'PYQ Practice']
type SortKey = 'date' | 'score' | 'title'
type TestFormValues = {
  title: string; test_date: string; test_type: TestType; subject: Subject | ''; chapter_id: string;
  marks: string; total: string; correct: string; wrong: string; skipped: string; negative: string; time: string; notes: string;
  mockScores: Record<Subject, { marks: string; total: string }>
}
const blankValues = (): TestFormValues => ({
  title: '', test_date: indiaToday(), test_type: 'Chapter Test', subject: '', chapter_id: '', marks: '', total: '',
  correct: '', wrong: '', skipped: '', negative: '', time: '', notes: '',
  mockScores: { Physics: { marks: '', total: '' }, Chemistry: { marks: '', total: '' }, Maths: { marks: '', total: '' } }
})

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
  const [viewing, setViewing] = useState<TestRecord | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TestRecord | null>(null)

  useEffect(() => {
    if (searchParams.get('add') === '1') {
      setCreating(true)
      const params = new URLSearchParams(searchParams)
      params.delete('add')
      setSearchParams(params, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const sortedTests = useMemo(() => {
    const term = search.trim().toLowerCase()
    return data.tests.filter(test => {
      if (term && !`${test.title} ${test.test_type} ${test.notes} ${test.subject ?? ''} ${data.chapters.find(ch => ch.id === test.chapter_id)?.name ?? ''}`.toLowerCase().includes(term)) return false
      if (typeFilter !== 'all' && test.test_type !== typeFilter) return false
      if (subjectFilter !== 'all' && test.subject !== subjectFilter && !data.testSubjectScores.some(score => score.test_id === test.id && score.subject === subjectFilter)) return false
      if (from && test.test_date < from) return false
      if (to && test.test_date > to) return false
      return true
    }).sort((a, b) => {
      let compared = 0
      if (sort === 'date') compared = a.test_date.localeCompare(b.test_date)
      else if (sort === 'title') compared = a.title.localeCompare(b.title)
      else compared = (testPercentage(a) ?? -1) - (testPercentage(b) ?? -1)
      return compared * (ascending ? 1 : -1)
    })
  }, [data, search, typeFilter, subjectFilter, from, to, sort, ascending])

  const accuracy = getAccuracy(data)
  const attempt = getAttemptRate(data)
  const average = sortedTests.map(testPercentage).filter((item): item is number => item !== null)
  const averageScore = average.length ? average.reduce((sum, value) => sum + value, 0) / average.length : null

  const saveTest = async (values: TestFormValues, current?: TestRecord) => {
    const parsed = testFormSchema.safeParse({
      title: values.title, test_date: values.test_date, test_type: values.test_type,
      marks_obtained: values.test_type === 'Full Mock' ? null : nullableNumberInput(values.marks),
      total_marks: values.test_type === 'Full Mock' ? null : nullableNumberInput(values.total),
      correct: nullableNumberInput(values.correct), wrong: nullableNumberInput(values.wrong), skipped: nullableNumberInput(values.skipped),
      negative_marks: nullableNumberInput(values.negative), time_minutes: nullableNumberInput(values.time), notes: values.notes.trim()
    })
    if (!parsed.success) { notify(parsed.error.issues[0]?.message ?? 'Check the test fields.', 'error'); return }

    const selectedChapter = values.chapter_id ? data.chapters.find(item => item.id === values.chapter_id) : null
    if (values.chapter_id && (!selectedChapter || (values.subject && selectedChapter.subject !== values.subject))) {
      notify('Choose a chapter that belongs to the selected subject.', 'error')
      return
    }

    const now = new Date().toISOString()
    const oldScores = current ? data.testSubjectScores.filter(score => score.test_id === current.id) : []
    const subjectScores: TestSubjectScore[] = []
    if (values.test_type === 'Full Mock') {
      for (const subject of SUBJECTS) {
        const part = values.mockScores[subject]
        const result = subjectScoreInputSchema.safeParse({
          marks_obtained: nullableNumberInput(part.marks), total_marks: nullableNumberInput(part.total)
        })
        if (!result.success) {
          notify(`${subject}: ${result.error.issues[0]?.message ?? 'Check the score and total.'}`, 'error')
          return
        }
        const { marks_obtained, total_marks } = result.data
        if (marks_obtained !== null || total_marks !== null) {
          const existing = oldScores.find(score => score.subject === subject)
          subjectScores.push({
            id: existing?.id ?? createId(), test_id: current?.id ?? '', subject, marks_obtained, total_marks,
            created_at: existing?.created_at ?? now, updated_at: now
          })
        }
      }
    }

    const completeMock = values.test_type === 'Full Mock' && SUBJECTS.every(subject => {
      const score = subjectScores.find(item => item.subject === subject)
      return score?.marks_obtained != null && score.total_marks != null
    })
    const hasAnyMockScore = subjectScores.length > 0 || oldScores.length > 0
    const retainLegacyMockScore = values.test_type === 'Full Mock' && current?.test_type === 'Full Mock' && !hasAnyMockScore
    const mockMarks = completeMock ? subjectScores.reduce((sum, score) => sum + (score.marks_obtained ?? 0), 0) : null
    const mockTotal = completeMock ? subjectScores.reduce((sum, score) => sum + (score.total_marks ?? 0), 0) : null
    if (completeMock && mockMarks !== null && mockTotal !== null && (mockMarks > MAX_MARKS_OBTAINED || mockTotal > MAX_TOTAL_MARKS)) {
      notify('Combined Full Mock marks exceed the supported total. Lower the subject totals before saving.', 'error')
      return
    }
    const test: TestRecord = {
      id: current?.id ?? createId(), title: parsed.data.title, test_date: parsed.data.test_date, test_type: parsed.data.test_type,
      subject: values.subject || selectedChapter?.subject || null, chapter_id: values.chapter_id || null,
      marks_obtained: completeMock ? mockMarks : retainLegacyMockScore ? current?.marks_obtained ?? null : parsed.data.marks_obtained,
      total_marks: completeMock ? mockTotal : retainLegacyMockScore ? current?.total_marks ?? null : parsed.data.total_marks,
      correct: parsed.data.correct, wrong: parsed.data.wrong, skipped: parsed.data.skipped,
      negative_marks: parsed.data.negative_marks, time_minutes: parsed.data.time_minutes, notes: parsed.data.notes,
      created_at: current?.created_at ?? now, updated_at: now
    }

    const oldLinks = current ? data.testChapterLinks.filter(link => link.test_id === current.id) : []
    const matchingLink = oldLinks.find(link => link.chapter_id === test.chapter_id)
    const chapterLink: TestChapterLink | null = test.chapter_id ? {
      id: matchingLink?.id ?? createId(), test_id: test.id, chapter_id: test.chapter_id,
      marks_obtained: test.marks_obtained, total_marks: test.total_marks,
      created_at: matchingLink?.created_at ?? now, updated_at: now
    } : null

    try {
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
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save test. Retry.', 'error') }
  }

  const deleteTest = async () => {
    if (!deleteTarget) return
    try { await remove('tests', deleteTarget); notify('Test deleted. Undo is available for a few seconds.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not delete test.', 'error') }
    setDeleteTarget(null)
  }

  const toggleSort = (key: SortKey) => {
    if (sort === key) setAscending(value => !value)
    else { setSort(key); setAscending(key === 'title') }
  }

  return <div className="content-page tests-page">
    <PageHeader eyebrow="PRACTICE, THEN NOTICE" title="Test history" subtitle="A score is one signal. The pattern is the useful part." doodle={<ChartNoAxesCombined size={20} />} action={<Button onClick={() => { setEditing(null); setCreating(true) }}><Plus size={17} /> Add test</Button>} />
    <div className="test-summary-grid"><NotebookCard className="test-summary-card"><span>TESTS LOGGED</span><strong>{data.tests.length}</strong><small>Across every practice type</small></NotebookCard><NotebookCard className="test-summary-card"><span>AVERAGE SCORE</span><strong>{averageScore === null ? '—' : `${Math.round(averageScore)}%`}</strong><small>From {average.length} usable result{average.length === 1 ? '' : 's'}</small></NotebookCard><NotebookCard className="test-summary-card"><span>ACCURACY</span><strong>{accuracy.rate === null ? '—' : `${Math.round(accuracy.rate)}%`}</strong><small>{accuracy.correct}/{accuracy.attempted || '—'} correct / attempted</small></NotebookCard><NotebookCard className="test-summary-card"><span>ATTEMPT RATE</span><strong>{attempt.rate === null ? '—' : `${Math.round(attempt.rate)}%`}</strong><small>{attempt.attempted}/{attempt.total || '—'} attempted / total</small></NotebookCard></div>
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
          <thead><tr><th><button onClick={() => toggleSort('date')} aria-label="Sort by date">DATE {sort === 'date' && (ascending ? <ArrowUpWideNarrow size={13} /> : <ArrowDownWideNarrow size={13} />)}</button></th><th><button onClick={() => toggleSort('title')} aria-label="Sort by test title">TEST {sort === 'title' && (ascending ? <ArrowUpWideNarrow size={13} /> : <ArrowDownWideNarrow size={13} />)}</button></th><th>TYPE / SUBJECT</th><th><button onClick={() => toggleSort('score')} aria-label="Sort by score">SCORE {sort === 'score' && (ascending ? <ArrowUpWideNarrow size={13} /> : <ArrowDownWideNarrow size={13} />)}</button></th><th>ACCURACY</th><th>ACTIONS</th></tr></thead>
          <tbody>{sortedTests.map(test => <TestRow key={test.id} test={test} onView={() => setViewing(test)} onEdit={() => { setEditing(test); setCreating(true) }} onDelete={() => setDeleteTarget(test)} />)}</tbody>
        </table>}
      </div>
      <div className="test-board-footer"><span><Filter size={14} /> Scores compare percentages, not raw marks.</span><button onClick={() => navigate('/backup')}>Export options are in Backup <ArrowRightIcon /></button></div>
    </NotebookCard>
    {creating && <TestDialog key={editing?.id ?? 'new-test'} initial={editing} data={data} onClose={() => { setCreating(false); setEditing(null) }} onSave={values => saveTest(values, editing ?? undefined)} />}
    {viewing && <TestDetails test={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); setCreating(true) }} />}
    {deleteTarget && <ConfirmDialog title="Delete this test?" message={`“${deleteTarget.title}” will be removed from test history and related scores. You can undo for a few seconds.`} onCancel={() => setDeleteTarget(null)} onConfirm={() => void deleteTest()} />}
  </div>
}

function ArrowRightIcon() { return <span aria-hidden="true">↗</span> }

function TestRow({ test, onView, onEdit, onDelete }: { test: TestRecord; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  const { data } = useData()
  const score = testPercentage(test)
  const accuracy = test.correct != null && test.wrong != null && test.correct + test.wrong > 0 ? Math.round(test.correct / (test.correct + test.wrong) * 100) : null
  const chapter = data.chapters.find(item => item.id === test.chapter_id)
  return <tr>
    <td data-label="Date"><span className="test-date-cell">{prettyDate(test.test_date, { day: 'numeric', month: 'short', year: '2-digit' })}</span></td>
    <td data-label="Test"><button className="test-title-button" onClick={onView}><strong>{test.title}</strong><span>{(chapter?.name ?? test.notes) || 'Open test details'}</span></button></td>
    <td data-label="Type / subject"><span className="test-type-label">{test.test_type}</span><SubjectBadge subject={test.subject} /></td>
    <td data-label="Score"><div className="score-cell"><strong>{test.marks_obtained == null ? '—' : `${fmtNumber(test.marks_obtained, 1)} / ${fmtNumber(test.total_marks, 1)}`}</strong>{score !== null && <StatusBadge tone={score < data.settings.weak_threshold ? 'Weak' : score <= data.settings.strong_threshold ? 'Okay' : 'Strong'}>{Math.round(score)}%</StatusBadge>}</div></td>
    <td data-label="Accuracy">{accuracy === null ? <span className="muted-dash">—</span> : `${accuracy}%`}<small>{test.correct ?? '—'} correct · {test.wrong ?? '—'} wrong</small></td>
    <td data-label="Actions"><div className="table-actions"><button onClick={onView} aria-label={`View ${test.title}`}><Eye size={15} /></button><button onClick={onEdit} aria-label={`Edit ${test.title}`}>Edit</button><button onClick={onDelete} aria-label={`Delete ${test.title}`}><Trash2 size={15} /></button></div></td>
  </tr>
}

function TestDialog({ initial, data, onClose, onSave }: { initial: TestRecord | null; data: ReturnType<typeof useData>['data']; onClose: () => void; onSave: (values: TestFormValues) => Promise<void> }) {
  const oldScores = initial ? data.testSubjectScores.filter(score => score.test_id === initial.id) : []
  const [values, setValues] = useState<TestFormValues>(() => {
    const base = blankValues()
    if (!initial) return base
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
  const patch = <K extends keyof TestFormValues>(key: K, value: TestFormValues[K]) => setValues(prev => ({ ...prev, [key]: value }))
  const patchScore = (subject: Subject, key: 'marks' | 'total', value: string) => setValues(prev => ({ ...prev, mockScores: { ...prev.mockScores, [subject]: { ...prev.mockScores[subject], [key]: value } } }))
  const chapterOptions = data.chapters.filter(chapter => !values.subject || chapter.subject === values.subject)
  const handleSubmit = async (event: FormEvent) => { event.preventDefault(); if (saving) return; setSaving(true); try { await onSave(values) } finally { setSaving(false) } }
  return <Dialog title={initial ? 'Edit test record' : 'Log a test'} subtitle="Record only what you know. Leave unknown values blank." onClose={onClose} className="test-dialog">
    <form className="form-stack" onSubmit={handleSubmit}>
      <div className="form-grid two"><Field label="Test title" required><input autoFocus required maxLength={160} value={values.title} onChange={event => patch('title', event.target.value)} placeholder="e.g. Electrostatics weekly test" /></Field><Field label="Date" required><input type="date" required value={values.test_date} onChange={event => patch('test_date', event.target.value)} /></Field></div>
      <div className="form-grid two"><Field label="Test type"><select value={values.test_type} onChange={event => patch('test_type', event.target.value as TestType)}>{TEST_TYPES.map(type => <option key={type}>{type}</option>)}</select></Field><Field label="Subject"><select value={values.subject} onChange={event => { patch('subject', event.target.value as Subject | ''); patch('chapter_id', '') }}><option value="">— choose subject —</option>{SUBJECTS.map(subject => <option key={subject}>{subject}</option>)}</select></Field></div>
      <Field label="Chapter (optional)"><select value={values.chapter_id} onChange={event => patch('chapter_id', event.target.value)}><option value="">— choose chapter —</option>{chapterOptions.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}</select></Field>
      {values.test_type === 'Full Mock' ? <div className="mock-score-section"><span className="field-label">Subject scores <small>(enter each result that you have)</small></span><div className="mock-score-grid">{SUBJECTS.map(subject => <div className={`mock-score-entry mock-${subject.toLowerCase()}`} key={subject}><SubjectBadge subject={subject} /><div><input type="number" min="0" max={values.mockScores[subject].total ? Math.min(MAX_MARKS_OBTAINED, Number(values.mockScores[subject].total) * 2) : MAX_MARKS_OBTAINED} step="0.5" aria-label={`${subject} marks`} placeholder="Marks" value={values.mockScores[subject].marks} onChange={event => patchScore(subject, 'marks', event.target.value)} /><span>/</span><input type="number" min="1" max={MAX_TOTAL_MARKS} step="1" aria-label={`${subject} total marks`} placeholder="Total" value={values.mockScores[subject].total} onChange={event => patchScore(subject, 'total', event.target.value)} /></div></div>)}</div></div> : <div className="form-grid two"><Field label="Marks obtained"><input type="number" min="0" max={values.total ? Math.min(MAX_MARKS_OBTAINED, Number(values.total) * 2) : MAX_MARKS_OBTAINED} step="0.5" value={values.marks} onChange={event => patch('marks', event.target.value)} placeholder="Leave blank if unknown" /></Field><Field label="Total marks"><input type="number" min="1" max={MAX_TOTAL_MARKS} step="1" value={values.total} onChange={event => patch('total', event.target.value)} placeholder="e.g. 120" /></Field></div>}
      <div className="form-grid three"><Field label="Correct"><input type="number" min="0" max={POSTGRES_INTEGER_MAX} step="1" value={values.correct} onChange={event => patch('correct', event.target.value)} placeholder="—" /></Field><Field label="Wrong"><input type="number" min="0" max={POSTGRES_INTEGER_MAX} step="1" value={values.wrong} onChange={event => patch('wrong', event.target.value)} placeholder="—" /></Field><Field label="Skipped"><input type="number" min="0" max={POSTGRES_INTEGER_MAX} step="1" value={values.skipped} onChange={event => patch('skipped', event.target.value)} placeholder="—" /></Field></div>
      <div className="form-grid two"><Field label="Negative marks"><input type="number" min="0" max={MAX_NEGATIVE_MARKS} step="0.25" value={values.negative} onChange={event => patch('negative', event.target.value)} placeholder="No estimate" /></Field><Field label="Time taken (minutes)"><input type="number" min="0" max={POSTGRES_INTEGER_MAX} step="1" value={values.time} onChange={event => patch('time', event.target.value)} placeholder="Optional" /></Field></div>
      <Field label="Notes"><textarea rows={3} maxLength={10000} value={values.notes} onChange={event => patch('notes', event.target.value)} placeholder="What felt easy? What deserves another look?" /></Field>
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>{initial ? 'Save changes' : 'Save test'}</Button></div>
    </form>
  </Dialog>
}

function TestDetails({ test, onClose, onEdit }: { test: TestRecord; onClose: () => void; onEdit: () => void }) {
  const { data } = useData()
  const chapter = data.chapters.find(item => item.id === test.chapter_id)
  const scores = data.testSubjectScores.filter(score => score.test_id === test.id)
  return <Dialog title={test.title} subtitle={`${test.test_type} · ${prettyDate(test.test_date)}`} onClose={onClose}>
    <div className="test-detail-content"><div className="test-detail-badges"><SubjectBadge subject={test.subject} /><StatusBadge>{test.test_type}</StatusBadge>{chapter && <StatusBadge tone="muted">{chapter.name}</StatusBadge>}</div>
      {scores.length > 0 ? <div className="mock-detail-grid">{scores.map(score => <div key={score.id}><SubjectBadge subject={score.subject} /><strong>{score.marks_obtained == null ? '—' : `${fmtNumber(score.marks_obtained, 1)} / ${fmtNumber(score.total_marks, 1)}`}</strong>{subjectPercentage(score) !== null && <small>{Math.round(subjectPercentage(score) ?? 0)}%</small>}</div>)}</div> : <div className="detail-score-box"><strong>{test.marks_obtained == null ? 'Score not recorded' : `${fmtNumber(test.marks_obtained, 1)} / ${fmtNumber(test.total_marks, 1)}`}</strong><span>{testPercentage(test) == null ? 'No score percentage available' : `${Math.round(testPercentage(test) ?? 0)}% of total marks`}</span></div>}
      <div className="test-detail-facts">{[['Correct', test.correct], ['Wrong', test.wrong], ['Skipped', test.skipped], ['Negative marks', test.negative_marks], ['Time taken', test.time_minutes == null ? null : `${test.time_minutes} min`]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value ?? '—'}</strong></div>)}</div>
      {test.notes && <div className="test-detail-notes"><span className="eyebrow">AFTER-TEST NOTES</span><p>{test.notes}</p></div>}
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={onEdit}>Edit record</Button></div>
    </div>
  </Dialog>
}
