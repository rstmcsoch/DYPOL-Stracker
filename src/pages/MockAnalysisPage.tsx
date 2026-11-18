import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check, Clock3, Edit3, Lightbulb, NotebookPen, Plus, Trash2 } from 'lucide-react'
import { Button, Dialog, EmptyState, Field, NotebookCard, OverflowMenu, PageHeader, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui'
import { Meter, Pct, minutesLabel, wholeNumber } from '../components/jee/shared'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { createId, stableId } from '../lib/id'
import { prettyDate } from '../lib/date'
import { categoryTotals, chapterRepeatOffenders, checkLostMarks, fixFirstList, mockInsights, mockSummary, percentileBand, subjectDeltas, subjectTimeRows } from '../lib/jee/mock-analysis'
import { causeTotals, typeForCause } from '../lib/mistake-cause'
import { validateErrorLog, type ErrorLogFormInput, type ErrorLogValue } from '../lib/jee/forms'
import { ERROR_CATEGORIES, type AppData, type ErrorCategory, type Mistake, type Subject, type TestErrorLog, type TestRecord, type TestTimeEntry } from '../types'
import { useExamSubjects } from '../lib/exams/useExamSubjects'
import { T } from '../lib/student-layout/T'
import { usePageSlots } from '../lib/student-layout/use-layout'

export default function MockAnalysisPage() {
  const sl = usePageSlots('mock-analysis')
  const { data, upsert, upsertMany, remove } = useData()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tests = useMemo(() => [...data.tests].sort((a, b) => b.test_date.localeCompare(a.test_date)), [data.tests])
  const [selectedId, setSelectedId] = useState(params.get('test') ?? tests[0]?.id ?? '')
  const [classifying, setClassifying] = useState<TestErrorLog | 'new' | null>(null)
  const [timing, setTiming] = useState(false)
  const selected = tests.find(test => test.id === selectedId) ?? tests[0] ?? null
  const choose = (id: string) => { setSelectedId(id); setParams({ test: id }, { replace: true }) }

  if (!selected) return <div className="content-page mock-analysis-page">
    <PageHeader title="Mock analysis" subtitle="Record a test first." />
    <NotebookCard><EmptyState lk="mock-analysis:no-tests-to-analyse-yet" title="No tests to analyse yet." action={<Button variant="secondary" size="sm" onClick={() => navigate('/tests?add=1')}><T k="mock-analysis:log-a-test">{"Log a test"}</T></Button>} /></NotebookCard>
  </div>

  const logs = data.testErrorLogs.filter(log => log.test_id === selected.id).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const times = subjectTimeRows(selected, data)
  const summary = mockSummary(selected, data)
  const totals = categoryTotals(logs)
  const insights = mockInsights(selected, data)
  const band = percentileBand(data, selected)
  const hasRecordedTime = data.testTimeEntries.some(entry => entry.test_id === selected.id)
  // Same causes as the mistake notebook, so a slip is counted once whichever page saw it.
  const causes = causeTotals(data.mistakes, data.testErrorLogs)
  const deltas = subjectDeltas(selected, data)
  const fixes = fixFirstList(selected, data)
  const repeatChapters = chapterRepeatOffenders(data).slice(0, 5)
  const canTurnIntoMistake = (log: TestErrorLog) => Boolean(log.chapter_id ?? data.chapters.find(chapter => chapter.subject === log.subject)?.id)

  const turnIntoMistake = async (log: TestErrorLog) => {
    const chapterId = log.chapter_id ?? data.chapters.find(chapter => chapter.subject === log.subject)?.id ?? ''
    if (!chapterId) { notify('Add a chapter for this subject in Syllabus, then try again.', 'error'); return }
    const now = new Date().toISOString()
    const record: Mistake = {
      id: createId(), chapter_id: chapterId, test_id: selected.id, cause: log.category, mistake_type: typeForCause(log.category),
      question_note: log.note.trim() || `${log.category} in ${selected.title}${log.questions ? ` · ${log.questions} question${log.questions === 1 ? '' : 's'}` : ''}`,
      solution_note: '', image_path: null, retry_later: true, retry_status: 'pending',
      created_at: now, updated_at: now
    }
    try { await upsert('mistakes', record); notify('Saved to your mistake notebook, ready to retry.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save the mistake note.', 'error') }
  }

  const removeLog = async (log: TestErrorLog) => {
    try { await remove('test_error_logs', log); notify('Classification removed.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not remove this classification.', 'error') }
  }

  return <div className="content-page mock-analysis-page">
    <PageHeader layoutId="mock-analysis.header"
      title="Mock analysis"
      subtitle="Where you lost marks, and why."
    />

    <NotebookCard {...sl.attrs('filters')} className="jee-filter-card">
      <label className="jee-select"><span><T k="mock-analysis:test">{"Test"}</T></span>
        <select value={selected.id} onChange={event => choose(event.target.value)}>
          {tests.map(test => <option key={test.id} value={test.id}>{prettyDate(test.test_date)} · {test.title} · {test.test_type}</option>)}
        </select>
      </label>
      <div className="jee-test-summary">
        <div><span><T k="mock-analysis:recorded-score">{"Recorded score"}</T></span><strong>{summary.score === null ? '—' : <Pct value={summary.score} digits={1} />}</strong></div>
        <div><span><T k="mock-analysis:type">{"Type"}</T></span><strong>{selected.test_type}</strong></div>
        <div><span><T k="mock-analysis:lost-marks-tagged">{"Lost marks tagged"}</T></span><strong>{summary.taggedMarks ?? '—'}</strong></div>
        <div><span><T k="mock-analysis:questions-tagged">{"Questions tagged"}</T></span><strong>{summary.taggedQuestions || '—'}</strong></div>
      </div>
    </NotebookCard>

    <section {...sl.attrs('analysis')} className="jee-analysis-grid">
      <div className="jee-analysis-col">
        <SectionHeading title="Change since last mock" note={deltas[0]?.previousTitle ? `Compared with ${deltas[0].previousTitle}.` : 'Needs an earlier mock of the same type.'} />
        <NotebookCard className="mock-deltas">
          {deltas.length === 0 ? <p className="jee-pad jee-muted">No subject results recorded for this test yet.</p> : <div className="mock-delta-grid">{deltas.map(row => <div key={row.subject} className="mock-delta-row">
            <span><SubjectBadge subject={row.subject as Subject} /></span>
            <strong>{row.current === null ? '—' : `${Math.round(row.current)}%`}</strong>
            <span className={row.delta === null ? 'jee-muted' : row.delta > 0 ? 'jee-up' : row.delta < 0 ? 'jee-down' : 'jee-muted'}>
              {row.delta === null ? 'no earlier score' : `${row.delta > 0 ? '+' : ''}${Math.round(row.delta)} pts`}
            </span>
          </div>)}</div>}
        </NotebookCard>

        {repeatChapters.length > 0 && <>
          <SectionHeading title="Repeat offenders" note="Chapters flagged in two or more of your last five tests." />
          <NotebookCard className="mock-repeat"><ul>{repeatChapters.map(item => <li key={item.chapterId}>
            <SubjectBadge subject={item.subject} />
            <strong>{item.chapterName}</strong>
            <span className="jee-muted">{item.mocks} of last 5 tests{item.questions ? ` · ${item.questions} questions` : ''}</span>
            <button type="button" className="text-link" onClick={() => navigate(`/practice?chapter=${item.chapterId}`)}>Practise</button>
          </li>)}</ul></NotebookCard>
        </>}

        <SectionHeading title="Recorded time & attempts" note="Only what you entered." action={<Button variant="secondary" size="sm" onClick={() => setTiming(true)}><Clock3 size={15} /> {hasRecordedTime ? 'Edit' : 'Add'} time</Button>} />
        <NotebookCard>
          {times.length === 0 ? <div className="jee-pad"><p className="jee-muted"><T k="mock-analysis:no-time-or-attempt-data-recorded-for-thi">{"No timing data recorded for this test."}</T></p></div> : <div className="jee-subject-time-list">
            {times.map(row => <div key={row.subject} className="jee-subject-time">
              <SubjectBadge subject={row.subject} />
              <div className="jee-row-numbers">
                <span><T k="mock-analysis:l-time">{"Time"}</T>{' '}<b>{row.minutes === null ? '—' : minutesLabel(row.minutes)}</b></span>
                <span><T k="mock-analysis:attempted">{"Attempted"}</T>{' '}<b>{row.attempted ?? '—'}</b></span>
                <span><T k="mock-analysis:unattempted">{"Unattempted"}</T>{' '}<b>{row.unattempted ?? '—'}</b></span>
                <span><T k="mock-analysis:l-marks">{"Marks"}</T>{' '}<b>{row.marks ?? '—'}{row.total ? `/${row.total}` : ''}</b></span>
              </div>
              {row.marksPerMinute !== null && <p className="jee-small jee-muted">{row.marksPerMinute.toFixed(2)} marks per minute spent</p>}
            </div>)}
          </div>}
        </NotebookCard>

        <SectionHeading title="Lost marks, classified" note="Tag why marks were lost." action={<Button size="sm" onClick={() => setClassifying('new')}><Plus size={15} />{' '}<T k="mock-analysis:classify">{"Classify"}</T></Button>} />
        <NotebookCard>
          {logs.length === 0 ? <div className="jee-pad"><p className="jee-muted"><T k="mock-analysis:no-classifications-yet">{"No classifications yet."}</T></p></div> : <ul className="jee-log-list">
            {logs.map(log => <li key={log.id} className="jee-log-row">
              <div>
                <strong>{log.category}</strong>
                <div className="jee-row-meta">{log.subject && <SubjectBadge subject={log.subject} />}{log.marks_lost !== null && <span>{log.marks_lost} marks</span>}{log.questions !== null && <span>{log.questions} question{log.questions === 1 ? '' : 's'}</span>}</div>
                {log.note && <p className="jee-note">{log.note}</p>}
              </div>
              <OverflowMenu label={`Actions for ${log.category}`} items={[
                ...(canTurnIntoMistake(log) ? [{ id: 'mistake', label: 'Turn into a mistake note', icon: <NotebookPen size={15} />, onSelect: () => void turnIntoMistake(log) }] : []),
                { id: 'edit', label: 'Edit', icon: <Edit3 size={15} />, onSelect: () => setClassifying(log) },
                { id: 'delete', label: 'Delete', icon: <Trash2 size={15} />, danger: true, onSelect: () => void removeLog(log) }
              ]} />
            </li>)}
          </ul>}
        </NotebookCard>
      </div>

      <div className="jee-analysis-col">
        <SectionHeading title="Where the marks went" note="Your classifications, summed." />
        <NotebookCard>
          {totals.length === 0 ? <p className="jee-muted jee-pad"><T k="mock-analysis:classify-some-lost-marks-to-see-the-brea">{"Classify lost marks to see the breakdown."}</T></p> : <div className="jee-category-bars">
            {totals.map(total => {
              const max = Math.max(...totals.map(item => item.marksLost ?? item.entries))
              const value = total.marksLost ?? total.entries
              return <div key={total.category} className="jee-category-bar">
                <div><span>{total.category}</span><b>{total.marksLost !== null ? `${total.marksLost} marks` : `${total.entries} tag${total.entries === 1 ? '' : 's'}`}</b></div>
                <Meter value={max ? (value / max) * 100 : 0} label={`${total.category} share`} tone="orange" />
              </div>
            })}
          </div>}
        </NotebookCard>

        <SectionHeading title="Causes across your notebook" note="Mistake notes and mock tags, counted the same way." />
        <NotebookCard>
          {causes.length === 0 ? <p className="jee-muted jee-pad">Tag a lost mark or save a mistake to see causes.</p> : <div className="jee-category-bars">
            {causes.map(row => <div key={row.cause} className="jee-category-bar">
              <div><span>{row.cause}</span><b>{row.total} · {row.mistakes} notes, {row.logs} tags</b></div>
              <Meter value={(row.total / causes[0]!.total) * 100} label={`${row.cause} share`} tone="orange" />
            </div>)}
          </div>}
        </NotebookCard>

        <SectionHeading title="What to fix first" note="Ordered by marks recoverable, not by count." />
        {fixes.length > 0 && <NotebookCard className="mock-fix-first">
          <ol>{fixes.slice(0, 5).map((item, index) => <li key={`${item.label}-${index}`}>
            <span className="mock-fix-rank">{index + 1}</span>
            <div><strong>{item.label}</strong><small>{item.reason}</small></div>
            <button type="button" className="text-link" onClick={() => navigate(item.to)}>Open <ArrowRight size={13} /></button>
          </li>)}</ol>
        </NotebookCard>}

        <SectionHeading title="Fix before your next mock" note="Each line shows its basis." />
        <SectionHeading title="Where this score sits" note="A band, not a promise." />
        <NotebookCard className="mock-percentile">
          <div className="mock-percentile-head">
            <strong>{band.percentile === null ? '—' : band.percentile.toFixed(1)}<small> %ile</small></strong>
            <div>
              <span className="jee-tag">{band.label}</span>
              <p className="jee-muted">{band.note}</p>
            </div>
          </div>
          {band.position !== null && <>
            <div className="mock-percentile-track" role="img" aria-label={`Percentile ${band.percentile?.toFixed(1)} on a 0 to 100 scale`}>
              <span style={{ width: `${band.position}%` }} />
            </div>
            <div className="mock-percentile-scale" aria-hidden="true"><span>0</span><span>50</span><span>90</span><span>100</span></div>
          </>}
        </NotebookCard>

        <NotebookCard className="jee-insights">
          {insights.length === 0 ? <div className="jee-pad"><Lightbulb size={18} aria-hidden="true" /><p className="jee-muted"><T k="mock-analysis:not-enough-data-yet">{"Not enough data yet."}</T></p></div> : <ul>
            {insights.map((insight, index) => <li key={index}>
              <StatusBadge tone={insight.kind === 'recorded' ? 'Strong' : insight.kind === 'classified' ? 'Okay' : 'muted'}>{insight.kind === 'recorded' ? 'Recorded' : insight.kind === 'classified' ? 'You classified' : 'Derived'}</StatusBadge>
              <span>{insight.text}</span>
            </li>)}
          </ul>}
        </NotebookCard>
        <Button variant="quiet" size="sm" onClick={() => navigate('/weak-areas')}><T k="mock-analysis:see-weak-areas">{"See weak areas →"}</T></Button>
      </div>
    </section>

    {classifying && <ClassifyDialog data={data} test={selected} existing={classifying === 'new' ? undefined : classifying} onClose={() => setClassifying(null)} onSave={async value => {
      const now = new Date().toISOString()
      const existing = classifying === 'new' ? undefined : classifying
      await upsert('test_error_logs', {
        id: existing?.id ?? createId(), ...value, chapter_id: null,
        created_at: existing?.created_at ?? now, updated_at: now
      })
      notify('Classification saved.')
    }} />}
    {timing && <TimeDialog data={data} test={selected} onClose={() => setTiming(false)} onSave={async entries => {
      await upsertMany('test_time_entries', entries)
      notify('Time and attempts saved for this test.')
    }} />}
  </div>
}

function ClassifyDialog({ data, test, existing, onClose, onSave }: {
  data: AppData; test: TestRecord; existing?: TestErrorLog; onClose: () => void; onSave: (value: ErrorLogValue) => Promise<void>
}) {
  const classifySubjects = useExamSubjects(existing?.subject)
  const [form, setForm] = useState<ErrorLogFormInput>({
    testId: test.id, subject: existing?.subject ?? '', category: existing?.category ?? 'Silly mistake',
    marksLost: existing?.marks_lost != null ? String(existing.marks_lost) : '', questions: existing?.questions != null ? String(existing.questions) : '',
    note: existing?.note ?? ''
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const { notify } = useToast()
  const set = <K extends keyof ErrorLogFormInput>(key: K, value: ErrorLogFormInput[K]) => {
    setForm(current => ({ ...current, [key]: value }))
    setErrors(current => { const next = { ...current }; delete next[key]; return next })
  }
  const lostRemaining = checkLostMarks(test, data, form.subject || null, Number.MAX_SAFE_INTEGER, existing?.id).remaining
  const typedLost = form.marksLost.trim() === '' ? null : Number(form.marksLost)
  const liveLostError = typedLost !== null && Number.isFinite(typedLost) ? checkLostMarks(test, data, form.subject || null, typedLost, existing?.id).message : null
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    const result = validateErrorLog(form)
    if (!result.ok) { setErrors(result.errors); notify('Check the highlighted fields.', 'error'); return }
    const budget = checkLostMarks(test, data, result.value.subject, result.value.marks_lost, existing?.id)
    if (!budget.ok) { setErrors({ marksLost: budget.message ?? 'Marks lost cannot exceed the marks actually lost.' }); notify('Check the highlighted fields.', 'error'); return }
    setSaving(true)
    try { await onSave(result.value); onClose() }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save the classification.', 'error') }
    finally { setSaving(false) }
  }
  return <Dialog title={existing ? 'Edit classification' : 'Classify lost marks'} onClose={onClose} className="jee-dialog">
    <form className="form-stack" noValidate onSubmit={submit}>
      <div className="form-grid two">
        <Field lk="mock-analysis:subject" label="Subject"><select value={form.subject} onChange={event => set('subject', event.target.value as Subject | '')}><option value="">Not specified</option>{classifySubjects.map(subject => <option key={subject}>{subject}</option>)}</select></Field>
        <Field lk="mock-analysis:why-did-it-happen" label="Why did it happen?" error={errors.category} required><select value={form.category} onChange={event => set('category', event.target.value as ErrorCategory)}>{ERROR_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></Field>
      </div>
      <div className="form-grid two">
        <Field lk="mock-analysis:questions" label="Questions" error={errors.questions}><input inputMode="numeric" value={form.questions} onChange={event => set('questions', event.target.value)} placeholder="4" /></Field>
        <Field lk="mock-analysis:marks-lost" label="Marks lost" error={errors.marksLost ?? liveLostError ?? undefined} hint={lostRemaining !== null ? `${lostRemaining} mark${lostRemaining === 1 ? '' : 's'} left to classify${form.subject ? ` in ${form.subject}` : ''}.` : undefined}><input inputMode="decimal" value={form.marksLost} onChange={event => set('marksLost', event.target.value)} placeholder="16" /></Field>
      </div>
      <Field lk="mock-analysis:note-optional" label="Note (optional)" error={errors.note}><textarea rows={2} maxLength={5000} value={form.note} onChange={event => set('note', event.target.value)} placeholder="e.g. sign error in Q12 after long substitution" /></Field>
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}><T k="mock-analysis:cancel">{"Cancel"}</T></Button><Button type="submit" loading={saving}>{existing ? 'Save' : 'Add classification'} <Check size={16} /></Button></div>
    </form>
  </Dialog>
}

function TimeDialog({ data, test, onClose, onSave }: { data: AppData; test: TestRecord; onClose: () => void; onSave: (entries: TestTimeEntry[]) => Promise<void> }) {
  const timeSubjects = useExamSubjects()
  const existing = data.testTimeEntries.filter(entry => entry.test_id === test.id)
  const [rows, setRows] = useState(() => [...new Set([...timeSubjects, ...existing.map(entry => entry.subject).filter((subject): subject is string => Boolean(subject))])].map(subject => {
    const row = existing.find(entry => entry.subject === subject)
    return { subject, minutes: row?.minutes != null ? String(row.minutes) : '', attempted: row?.attempted != null ? String(row.attempted) : '', unattempted: row?.unattempted != null ? String(row.unattempted) : '' }
  }))
  const [errors, setErrors] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { notify } = useToast()
  const update = (subject: Subject, key: 'minutes' | 'attempted' | 'unattempted', value: string) => setRows(current => current.map(row => row.subject === subject ? { ...row, [key]: value } : row))
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
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
        setErrors(`Use whole numbers for ${row.subject}: minutes 0–1440, and counts 0 or more.`)
        return
      }
      entries.push({
        id: stableId(`${test.id}:time:${row.subject}`), test_id: test.id, subject: row.subject, label: '',
        minutes, attempted, unattempted, order_index: index,
        created_at: existing.find(entry => entry.subject === row.subject)?.created_at ?? now, updated_at: now
      })
    }
    setSaving(true)
    try { await onSave(entries); onClose() }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save time data.', 'error') }
    finally { setSaving(false) }
  }
  return <Dialog lk="mock-analysis:time-attempts-by-subject" lk2="mock-analysis:leave-unknown-fields-blank" title="Time & attempts by subject" subtitle="Leave unknown fields blank." onClose={onClose} className="jee-dialog">
    <form className="form-stack" noValidate onSubmit={submit}>
      {rows.map(row => <fieldset key={row.subject} className="jee-fieldset"><legend><SubjectBadge subject={row.subject} /></legend>
        <div className="form-grid three">
          <Field lk="mock-analysis:l-minutes" label="Minutes"><input inputMode="numeric" value={row.minutes} onChange={event => update(row.subject, 'minutes', event.target.value)} /></Field>
          <Field lk="mock-analysis:attempted" label="Attempted"><input inputMode="numeric" value={row.attempted} onChange={event => update(row.subject, 'attempted', event.target.value)} /></Field>
          <Field lk="mock-analysis:unattempted" label="Unattempted"><input inputMode="numeric" value={row.unattempted} onChange={event => update(row.subject, 'unattempted', event.target.value)} /></Field>
        </div>
      </fieldset>)}
      {errors && <p className="field-error" role="alert">{errors}</p>}
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}><T k="mock-analysis:cancel">{"Cancel"}</T></Button><Button type="submit" loading={saving}><T k="mock-analysis:save-time-data">{"Save time data"}</T>{' '}<Check size={16} /></Button></div>
    </form>
  </Dialog>
}
