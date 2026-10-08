import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Clock3, Edit3, Lightbulb, Plus, Trash2 } from 'lucide-react'
import { Button, Dialog, EmptyState, Field, NotebookCard, OverflowMenu, PageHeader, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui'
import { Meter, Pct, minutesLabel, wholeNumber } from '../components/jee/shared'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { createId, stableId } from '../lib/id'
import { prettyDate } from '../lib/date'
import { categoryTotals, mockInsights, mockSummary, subjectTimeRows } from '../lib/jee/mock-analysis'
import { validateErrorLog, type ErrorLogFormInput, type ErrorLogValue } from '../lib/jee/forms'
import { ERROR_CATEGORIES, SUBJECTS, type AppData, type ErrorCategory, type Subject, type TestErrorLog, type TestRecord, type TestTimeEntry } from '../types'

export default function MockAnalysisPage() {
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
    <PageHeader eyebrow="WHY DID I LOSE MARKS?" title="Mock analysis" subtitle="Record a test first, then come back to classify what went wrong." />
    <NotebookCard><EmptyState title="No tests to analyse yet." description="Log a mock or a subject test with its marks. Then you can add time per subject and tag lost marks." action={<Button variant="secondary" size="sm" onClick={() => navigate('/tests?add=1')}>Log a test</Button>} /></NotebookCard>
  </div>

  const logs = data.testErrorLogs.filter(log => log.test_id === selected.id).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const times = subjectTimeRows(selected, data)
  const summary = mockSummary(selected, data)
  const totals = categoryTotals(logs)
  const insights = mockInsights(selected, data)
  const hasRecordedTime = data.testTimeEntries.some(entry => entry.test_id === selected.id)

  const removeLog = async (log: TestErrorLog) => {
    try { await remove('test_error_logs', log); notify('Classification removed. Undo is available briefly.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not remove this classification.', 'error') }
  }

  return <div className="content-page mock-analysis-page">
    <PageHeader
      eyebrow="WHAT SHOULD I FIX BEFORE THE NEXT MOCK?"
      title="Mock analysis"
      subtitle="Recorded numbers, your own classifications, and derived insights are kept separate, so every claim shows its basis."
    />

    <NotebookCard className="jee-filter-card">
      <label className="jee-select"><span>Test</span>
        <select value={selected.id} onChange={event => choose(event.target.value)}>
          {tests.map(test => <option key={test.id} value={test.id}>{prettyDate(test.test_date)} · {test.title} · {test.test_type}</option>)}
        </select>
      </label>
      <div className="jee-test-summary">
        <div><span>Recorded score</span><strong>{summary.score === null ? '—' : <Pct value={summary.score} digits={1} />}</strong></div>
        <div><span>Type</span><strong>{selected.test_type}</strong></div>
        <div><span>Lost marks tagged</span><strong>{summary.taggedMarks ?? '—'}</strong></div>
        <div><span>Questions tagged</span><strong>{summary.taggedQuestions || '—'}</strong></div>
      </div>
    </NotebookCard>

    <section className="jee-analysis-grid">
      <div className="jee-analysis-col">
        <SectionHeading title="Recorded time & attempts" note="Only what you entered. Missing values stay blank." action={<Button variant="secondary" size="sm" onClick={() => setTiming(true)}><Clock3 size={15} /> {hasRecordedTime ? 'Edit' : 'Add'} time</Button>} />
        <NotebookCard>
          {times.length === 0 ? <div className="jee-pad"><p className="jee-muted">No time or attempt data recorded for this test. Nothing is estimated — add it if you tracked it.</p></div> : <div className="jee-subject-time-list">
            {times.map(row => <div key={row.subject} className="jee-subject-time">
              <SubjectBadge subject={row.subject} />
              <div className="jee-row-numbers">
                <span>Time <b>{row.minutes === null ? '—' : minutesLabel(row.minutes)}</b></span>
                <span>Attempted <b>{row.attempted ?? '—'}</b></span>
                <span>Unattempted <b>{row.unattempted ?? '—'}</b></span>
                <span>Marks <b>{row.marks ?? '—'}{row.total ? `/${row.total}` : ''}</b></span>
              </div>
              {row.marksPerMinute !== null && <p className="jee-small jee-muted">{row.marksPerMinute.toFixed(2)} marks per minute spent</p>}
            </div>)}
          </div>}
        </NotebookCard>

        <SectionHeading title="Lost marks, classified" note="Tag each lost question or chunk of marks with why it happened." action={<Button size="sm" onClick={() => setClassifying('new')}><Plus size={15} /> Classify</Button>} />
        <NotebookCard>
          {logs.length === 0 ? <div className="jee-pad"><p className="jee-muted">No classifications yet. Try tagging the three biggest causes — that is usually enough to see a pattern.</p></div> : <ul className="jee-log-list">
            {logs.map(log => <li key={log.id} className="jee-log-row">
              <div>
                <strong>{log.category}</strong>
                <div className="jee-row-meta">{log.subject && <SubjectBadge subject={log.subject} />}{log.marks_lost !== null && <span>{log.marks_lost} marks</span>}{log.questions !== null && <span>{log.questions} question{log.questions === 1 ? '' : 's'}</span>}</div>
                {log.note && <p className="jee-note">{log.note}</p>}
              </div>
              <OverflowMenu label={`Actions for ${log.category}`} items={[
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
          {totals.length === 0 ? <p className="jee-muted jee-pad">Classify some lost marks to see the breakdown.</p> : <div className="jee-category-bars">
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

        <SectionHeading title="Fix before your next mock" note="Derived from the data above — each line says what it is based on." />
        <NotebookCard className="jee-insights">
          {insights.length === 0 ? <div className="jee-pad"><Lightbulb size={18} aria-hidden="true" /><p className="jee-muted">Not enough recorded detail to draw a conclusion. Add subject marks, time, or a few classifications.</p></div> : <ul>
            {insights.map((insight, index) => <li key={index}>
              <StatusBadge tone={insight.kind === 'recorded' ? 'Strong' : insight.kind === 'classified' ? 'Okay' : 'muted'}>{insight.kind === 'recorded' ? 'Recorded' : insight.kind === 'classified' ? 'You classified' : 'Derived'}</StatusBadge>
              <span>{insight.text}</span>
            </li>)}
          </ul>}
        </NotebookCard>
        <Button variant="quiet" size="sm" onClick={() => navigate('/weak-areas')}>See weak areas →</Button>
      </div>
    </section>

    {classifying && <ClassifyDialog test={selected} existing={classifying === 'new' ? undefined : classifying} onClose={() => setClassifying(null)} onSave={async value => {
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

function ClassifyDialog({ test, existing, onClose, onSave }: {
  test: TestRecord; existing?: TestErrorLog; onClose: () => void; onSave: (value: ErrorLogValue) => Promise<void>
}) {
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
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    const result = validateErrorLog(form)
    if (!result.ok) { setErrors(result.errors); notify('Check the highlighted fields.', 'error'); return }
    setSaving(true)
    try { await onSave(result.value); onClose() }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save the classification.', 'error') }
    finally { setSaving(false) }
  }
  return <Dialog title={existing ? 'Edit classification' : 'Classify lost marks'} subtitle="What went wrong on this question or chunk of marks?" onClose={onClose} className="jee-dialog">
    <form className="form-stack" noValidate onSubmit={submit}>
      <div className="form-grid two">
        <Field label="Subject"><select value={form.subject} onChange={event => set('subject', event.target.value as Subject | '')}><option value="">Not specified</option>{SUBJECTS.map(subject => <option key={subject}>{subject}</option>)}</select></Field>
        <Field label="Why did it happen?" error={errors.category} required><select value={form.category} onChange={event => set('category', event.target.value as ErrorCategory)}>{ERROR_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></Field>
      </div>
      <div className="form-grid two">
        <Field label="Questions" error={errors.questions}><input inputMode="numeric" value={form.questions} onChange={event => set('questions', event.target.value)} placeholder="4" /></Field>
        <Field label="Marks lost" error={errors.marksLost}><input inputMode="decimal" value={form.marksLost} onChange={event => set('marksLost', event.target.value)} placeholder="16" /></Field>
      </div>
      <Field label="Note (optional)" error={errors.note}><textarea rows={2} maxLength={5000} value={form.note} onChange={event => set('note', event.target.value)} placeholder="e.g. sign error in Q12 after long substitution" /></Field>
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>{existing ? 'Save' : 'Add classification'} <Check size={16} /></Button></div>
    </form>
  </Dialog>
}

function TimeDialog({ data, test, onClose, onSave }: { data: AppData; test: TestRecord; onClose: () => void; onSave: (entries: TestTimeEntry[]) => Promise<void> }) {
  const existing = data.testTimeEntries.filter(entry => entry.test_id === test.id)
  const [rows, setRows] = useState(() => SUBJECTS.map(subject => {
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
  return <Dialog title="Time & attempts by subject" subtitle="Leave a field blank if you did not record it — nothing is estimated." onClose={onClose} className="jee-dialog">
    <form className="form-stack" noValidate onSubmit={submit}>
      {rows.map(row => <fieldset key={row.subject} className="jee-fieldset"><legend><SubjectBadge subject={row.subject} /></legend>
        <div className="form-grid three">
          <Field label="Minutes"><input inputMode="numeric" value={row.minutes} onChange={event => update(row.subject, 'minutes', event.target.value)} /></Field>
          <Field label="Attempted"><input inputMode="numeric" value={row.attempted} onChange={event => update(row.subject, 'attempted', event.target.value)} /></Field>
          <Field label="Unattempted"><input inputMode="numeric" value={row.unattempted} onChange={event => update(row.subject, 'unattempted', event.target.value)} /></Field>
        </div>
      </fieldset>)}
      {errors && <p className="field-error" role="alert">{errors}</p>}
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>Save time data <Check size={16} /></Button></div>
    </form>
  </Dialog>
}
