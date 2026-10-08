import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, CheckCheck, Search, Settings2, X } from 'lucide-react'
import { Button, EmptyState, NotebookCard, PageHeader, SectionHeading, SubjectBadge } from '../components/ui'
import { ChipFilter, Meter, SubjectSelect } from '../components/jee/shared'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { pyqCompletion, pyqYears, PYQ_EXAM_LABEL } from '../lib/jee/progress'
import { pyqRecordId } from '../lib/jee/ids'
import type { Chapter, PYQExam, PyqRecord, Subject } from '../types'
import { PYQ_EXAMS } from '../types'

type ExamFilter = 'all' | PYQExam
type StatusFilter = 'all' | 'pending' | 'done'

export default function PyqPage() {
  const { data, upsert, upsertMany } = useData()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [exam, setExam] = useState<ExamFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [subject, setSubject] = useState<Subject | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const years = useMemo(() => pyqYears(data.settings), [data.settings])
  const exams = useMemo<PYQExam[]>(() => exam === 'all' ? [...PYQ_EXAMS] : [exam], [exam])
  const userId = data.settings.user_id ?? data.settings.id

  const overall = PYQ_EXAMS.map(item => pyqCompletion(data.pyqRecords, null, item, data.settings))
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
      if (done) notify(`${chapter.name} · ${PYQ_EXAM_LABEL[examValue]} ${year} marked done.`)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update this PYQ year.', 'error') }
  }

  const setAllForChapter = async (chapter: Chapter, examValue: PYQExam, done: boolean) => {
    try {
      await writeYears(years.map(year => ({ chapter, exam: examValue, year, done })))
      notify(done ? `All ${PYQ_EXAM_LABEL[examValue]} years marked done for ${chapter.name}.` : `${PYQ_EXAM_LABEL[examValue]} years reset for ${chapter.name}.`)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update PYQs.', 'error') }
  }

  const bulk = async (examValue: PYQExam, done: boolean) => {
    if (bulkBusy || selected.size === 0) return
    const targets = data.chapters.filter(chapter => selected.has(chapter.id))
    setBulkBusy(true)
    try {
      await writeYears(targets.flatMap(chapter => years.map(year => ({ chapter, exam: examValue, year, done }))))
      notify(`${targets.length} chapter${targets.length === 1 ? '' : 's'} updated for ${PYQ_EXAM_LABEL[examValue]}.`)
      setSelected(new Set())
    } catch (error) { notify(error instanceof Error ? error.message : 'Bulk update failed. Nothing was half-applied; retry.', 'error') }
    finally { setBulkBusy(false) }
  }

  const toggleSelect = (chapterId: string) => setSelected(current => {
    const next = new Set(current)
    if (next.has(chapterId)) next.delete(chapterId); else next.add(chapterId)
    return next
  })

  const hasWindow = years.length > 0

  return <div className="content-page pyq-page">
    <PageHeader
      eyebrow="PREVIOUS YEAR QUESTIONS, YEAR BY YEAR"
      title="PYQ tracker"
      subtitle="Mark each chapter’s past papers as done. Completion feeds the chapter stages and Study now."
      action={<Button variant="secondary" size="sm" onClick={() => navigate('/settings')}><Settings2 size={15} /> Year range</Button>}
    />

    <section className="jee-stat-grid two" aria-label="PYQ completion overall">
      {overall.map(item => <NotebookCard key={item.exam} className="jee-stat">
        <span>{PYQ_EXAM_LABEL[item.exam]} PYQs</span>
        <strong>{item.done}/{item.total}<small> years</small></strong>
        <Meter value={item.percent} label={`${PYQ_EXAM_LABEL[item.exam]} PYQ completion`} tone={item.exam === 'Main' ? 'blue' : 'orange'} />
        <small>{item.percent === null ? 'Set a year range in Settings' : `${Math.round(item.percent)}% complete across all chapters`}</small>
      </NotebookCard>)}
    </section>

    <NotebookCard className="jee-filter-card">
      <div className="jee-filter-grid">
        <label className="jee-search"><Search size={16} aria-hidden="true" /><input type="search" placeholder="Find a chapter" value={search} onChange={event => setSearch(event.target.value)} aria-label="Find a chapter" /></label>
        <SubjectSelect value={subject} onChange={value => setSubject(value as Subject | 'all')} />
      </div>
      <ChipFilter<ExamFilter> label="Exam" value={exam} onChange={setExam} options={[{ value: 'all', label: 'Both' }, { value: 'Main', label: 'JEE Main' }, { value: 'Advanced', label: 'JEE Advanced' }]} />
      <ChipFilter<StatusFilter> label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'pending', label: 'Has pending years' }, { value: 'done', label: 'Complete' }]} />
    </NotebookCard>

    {!hasWindow && <NotebookCard><EmptyState title="The year range is empty." description="Set the first and last PYQ year in Settings → Exam." action={<Button variant="secondary" size="sm" onClick={() => navigate('/settings')}>Open Settings</Button>} /></NotebookCard>}

    {selected.size > 0 && <div className="jee-bulk-bar" role="region" aria-label="Bulk PYQ actions">
      <span><strong>{selected.size}</strong> selected</span>
      <div className="jee-bulk-actions">
        {(exam === 'all' ? [...PYQ_EXAMS] : [exam]).map(item => <span key={item} className="jee-bulk-pair">
          <Button size="sm" variant="secondary" onClick={() => void bulk(item, true)} loading={bulkBusy}><CheckCheck size={14} /> {PYQ_EXAM_LABEL[item]}: all done</Button>
          <Button size="sm" variant="quiet" onClick={() => void bulk(item, false)} disabled={bulkBusy}>Reset</Button>
        </span>)}
      </div>
      <Button size="sm" variant="quiet" onClick={() => setSelected(new Set())} aria-label="Clear selection"><X size={14} /> Clear</Button>
    </div>}

    <SectionHeading title="Chapters" note={`${chapters.length} shown · tap a year to toggle it · tick chapters to bulk-edit`} />
    {chapters.length === 0 ? <NotebookCard><EmptyState icon={<Check size={22} />} title="No chapters match." description="Clear the filters to see every chapter." /></NotebookCard> : <div className="jee-pyq-grid">
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
              <span>{PYQ_EXAM_LABEL[examValue]} PYQs: <b>{completion.done}/{completion.total}</b> complete{completion.percent !== null && <> — <b>{Math.round(completion.percent)}%</b></>}</span>
              <span className="jee-pyq-exam-actions">
                <button type="button" onClick={() => void setAllForChapter(chapter, examValue, true)} disabled={completion.pendingYears.length === 0} aria-label={`Mark all ${PYQ_EXAM_LABEL[examValue]} years done for ${chapter.name}`}>All</button>
                <button type="button" onClick={() => void setAllForChapter(chapter, examValue, false)} disabled={completion.doneYears.length === 0} aria-label={`Reset ${PYQ_EXAM_LABEL[examValue]} years for ${chapter.name}`}>Reset</button>
              </span>
            </div>
            <div className="jee-year-row" role="group" aria-label={`${PYQ_EXAM_LABEL[examValue]} years for ${chapter.name}`}>
              {years.map(year => {
                const done = completion.doneYears.includes(year)
                return <button key={year} type="button" className={`jee-year ${done ? 'done' : 'pending'}`} aria-pressed={done} onClick={() => void toggleYear(chapter, examValue, year)} aria-label={`${year} ${done ? 'done' : 'pending'} — tap to mark ${done ? 'pending' : 'done'}`}>
                  {done && <Check size={12} aria-hidden="true" />}{year}
                </button>
              })}
            </div>
          </div>)}
        </NotebookCard>
      })}
    </div>}
  </div>
}

