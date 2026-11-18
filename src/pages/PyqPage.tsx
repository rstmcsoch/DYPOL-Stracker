import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, CheckCheck, PencilLine, Search, Settings2, Timer, X } from 'lucide-react'
import { Button, Dialog, EmptyState, Field, NotebookCard, PageHeader, SectionHeading, SubjectBadge } from '../components/ui'
import { ChipFilter, Meter, SubjectSelect } from '../components/jee/shared'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { pyqCompletion, pyqYears, PYQ_EXAM_LABEL } from '../lib/jee/progress'
import { pyqRecordId } from '../lib/jee/ids'
import { createId } from '../lib/id'
import { indiaToday } from '../lib/date'
import type { Chapter, PYQExam, PyqRecord, Subject } from '../types'
import { PYQ_EXAMS } from '../types'
import { isJeeSettings } from '../lib/jee/exam'
import { examName } from '../lib/exams/catalog'
import { currentSubjectCatalog } from '../lib/exams/subjects'
import { T } from '../lib/student-layout/T'
import { usePageSlots } from '../lib/student-layout/use-layout'

type ExamFilter = 'all' | PYQExam
type StatusFilter = 'all' | 'pending' | 'done'

export default function PyqPage() {
  const sl = usePageSlots('pyqs')
  const { data, upsert, upsertMany } = useData()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [exam, setExam] = useState<ExamFilter>('all')
  // JEE keeps separate Main / Advanced columns; every other exam uses one PYQ column labelled with its own name.
  const jee = isJeeSettings(data.settings)
  const examList: PYQExam[] = jee ? [...PYQ_EXAMS] : ['Main']
  const pyqLabel = (value: PYQExam) => jee ? PYQ_EXAM_LABEL[value] : examName(data.settings.exam_id, currentSubjectCatalog())
  const [status, setStatus] = useState<StatusFilter>('all')
  const [subject, setSubject] = useState<Subject | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [counting, setCounting] = useState<{ chapter: Chapter; exam: PYQExam; year: number } | null>(null)
  const [loggingPaper, setLoggingPaper] = useState(false)
  const years = useMemo(() => pyqYears(data.settings), [data.settings])
  const exams = useMemo<PYQExam[]>(() => !jee ? ['Main'] : exam === 'all' ? [...PYQ_EXAMS] : [exam], [exam, jee])
  const userId = data.settings.user_id ?? data.settings.id

  const overall = examList.map(item => pyqCompletion(data.pyqRecords, null, item, data.settings))
  const chapters = useMemo(() => data.chapters.filter(chapter => {
    if (subject !== 'all' && chapter.subject !== subject) return false
    if (search.trim() && !chapter.name.toLowerCase().includes(search.trim().toLowerCase())) return false
    const rows = exams.map(item => pyqCompletion(data.pyqRecords, chapter.id, item, data.settings))
    const pending = rows.some(row => row.pendingYears.length > 0)
    if (status === 'pending' && !pending) return false
    if (status === 'done' && pending) return false
    return true
  }), [data.chapters, data.pyqRecords, data.settings, subject, search, status, exams])

  const recordFor = (chapterId: string, examValue: PYQExam, year: number): PyqRecord | undefined =>
    data.pyqRecords.find(row => row.chapter_id === chapterId && row.exam === examValue && row.year === year)

  const writeYears = async (targets: { chapter: Chapter; exam: PYQExam; year: number; done: boolean }[]) => {
    const now = new Date().toISOString()
    const records: PyqRecord[] = targets.map(target => {
      const existing = recordFor(target.chapter.id, target.exam, target.year)
      return {
        id: existing?.id ?? pyqRecordId(userId, target.chapter.id, target.exam, target.year),
        chapter_id: target.chapter.id, exam: target.exam, year: target.year,
        status: target.done ? 'done' : 'pending',
        questions_total: existing?.questions_total ?? null, questions_done: existing?.questions_done ?? null,
        meta: existing?.meta ?? null,
        completed_at: target.done ? (existing?.completed_at ?? now) : null,
        created_at: existing?.created_at ?? now, updated_at: now
      }
    })
    if (records.length === 1) await upsert('pyq_records', records[0]!)
    else await upsertMany('pyq_records', records)
  }

  const toggleYear = async (chapter: Chapter, examValue: PYQExam, year: number) => {
    const current = recordFor(chapter.id, examValue, year)
    const done = current?.status !== 'done'
    try {
      await writeYears([{ chapter, exam: examValue, year, done }])
      if (done) notify(`${chapter.name} · ${pyqLabel(examValue)} ${year} marked done.`)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update this PYQ year.', 'error') }
  }

  const setAllForChapter = async (chapter: Chapter, examValue: PYQExam, done: boolean) => {
    try {
      await writeYears(years.map(year => ({ chapter, exam: examValue, year, done })))
      notify(done ? `All ${pyqLabel(examValue)} years marked done for ${chapter.name}.` : `${pyqLabel(examValue)} years reset for ${chapter.name}.`)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update PYQs.', 'error') }
  }

  const bulk = async (examValue: PYQExam, done: boolean) => {
    if (bulkBusy || selected.size === 0) return
    const targets = data.chapters.filter(chapter => selected.has(chapter.id))
    setBulkBusy(true)
    try {
      await writeYears(targets.flatMap(chapter => years.map(year => ({ chapter, exam: examValue, year, done }))))
      notify(`${targets.length} chapter${targets.length === 1 ? '' : 's'} updated for ${pyqLabel(examValue)}.`)
      setSelected(new Set())
    } catch (error) { notify(error instanceof Error ? error.message : 'Bulk update failed. Nothing changed; retry.', 'error') }
    finally { setBulkBusy(false) }
  }

  /**
   * Year cells can carry the real question counts (`questions_done` / `questions_total`),
   * which the schema has always stored but the tracker never showed. A year is "done"
   * either by tapping it or by reaching 100% of its questions; the fast path still works.
   */
  const saveQuestions = async (chapter: Chapter, examValue: PYQExam, year: number, done: number, total: number) => {
    const existing = recordFor(chapter.id, examValue, year)
    const now = new Date().toISOString()
    const complete = done >= total && total > 0
    try {
      await upsert('pyq_records', {
        id: existing?.id ?? pyqRecordId(userId, chapter.id, examValue, year),
        chapter_id: chapter.id, exam: examValue, year,
        status: complete ? 'done' : existing?.status === 'done' ? 'done' : 'pending',
        questions_total: total, questions_done: done,
        meta: existing?.meta ?? null,
        completed_at: complete ? (existing?.completed_at ?? now) : existing?.completed_at ?? null,
        created_at: existing?.created_at ?? now, updated_at: now
      })
      notify(`${chapter.name} · ${pyqLabel(examValue)} ${year}: ${done}/${total} questions.`)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save the question count.', 'error') }
  }

  const toggleSelect = (chapterId: string) => setSelected(current => {
    const next = new Set(current)
    if (next.has(chapterId)) next.delete(chapterId); else next.add(chapterId)
    return next
  })

  /**
   * A PYQ paper sat under the clock. This writes a normal test record ("PYQ Practice") and
   * marks the paper's years as done, in one flow — the audit asked for the timer and the
   * log to stop being two separate chores.
   */
  const logMockPaper = async (input: { title: string; exam: PYQExam; year: number; marks: number; total: number; minutes: number }) => {
    const now = new Date().toISOString()
    try {
      await upsert('tests', {
        id: createId(), title: input.title, test_date: indiaToday(), test_type: 'PYQ Practice',
        subject: null, chapter_id: null, marks_obtained: input.marks, total_marks: input.total,
        correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: input.minutes,
        notes: `Full ${pyqLabel(input.exam)} ${input.year} paper under time.`, percentile: null,
        created_at: now, updated_at: now
      })
      // The paper itself counts as covered: every chapter's record for that exam-year is marked done.
      const matching = data.chapters
      if (matching.length) {
        await upsertMany('pyq_records', matching.map(chapter => {
          const existing = recordFor(chapter.id, input.exam, input.year)
          return {
            id: existing?.id ?? pyqRecordId(userId, chapter.id, input.exam, input.year),
            chapter_id: chapter.id, exam: input.exam, year: input.year, status: 'done' as const,
            questions_total: existing?.questions_total ?? null,
            questions_done: existing?.questions_done ?? null,
            meta: existing?.meta ?? null, completed_at: existing?.completed_at ?? now,
            created_at: existing?.created_at ?? now, updated_at: now
          }
        }))
      }
      notify(`Paper saved: ${input.marks}/${input.total} in ${input.minutes} min. ${matching.length} chapter records marked done.`)
      setLoggingPaper(false)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save the paper.', 'error') }
  }

  const hasWindow = years.length > 0

  return <div className="content-page pyq-page">
    <PageHeader layoutId="pyqs.header"
      title="PYQ tracker"
      subtitle="Track past papers by chapter."
      action={<div className="pyq-header-actions"><Button variant="secondary" size="sm" onClick={() => navigate('/settings')}><Settings2 size={15} />{' '}<T k="pyqs:year-range">{"Year range"}</T></Button><Button size="sm" onClick={() => setLoggingPaper(true)}><Timer size={15} /> Log a timed paper</Button></div>}
    />

    {!sl.hidden('summary') && <section {...sl.attrs('summary')} className={`jee-stat-grid ${examList.length === 2 ? 'two' : 'one'}`} aria-label="PYQ completion overall">
      {overall.map(item => <NotebookCard key={item.exam} className="jee-stat">
        <span>{pyqLabel(item.exam)} PYQs</span>
        <strong>{item.done}/{item.total}<small>{' '}<T k="pyqs:years">{"years"}</T></small></strong>
        <Meter value={item.percent} label={`${pyqLabel(item.exam)} PYQ completion`} tone={item.exam === 'Main' ? 'blue' : 'orange'} />
        <small>{item.percent === null ? 'Set a year range in Settings' : `${Math.round(item.percent)}% complete across all chapters`}</small>
      </NotebookCard>)}
    </section>}

    <NotebookCard {...sl.attrs('filters')} className="jee-filter-card">
      <div className="jee-filter-grid">
        <label className="jee-search"><Search size={16} aria-hidden="true" /><input type="search" placeholder="Find a chapter" value={search} onChange={event => setSearch(event.target.value)} aria-label="Find a chapter" /></label>
        <SubjectSelect value={subject} onChange={value => setSubject(value as Subject | 'all')} />
      </div>
      {jee && <ChipFilter<ExamFilter> lk="pyqs" label="Exam" value={exam} onChange={setExam} options={[{ value: 'all', label: 'Both' }, { value: 'Main', label: 'JEE Main' }, { value: 'Advanced', label: 'JEE Advanced' }]} />}
      <ChipFilter<StatusFilter> lk="pyqs" label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'pending', label: 'Has pending years' }, { value: 'done', label: 'Complete' }]} />
    </NotebookCard>

    {!hasWindow && <NotebookCard><EmptyState lk="pyqs:set-a-pyq-year-range-in-settings" title="Set a PYQ year range in Settings." action={<Button variant="secondary" size="sm" onClick={() => navigate('/settings')}><T k="pyqs:open-settings">{"Open Settings"}</T></Button>} /></NotebookCard>}

    {selected.size > 0 && <div className="jee-bulk-bar" role="region" aria-label="Bulk PYQ actions">
      <span><strong>{selected.size}</strong>{' '}<T k="pyqs:selected">{"selected"}</T></span>
      <div className="jee-bulk-actions">
        {(!jee ? examList : exam === 'all' ? [...PYQ_EXAMS] : [exam]).map(item => <span key={item} className="jee-bulk-pair">
          <Button size="sm" variant="secondary" onClick={() => void bulk(item, true)} loading={bulkBusy}><CheckCheck size={14} /> {pyqLabel(item)}: all done</Button>
          <Button size="sm" variant="quiet" onClick={() => void bulk(item, false)} disabled={bulkBusy}><T k="pyqs:reset">{"Reset"}</T></Button>
        </span>)}
      </div>
      <Button size="sm" variant="quiet" onClick={() => setSelected(new Set())} aria-label="Clear selection"><X size={14} />{' '}<T k="pyqs:clear">{"Clear"}</T></Button>
    </div>}

    <SectionHeading title="Chapters" note={`${chapters.length} shown · tap a year to toggle it · tick chapters to bulk-edit`} />
    {chapters.length === 0 ? <NotebookCard><EmptyState lk="pyqs:no-chapters-match" icon={<Check size={22} />} title="No chapters match." /></NotebookCard> : <div className="jee-pyq-grid">
      {chapters.map(chapter => {
        const rows = exams.map(item => ({ exam: item, completion: pyqCompletion(data.pyqRecords, chapter.id, item, data.settings) }))
        const isSelected = selected.has(chapter.id)
        return <NotebookCard key={chapter.id} className={`jee-pyq-card ${isSelected ? 'is-selected' : ''}`}>
          <div className="jee-pyq-head">
            <label className="jee-check-target">
              <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(chapter.id)} aria-label={`Select ${chapter.name} for bulk actions`} />
              <span><strong>{chapter.name}</strong><span className="jee-row-meta"><SubjectBadge subject={chapter.subject} /></span></span>
            </label>
          </div>
          {rows.map(({ exam: examValue, completion }) => <div key={examValue} className="jee-pyq-exam">
            <div className="jee-pyq-exam-head">
              <span>{pyqLabel(examValue)} PYQs: <b>{completion.done}/{completion.total}</b> complete{completion.percent !== null && <> — <b>{Math.round(completion.percent)}%</b></>}</span>
              <span className="jee-pyq-exam-actions">
                <button type="button" onClick={() => setCounting({ chapter, exam: examValue, year: years.find(year => !completion.doneYears.includes(year)) ?? years[0] ?? new Date().getFullYear() })} aria-label={`Record question counts for ${chapter.name} · ${pyqLabel(examValue)}`} title="Record questions done / total"><PencilLine size={13} /></button>
                <button type="button" onClick={() => void setAllForChapter(chapter, examValue, true)} disabled={completion.pendingYears.length === 0} aria-label={`Mark all ${pyqLabel(examValue)} years done for ${chapter.name}`}><T k="pyqs:all">{"All"}</T></button>
                <button type="button" onClick={() => void setAllForChapter(chapter, examValue, false)} disabled={completion.doneYears.length === 0} aria-label={`Reset ${pyqLabel(examValue)} years for ${chapter.name}`}><T k="pyqs:reset">{"Reset"}</T></button>
              </span>
            </div>
            <div className="jee-year-row" role="group" aria-label={`${pyqLabel(examValue)} years for ${chapter.name}`}>
              {years.map(year => {
                const done = completion.doneYears.includes(year)
                return <button key={year} type="button" className={`jee-year ${done ? 'done' : 'pending'}`} aria-pressed={done} onClick={() => void toggleYear(chapter, examValue, year)} aria-label={`${year} ${done ? 'done' : 'pending'} — tap to mark ${done ? 'pending' : 'done'}`}>
                  {done && <Check size={12} aria-hidden="true" />}{year}
                </button>
              })}
            </div>
            {completion.questions.total > 0 && <p className="jee-small jee-muted jee-pyq-question-line">Questions: <b>{completion.questions.done}/{completion.questions.total}</b>{completion.questions.percent !== null ? ` · ${Math.round(completion.questions.percent)}%` : ''}{completion.questions.total > 0 && completion.questions.percent !== null && completion.questions.percent >= 100 ? ' · every counted year complete' : ''}</p>}
          </div>)}
        </NotebookCard>
      })}
    </div>}
    {loggingPaper && <TimedPaperDialog years={years} exams={examList} labelOf={pyqLabel} onClose={() => setLoggingPaper(false)} onSave={logMockPaper} />}
    {counting && <QuestionCountDialog target={counting} years={years} existing={recordFor(counting.chapter.id, counting.exam, counting.year)} onClose={() => setCounting(null)} onSave={saveQuestions} />}
  </div>
}

function QuestionCountDialog({ target, years, existing, onClose, onSave }: {
  target: { chapter: Chapter; exam: PYQExam; year: number }
  years: number[]
  existing: PyqRecord | undefined
  onClose: () => void
  onSave: (chapter: Chapter, exam: PYQExam, year: number, done: number, total: number) => Promise<void>
}) {
  const [year, setYear] = useState(target.year)
  const [done, setDone] = useState(existing?.questions_done != null ? String(existing.questions_done) : '')
  const [total, setTotal] = useState(existing?.questions_total != null ? String(existing.questions_total) : '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const chooseYear = (next: number) => { setYear(next); setDone(''); setTotal(''); setError(null) }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    const doneValue = Number(done), totalValue = Number(total)
    if (!Number.isInteger(totalValue) || totalValue < 1 || totalValue > 999) { setError('Total questions must be a whole number from 1 to 999.'); return }
    if (!Number.isInteger(doneValue) || doneValue < 0 || doneValue > totalValue) { setError('Questions done must be a whole number from 0 to the total.'); return }
    setSaving(true)
    try { await onSave(target.chapter, target.exam, year, doneValue, totalValue); onClose() }
    finally { setSaving(false) }
  }
  return <Dialog lk="pyqs:record-question-counts" title="Record question counts" subtitle="Optional, but it turns years into real progress." onClose={onClose} className="jee-dialog">
    <form className="form-stack" noValidate onSubmit={submit}>
      <Field lk="pyqs:l-year" label="Year"><select value={year} onChange={event => chooseYear(Number(event.target.value))}>{years.map(item => <option key={item} value={item}>{item}</option>)}</select></Field>
      <div className="form-grid two">
        <Field lk="pyqs:questions-done" label="Questions done"><input inputMode="numeric" value={done} onChange={event => { setDone(event.target.value); setError(null) }} placeholder="18" /></Field>
        <Field lk="pyqs:questions-total" label="Total questions"><input inputMode="numeric" value={total} onChange={event => { setTotal(event.target.value); setError(null) }} placeholder="30" /></Field>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}><T k="pyqs:cancel">{"Cancel"}</T></Button><Button type="submit" loading={saving}><T k="pyqs:save-counts">{"Save counts"}</T></Button></div>
    </form>
  </Dialog>
}


/**
 * Log a full paper sat under the clock. Marks, total and minutes are the only required
 * fields; the year and exam decide which chapter records get marked done.
 */
function TimedPaperDialog({ years, exams, labelOf, onClose, onSave }: {
  years: number[]
  exams: PYQExam[]
  labelOf: (exam: PYQExam) => string
  onClose: () => void
  onSave: (input: { title: string; exam: PYQExam; year: number; marks: number; total: number; minutes: number }) => Promise<void>
}) {
  const [exam, setExam] = useState<PYQExam>(exams[0] ?? 'Main')
  const [year, setYear] = useState(years[0] ?? new Date().getFullYear())
  const [title, setTitle] = useState('')
  const [marks, setMarks] = useState('')
  const [total, setTotal] = useState('300')
  const [minutes, setMinutes] = useState('180')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    const marksValue = Number(marks)
    const totalValue = Number(total)
    const minutesValue = Number(minutes)
    if (!Number.isFinite(marksValue) || !Number.isFinite(totalValue) || totalValue <= 0) { setError('Enter the marks you got and the paper total.'); return }
    if (marksValue < 0 || marksValue > totalValue) { setError('Marks cannot be negative or above the paper total.'); return }
    if (!Number.isFinite(minutesValue) || minutesValue <= 0 || minutesValue > 600) { setError('Time must be between 1 and 600 minutes.'); return }
    setSaving(true)
    try {
      await onSave({ title: title.trim() || `${labelOf(exam)} ${year} paper`, exam, year, marks: marksValue, total: totalValue, minutes: minutesValue })
    } finally { setSaving(false) }
  }
  return <Dialog lk="pyqs:log-a-timed-paper" title="Log a timed paper" subtitle="Saves a test and marks that paper's chapters done." onClose={onClose}>
    <form className="form-stack" noValidate onSubmit={submit}>
      <div className="form-grid two">
        <Field lk="pyqs:l-exam" label="Exam"><select value={exam} onChange={event => setExam(event.target.value as PYQExam)}>{exams.map(item => <option key={item} value={item}>{labelOf(item)}</option>)}</select></Field>
        <Field lk="pyqs:l-year" label="Year"><select value={year} onChange={event => setYear(Number(event.target.value))}>{years.map(item => <option key={item} value={item}>{item}</option>)}</select></Field>
      </div>
      <Field lk="pyqs:l-title" label="Title" hint="Optional"><input value={title} maxLength={120} onChange={event => setTitle(event.target.value)} placeholder="Paper name" /></Field>
      <div className="form-grid three">
        <Field lk="pyqs:l-marks" label="Marks scored"><input type="number" inputMode="decimal" min={0} value={marks} onChange={event => { setMarks(event.target.value); setError(null) }} /></Field>
        <Field lk="pyqs:l-total" label="Paper total"><input type="number" inputMode="decimal" min={1} value={total} onChange={event => { setTotal(event.target.value); setError(null) }} /></Field>
        <Field lk="pyqs:l-minutes" label="Minutes"><input type="number" inputMode="numeric" min={1} max={600} value={minutes} onChange={event => { setMinutes(event.target.value); setError(null) }} /></Field>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>Save paper</Button></div>
    </form>
  </Dialog>
}
