import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, CircleCheck, Clock3, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { Button, ConfirmDialog, EmptyState, NotebookCard, PageHeader, StatusBadge, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { indiaDate, prettyDate } from '../lib/date'
import type { MistakeType, Subject } from '../types'
import { SUBJECTS } from '../types'

const TYPES: MistakeType[] = ['Concept', 'Silly', 'Calculation', 'Time', 'Guess']

export default function RetryPage() {
  const { data, upsert, remove } = useData()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [subject, setSubject] = useState<'all' | Subject>('all')
  const [chapterId, setChapterId] = useState('all')
  const [type, setType] = useState<'all' | MistakeType>('all')
  const [search, setSearch] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const ready = data.mistakes.filter(item => item.retry_later && item.retry_status === 'pending')
  const filtered = useMemo(() => ready.filter(mistake => {
    const chapter = data.chapters.find(item => item.id === mistake.chapter_id)
    if (subject !== 'all' && chapter?.subject !== subject) return false
    if (chapterId !== 'all' && mistake.chapter_id !== chapterId) return false
    if (type !== 'all' && mistake.mistake_type !== type) return false
    if (search && !`${mistake.question_note} ${chapter?.name ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())) return false
    return true
  }).sort((a, b) => a.created_at.localeCompare(b.created_at)), [ready, data.chapters, subject, chapterId, type, search])
  const chapters = data.chapters.filter(item => subject === 'all' || item.subject === subject).sort((a, b) => a.name.localeCompare(b.name))

  const markRetried = async (mistakeId: string) => {
    const mistake = data.mistakes.find(item => item.id === mistakeId)
    if (!mistake) return
    try { await upsert('mistakes', { ...mistake, retry_later: false, retry_status: 'retried', updated_at: new Date().toISOString() }); notify('Marked retried — that’s how a slip turns into recall.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not update retry status.', 'error') }
  }
  const keepForLater = async (mistakeId: string) => {
    const mistake = data.mistakes.find(item => item.id === mistakeId)
    if (!mistake) return
    try { await upsert('mistakes', { ...mistake, retry_later: false, retry_status: 'pending', updated_at: new Date().toISOString() }); notify('Moved back to the notebook. You can add it to retry again later.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not update retry list.', 'error') }
  }
  const deleteMistake = async () => {
    const mistake = data.mistakes.find(item => item.id === deleteId)
    if (!mistake) return
    try { await remove('mistakes', mistake); notify('Mistake deleted.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not delete mistake.', 'error') }
    setDeleteId(null)
  }

  return <div className="content-page retry-page">
    <PageHeader eyebrow="RETURN, RETRIEVE, REMEMBER" title="Retry list" subtitle="Give the questions that caught you another honest attempt." doodle={<RotateCcw size={19} />} action={<Button variant="secondary" onClick={() => navigate('/mistakes')}><ArrowLeft size={16} /> Mistake notebook</Button>} />
    <div className="retry-intro-row"><NotebookCard className="retry-intro-card"><div className="retry-circle-doodle"><RotateCcw size={22} /></div><div><span className="eyebrow">A SECOND LOOK</span><h2>{ready.length} question{ready.length === 1 ? '' : 's'} waiting for you</h2><p>Try again before reading the solution. Retrieval beats recognition.</p></div><div className="retry-spark" aria-hidden="true">✦</div></NotebookCard></div>
    <NotebookCard className="retry-board">
      <div className="retry-filters"><div className="search-field"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search retry notes…" aria-label="Search retry notes" />{search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</div><select aria-label="Filter retry subject" value={subject} onChange={event => { setSubject(event.target.value as 'all' | Subject); setChapterId('all') }}><option value="all">All subjects</option>{SUBJECTS.map(item => <option key={item}>{item}</option>)}</select><select aria-label="Filter retry chapter" value={chapterId} onChange={event => setChapterId(event.target.value)}><option value="all">All chapters</option>{chapters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Filter mistake type" value={type} onChange={event => setType(event.target.value as 'all' | MistakeType)}><option value="all">All types</option>{TYPES.map(item => <option key={item}>{item}</option>)}</select></div>
      {filtered.length === 0 ? <EmptyState icon={<CircleCheck size={25} />} title={ready.length ? 'Nothing in this view.' : 'Nothing waiting to retry.'} description={ready.length ? 'Try clearing a filter, or pick a different subject.' : 'When a question needs another pass, mark it “Retry later” in your mistake notebook.'} action={!ready.length ? <Button variant="secondary" size="sm" onClick={() => navigate('/mistakes')}>Open mistake notebook</Button> : <Button variant="secondary" size="sm" onClick={() => { setSubject('all'); setChapterId('all'); setType('all'); setSearch('') }}>Clear filters</Button>} /> : <div className="retry-list">{filtered.map(mistake => {
        const chapter = data.chapters.find(item => item.id === mistake.chapter_id)
        const test = data.tests.find(item => item.id === mistake.test_id)
        return <article key={mistake.id} className="retry-row">
          <div className="retry-row-index"><span>↻</span></div><div className="retry-row-main"><div className="retry-row-meta">{chapter ? <><SubjectBadge subject={chapter.subject} /> <strong>{chapter.name}</strong></> : <StatusBadge tone="weak">Chapter removed</StatusBadge>}<span className={`mistake-type-chip mistake-${mistake.mistake_type.toLowerCase()}`}>{mistake.mistake_type}</span></div><h3>{mistake.question_note}</h3><div className="retry-row-origin"><span><Clock3 size={13} /> Added {prettyDate(indiaDate(mistake.created_at))}</span>{test && <span>Original test: {test.title}</span>}</div>{mistake.solution_note && <details className="retry-solution"><summary>Reveal my note</summary><p>{mistake.solution_note}</p></details>}</div>
          <div className="retry-row-actions"><Button size="sm" onClick={() => void markRetried(mistake.id)}><Check size={15} /> Mark retried</Button><button className="text-button" onClick={() => void keepForLater(mistake.id)}>Keep for later</button><button className="icon-button retry-delete" onClick={() => setDeleteId(mistake.id)} aria-label="Delete question"><Trash2 size={15} /></button></div>
        </article>
      })}</div>}
      <div className="retry-footer">A question marked <StatusBadge tone="Strong">Retried</StatusBadge> stays in your mistake notebook for future review.</div>
    </NotebookCard>
    {deleteId && <ConfirmDialog title="Delete this question?" message="This mistake note will be removed from your notebook." onCancel={() => setDeleteId(null)} onConfirm={() => void deleteMistake()} />}
  </div>
}
