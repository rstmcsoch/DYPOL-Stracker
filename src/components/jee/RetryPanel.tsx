import { useMemo, useRef, useState } from 'react'
import { CircleCheck, Clock3, Check, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { Button, ConfirmDialog, EmptyState, NotebookCard, StatusBadge, SubjectBadge } from '../ui'
import { useData } from '../../contexts/DataContext'
import { useToast } from '../../contexts/ToastContext'
import { indiaDate, indiaToday, prettyDate } from '../../lib/date'
import type { Mistake, MistakeType, Subject } from '../../types'
import { useReportSubjects } from '../../lib/exams/useExamSubjects'
import { T } from '../../lib/student-layout/T'
import { advanceRetry, retryDueOn, retryIsDue, retryQueue } from '../../lib/mistake-cause'

const TYPES: MistakeType[] = ['Concept', 'Silly', 'Calculation', 'Time', 'Guess']

/**
 * The retry queue, as a panel instead of a page. It used to be `/retry`, an 80-line page
 * promoted to a whole sidebar item; the Mistake notebook now owns it as a tab (and `/retry`
 * still redirects here), so "ready to retry" is a view of the notebook rather than a
 * second place where mistakes live.
 *
 * `layout` switches the container: `card` renders its own NotebookCard (standalone tab),
 * `embedded` renders a plain section so the surrounding page controls the shell.
 */
export function RetryPanel({ layout = 'card', onBrowseNotebook }: { layout?: 'card' | 'embedded'; onBrowseNotebook?: () => void }) {
  const subjectList = useReportSubjects()
  const { data, upsert, remove } = useData()
  const { notify } = useToast()
  const [subject, setSubject] = useState<'all' | Subject>('all')
  const [chapterId, setChapterId] = useState('all')
  const [type, setType] = useState<'all' | MistakeType>('all')
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Mistake | null>(null)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  const today = indiaToday()
  // The tab count and this list share one source: every pending "Retry later" note,
  // including ones whose spaced due date is still in the future (those are labelled).
  const ready = retryQueue(data.mistakes)
  const dueNow = ready.filter(item => retryIsDue(item, today)).length
  const filtered = useMemo(() => ready.filter(mistake => {
    const chapter = data.chapters.find(item => item.id === mistake.chapter_id)
    if (subject !== 'all' && chapter?.subject !== subject) return false
    if (chapterId !== 'all' && mistake.chapter_id !== chapterId) return false
    if (type !== 'all' && mistake.mistake_type !== type) return false
    if (search && !`${mistake.question_note} ${chapter?.name ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())) return false
    return true
  }).sort((a, b) => a.created_at.localeCompare(b.created_at)), [ready, data.chapters, subject, chapterId, type, search])
  const chapters = data.chapters.filter(item => subject === 'all' || item.subject === subject).sort((a, b) => a.name.localeCompare(b.name))
  const clearFilters = () => { setSubject('all'); setChapterId('all'); setType('all'); setSearch('') }

  const markRetried = async (mistakeId: string) => {
    const mistake = data.mistakes.find(item => item.id === mistakeId)
    if (!mistake) return
    const patch = advanceRetry(today, mistake.retry_count ?? 0)
    try {
      await upsert('mistakes', { ...mistake, ...patch, updated_at: new Date().toISOString() })
      notify(patch.retry_later ? `Retried. It comes back on ${prettyDate(patch.retry_due_on!)} for a second pass.` : 'Retried twice — that note is retired. It stays in your notebook.')
    }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not update retry status.', 'error') }
  }
  const keepForLater = async (mistakeId: string) => {
    const mistake = data.mistakes.find(item => item.id === mistakeId)
    if (!mistake) return
    try { await upsert('mistakes', { ...mistake, retry_later: false, retry_status: 'pending', retry_due_on: null, updated_at: new Date().toISOString() }); notify('Moved back to the notebook. You can add it to retry again later.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not update retry list.', 'error') }
  }
  const deleteMistake = async () => {
    if (!deleteTarget || deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    try { await remove('mistakes', deleteTarget); notify('Mistake deleted.'); setDeleteTarget(null) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not delete mistake.', 'error') }
    finally { deletingRef.current = false; setDeleting(false) }
  }

  const body = <>
    <div className="retry-intro-row"><NotebookCard className="retry-intro-card"><div className="retry-circle-doodle"><RotateCcw size={22} /></div><div><span className="eyebrow"><T k="mistakes:a-second-look">{"READY TO RETRY"}</T></span><h2>{ready.length} question{ready.length === 1 ? '' : 's'} on your retry list</h2>{dueNow < ready.length ? <p>{dueNow} due now, {ready.length - dueNow} come back later.</p> : null}<p><T k="retry:try-again-before-reading-the-solution-re">{"Try it before you read the solution."}</T></p></div><div className="retry-spark" aria-hidden="true">✦</div></NotebookCard></div>
    <div className="retry-filters"><div className="search-field"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search retry notes…" aria-label="Search retry notes" />{search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</div><select aria-label="Filter retry subject" value={subject} onChange={event => { setSubject(event.target.value as 'all' | Subject); setChapterId('all') }}><option value="all">All subjects</option>{subjectList.map(item => <option key={item}>{item}</option>)}</select><select aria-label="Filter retry chapter" value={chapterId} onChange={event => setChapterId(event.target.value)}><option value="all">All chapters</option>{chapters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Filter mistake type" value={type} onChange={event => setType(event.target.value as 'all' | MistakeType)}><option value="all">All types</option>{TYPES.map(item => <option key={item}>{item}</option>)}</select></div>
    {filtered.length === 0 ? <EmptyState icon={<CircleCheck size={25} />} title={ready.length ? 'Nothing in this view.' : 'Nothing waiting to retry.'} description={ready.length ? undefined : 'Mark a mistake “Retry later” to add it here.'} action={!ready.length ? <Button variant="secondary" size="sm" onClick={onBrowseNotebook}><T k="retry:open-mistake-notebook">{"Open mistake notebook"}</T></Button> : <Button variant="secondary" size="sm" onClick={clearFilters}><T k="retry:clear-filters">{"Clear filters"}</T></Button>} /> : <div className="retry-list">{filtered.map(mistake => {
      const chapter = data.chapters.find(item => item.id === mistake.chapter_id)
      const test = data.tests.find(item => item.id === mistake.test_id)
      return <article key={mistake.id} className="retry-row">
        <div className="retry-row-index"><span>↻</span></div><div className="retry-row-main"><div className="retry-row-meta">{chapter ? <><SubjectBadge subject={chapter.subject} /> <strong>{chapter.name}</strong></> : <StatusBadge tone="weak"><T k="retry:chapter-removed">{"Chapter removed"}</T></StatusBadge>}<span className={`mistake-type-chip mistake-${mistake.mistake_type.toLowerCase()}`}>{mistake.mistake_type}</span></div><h3>{mistake.question_note}</h3><div className="retry-row-origin"><span><Clock3 size={13} /> Added {prettyDate(indiaDate(mistake.created_at))}</span>{retryDueOn(mistake) && <span className={retryDueOn(mistake)! < today ? 'retry-overdue' : undefined}>{retryDueOn(mistake)! < today ? 'Overdue since' : 'Due'} {prettyDate(retryDueOn(mistake)!)}</span>}{mistake.retry_count ? <span>Pass {mistake.retry_count + 1}</span> : null}{test && <span title={`Original test: ${test.title}`}>Original test: {test.title}</span>}</div><details className="retry-solution"><summary><T k="retry:reveal-my-note">{"Reveal my note"}</T></summary>{mistake.solution_note.trim() ? <p>{mistake.solution_note}</p> : <p className="retry-solution-empty"><T k="retry:no-note-saved-for-this-one-yet-edit-it-i">{"No note yet. Edit it in"}</T>{' '}<button type="button" className="text-button" onClick={onBrowseNotebook}>Mistakes</button>{' '}<T k="retry:to-add-what-youll-remember-for-next-time">{"to add one."}</T></p>}</details></div>
        <div className="retry-row-actions"><Button size="sm" onClick={() => void markRetried(mistake.id)}><Check size={15} />{' '}<T k="retry:mark-retried">{"Mark retried"}</T></Button><button className="text-button" onClick={() => void keepForLater(mistake.id)}><T k="retry:keep-for-later">{"Keep for later"}</T></button><button className="icon-button retry-delete" onClick={() => setDeleteTarget(mistake)} aria-label="Delete question"><Trash2 size={15} /></button></div>
      </article>
    })}</div>}
    <div className="retry-footer"><T k="retry:a-question-marked">{"A question marked"}</T>{' '}<StatusBadge tone="Strong"><T k="retry:retried">{"Retried"}</T></StatusBadge>{' '}<T k="retry:stays-in-your-mistake-notebook-for-futur">{"stays in your mistake notebook for future review."}</T></div>
  </>

  return <>
    {layout === 'card' ? <NotebookCard className="retry-board">{body}</NotebookCard> : <section className="retry-embedded" aria-label="Retry list">{body}</section>}
    {deleteTarget && <ConfirmDialog title={`Delete “${deleteTarget.question_note.slice(0, 48)}${deleteTarget.question_note.length > 48 ? '…' : ''}”?`} message="This mistake will be removed. You can undo briefly." onCancel={() => setDeleteTarget(null)} onConfirm={() => void deleteMistake()} loading={deleting} />}
  </>
}
