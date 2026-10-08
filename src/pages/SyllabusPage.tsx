import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronDown, CircleDot, Edit3, Filter, GripVertical, Plus, Search, Trash2, X } from 'lucide-react'
import { Button, ConfirmDialog, Dialog, EmptyState, Field, NotebookCard, PageHeader, ProgressBar, StatusBadge, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { getChapterPerformance } from '../lib/analytics'
import { createId } from '../lib/id'
import { indiaToday, plusDays } from '../lib/date'
import type { Chapter, ChapterStatus, Priority, Subject } from '../types'
import { SUBJECTS } from '../types'

const STATUSES: ChapterStatus[] = ['Not Started', 'Studying', 'Done', 'Revised']
const PRIORITIES: Priority[] = ['High', 'Medium', 'Low']

type StrengthFilter = 'all' | 'Weak' | 'Okay' | 'Strong'

export default function SyllabusPage() {
  const { data, upsert, upsertMany, remove } = useData()
  const { notify } = useToast()
  const performance = useMemo(() => getChapterPerformance(data), [data])
  const [search, setSearch] = useState('')
  const [subjectFilter, setSubjectFilter] = useState<'all' | Subject>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ChapterStatus>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all')
  const [strengthFilter, setStrengthFilter] = useState<StrengthFilter>('all')
  const [testedFilter, setTestedFilter] = useState<'all' | 'tested' | 'untested'>('all')
  const [editing, setEditing] = useState<Chapter | null>(null)
  const [createSubject, setCreateSubject] = useState<Subject | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Chapter | null>(null)
  const [deletingChapter, setDeletingChapter] = useState(false)
  const deletingChapterRef = useRef(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return performance.filter(item => {
      const chapter = item.chapter
      if (subjectFilter !== 'all' && chapter.subject !== subjectFilter) return false
      if (statusFilter !== 'all' && chapter.status !== statusFilter) return false
      if (priorityFilter !== 'all' && chapter.priority !== priorityFilter) return false
      if (strengthFilter !== 'all' && item.classification !== strengthFilter) return false
      if (testedFilter === 'tested' && item.classification === 'Untested') return false
      if (testedFilter === 'untested' && item.classification !== 'Untested') return false
      if (term && !`${chapter.name} ${chapter.subject} ${chapter.notes} ${chapter.formula_notes}`.toLowerCase().includes(term)) return false
      return true
    })
  }, [performance, search, subjectFilter, statusFilter, priorityFilter, strengthFilter, testedFilter])

  const clearFilters = () => { setSearch(''); setSubjectFilter('all'); setStatusFilter('all'); setPriorityFilter('all'); setStrengthFilter('all'); setTestedFilter('all') }

  const persistChapterStatus = async (next: Chapter, previous?: Chapter) => {
    await upsert('chapters', next)
    const wasComplete = previous?.status === 'Done' || previous?.status === 'Revised'
    const isComplete = next.status === 'Done' || next.status === 'Revised'
    const chapterRevisions = data.revisions.filter(revision => revision.chapter_id === next.id)
    if (isComplete && (!wasComplete || chapterRevisions.length === 0)) {
      const firstNumber = chapterRevisions.reduce((max, revision) => Math.max(max, revision.revision_number), 0) + 1
      const now = new Date().toISOString()
      await upsertMany('chapter_revisions', data.settings.revision_gaps.map((gap, index) => ({
        id: createId(), chapter_id: next.id, revision_number: firstNumber + index,
        due_on: plusDays(next.completed_on ?? indiaToday(), Math.max(1, gap)), completed_at: null, created_at: now, updated_at: now
      })))
    } else if (wasComplete && !isComplete) {
      const pending = data.revisions.filter(revision => revision.chapter_id === next.id && !revision.completed_at)
      for (const revision of pending) await remove('chapter_revisions', revision, { undo: false })
    }
  }

  const changeStatus = async (chapter: Chapter, status: ChapterStatus) => {
    if (status === chapter.status || busy) return
    const now = new Date().toISOString()
    setBusy(chapter.id)
    try {
      const next: Chapter = { ...chapter, status, completed_on: status === 'Done' || status === 'Revised' ? chapter.completed_on ?? indiaToday() : null, updated_at: now }
      await persistChapterStatus(next, chapter)
      if (status === 'Done' || status === 'Revised') notify(`${chapter.name} marked complete. Your revision dates are in the diary.`)
      else if (chapter.status === 'Done' || chapter.status === 'Revised') notify(`${chapter.name} is back in progress.`)
      else notify(`Status updated for ${chapter.name}.`)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update chapter. Retry.', 'error') }
    finally { setBusy(null) }
  }

  const moveChapter = async (chapter: Chapter, direction: -1 | 1) => {
    const group = data.chapters.filter(item => item.subject === chapter.subject).sort((a, b) => a.position - b.position)
    const index = group.findIndex(item => item.id === chapter.id)
    const destination = index + direction
    if (destination < 0 || destination >= group.length) return
    const sibling = group[destination]
    if (!sibling) return
    try {
      await upsertMany('chapters', [
        { ...chapter, position: sibling.position, updated_at: new Date().toISOString() },
        { ...sibling, position: chapter.position, updated_at: new Date().toISOString() }
      ])
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not reorder chapter.', 'error') }
  }

  const dropChapter = async (target: Chapter) => {
    if (!draggedId || draggedId === target.id) return
    const dragged = data.chapters.find(item => item.id === draggedId)
    if (!dragged || dragged.subject !== target.subject) { setDraggedId(null); return }
    const ordered = data.chapters.filter(item => item.subject === target.subject).sort((a, b) => a.position - b.position)
    const from = ordered.findIndex(item => item.id === dragged.id)
    const to = ordered.findIndex(item => item.id === target.id)
    const [moved] = ordered.splice(from, 1)
    if (moved) ordered.splice(to, 0, moved)
    try { await upsertMany('chapters', ordered.map((item, position) => ({ ...item, position, updated_at: new Date().toISOString() }))) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not reorder chapter.', 'error') }
    setDraggedId(null)
  }

  const saveChapter = async (chapter: Chapter) => {
    if (!chapter.name.trim()) { notify('Chapter name is required.', 'error'); return }
    const sameName = data.chapters.some(item => item.id !== chapter.id && item.subject === chapter.subject && item.name.trim().toLowerCase() === chapter.name.trim().toLowerCase())
    if (sameName) { notify('That chapter already exists in this subject.', 'error'); return }
    const previous = data.chapters.find(item => item.id === chapter.id)
    const position = previous ? previous.position : data.chapters.filter(item => item.subject === chapter.subject).length
    const next = { ...chapter, name: chapter.name.trim(), position, completed_on: chapter.status === 'Done' || chapter.status === 'Revised' ? chapter.completed_on ?? indiaToday() : null, updated_at: new Date().toISOString() }
    try {
      await persistChapterStatus(next, previous)
      notify('Chapter saved to your syllabus.')
      setEditing(null); setCreateSubject(null)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save chapter. Retry.', 'error') }
  }

  const deleteChapter = async () => {
    if (!deleteTarget || deletingChapterRef.current) return
    deletingChapterRef.current = true
    setDeletingChapter(true)
    try { await remove('chapters', deleteTarget); notify('Chapter removed. Use Undo if that was a slip.'); setDeleteTarget(null) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not delete chapter.', 'error') }
    finally { deletingChapterRef.current = false; setDeletingChapter(false) }
  }

  const subjectCounts = SUBJECTS.map(subject => {
    const rows = data.chapters.filter(item => item.subject === subject)
    const complete = rows.filter(item => item.status === 'Done' || item.status === 'Revised').length
    const colors: Record<Subject, string> = { Physics: 'var(--subject-physics)', Chemistry: 'var(--subject-chemistry)', Maths: 'var(--subject-maths)' }
    return { subject, total: rows.length, complete, color: colors[subject] }
  })

  return <div className="content-page syllabus-page">
    <PageHeader eyebrow="THE MAP, NOT THE DESTINATION" title="Syllabus" subtitle="Make the big list feel smaller. Keep track of what’s next." doodle={<span>✎</span>} action={<Button onClick={() => setCreateSubject('Physics')}><Plus size={17} /> Add chapter</Button>} />
    <div className="syllabus-progress-strip">{subjectCounts.map(item => <NotebookCard key={item.subject} className={`subject-progress-card subject-progress-${item.subject.toLowerCase()}`}><div className="subject-progress-top"><SubjectBadge subject={item.subject} withMark /><span><strong>{item.complete}</strong> / {item.total} done</span></div><ProgressBar value={item.total ? item.complete / item.total * 100 : 0} color={item.color} /><span className="subject-progress-foot">{item.total ? Math.round(item.complete / item.total * 100) : 0}% mapped</span></NotebookCard>)}</div>
    <NotebookCard className="syllabus-board">
      <div className="board-heading"><div><span className="handwriting-label">Your study map</span><p>{data.chapters.length} chapters across three subjects. Move at your own pace.</p></div><span className="board-doodle" aria-hidden="true">✳</span></div>
      <div className="syllabus-filters">
        <div className="search-field syllabus-search"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a chapter or note…" aria-label="Search chapters and notes" />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}</div>
        <div className="filter-controls">
          <select aria-label="Filter subject" value={subjectFilter} onChange={event => setSubjectFilter(event.target.value as 'all' | Subject)}><option value="all">All subjects</option>{SUBJECTS.map(subject => <option key={subject}>{subject}</option>)}</select>
          <select aria-label="Filter status" value={statusFilter} onChange={event => setStatusFilter(event.target.value as 'all' | ChapterStatus)}><option value="all">All statuses</option>{STATUSES.map(status => <option key={status}>{status}</option>)}</select>
          <details className="filter-popover"><summary><Filter size={15} /> More filters <ChevronDown size={13} /></summary><div className="filter-popover-body"><label>Priority<select value={priorityFilter} onChange={event => setPriorityFilter(event.target.value as 'all' | Priority)}><option value="all">Any priority</option>{PRIORITIES.map(item => <option key={item}>{item}</option>)}</select></label><label>Performance<select value={strengthFilter} onChange={event => setStrengthFilter(event.target.value as StrengthFilter)}><option value="all">Any performance</option><option>Weak</option><option>Okay</option><option>Strong</option></select></label><label>Test history<select value={testedFilter} onChange={event => setTestedFilter(event.target.value as 'all' | 'tested' | 'untested')}><option value="all">Any</option><option value="tested">Tested</option><option value="untested">Untested</option></select></label></div></details>
          {(search || subjectFilter !== 'all' || statusFilter !== 'all' || priorityFilter !== 'all' || strengthFilter !== 'all' || testedFilter !== 'all') && <button className="clear-filter" onClick={clearFilters}>Clear</button>}
        </div>
      </div>
      <div className="syllabus-table-head"><span>CHAPTER / SUBJECT</span><span>STATUS</span><span>PRIORITY</span><span>TEST SIGNAL</span><span>ORDER</span></div>
      <div className="chapter-list">
        {filtered.map(item => <ChapterRow key={item.chapter.id} item={item} dragged={draggedId === item.chapter.id} busy={busy === item.chapter.id} onEdit={() => setEditing(item.chapter)} onDelete={() => setDeleteTarget(item.chapter)} onStatus={status => void changeStatus(item.chapter, status)} onMove={direction => void moveChapter(item.chapter, direction)} onDragStart={() => setDraggedId(item.chapter.id)} onDragEnd={() => setDraggedId(null)} onDrop={() => void dropChapter(item.chapter)} />)}
        {filtered.length === 0 && <EmptyState icon={<Search size={24} />} title="No chapters found." description="Try a different search or loosen one of the filters." action={<Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>} />}
      </div>
      <div className="syllabus-board-footer"><span><GripVertical size={15} /> Drag rows to reorder within a subject</span><span>{filtered.length} showing</span></div>
    </NotebookCard>
    {editing && <ChapterDialog chapter={editing} onClose={() => setEditing(null)} onSave={saveChapter} />}
    {createSubject && <ChapterDialog chapter={{ id: createId(), user_id: data.profile?.user_id, subject: createSubject, name: '', position: data.chapters.filter(item => item.subject === createSubject).length, status: 'Not Started', priority: 'Medium', weightage: null, notes: '', formula_notes: '', completed_on: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }} onClose={() => setCreateSubject(null)} onSave={saveChapter} isNew />}
    {deleteTarget && <ConfirmDialog title={`Remove “${deleteTarget.name}”?`} message="Its revision schedule will also be removed; linked notes may be affected. You can undo the removal briefly." onCancel={() => setDeleteTarget(null)} onConfirm={() => void deleteChapter()} loading={deletingChapter} />}
  </div>
}

function ChapterRow({ item, dragged, busy, onEdit, onDelete, onStatus, onMove, onDragStart, onDragEnd, onDrop }: {
  item: ReturnType<typeof getChapterPerformance>[number]; dragged: boolean; busy: boolean; onEdit: () => void; onDelete: () => void;
  onStatus: (status: ChapterStatus) => void; onMove: (direction: -1 | 1) => void; onDragStart: () => void; onDragEnd: () => void; onDrop: () => void
}) {
  const { chapter, classification, results, dropping, average } = item
  return <article className={`chapter-row ${dragged ? 'chapter-dragging' : ''} subject-row-${chapter.subject.toLowerCase()}`} draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); onDrop() }}>
    <div className="chapter-main"><span className="chapter-grip" aria-hidden="true"><GripVertical size={15} /></span><span className="chapter-subject-mark" aria-hidden="true" /><div className="chapter-title-group"><strong>{chapter.name}</strong><div className="chapter-inline-meta"><SubjectBadge subject={chapter.subject} /><span className={`priority-label label-${chapter.priority.toLowerCase()}`}>{chapter.priority} priority</span>{chapter.weightage && <span className="weightage-label">{chapter.weightage}</span>}</div></div></div>
    <div className="chapter-status-cell"><select aria-label={`Status for ${chapter.name}`} value={chapter.status} disabled={busy} onChange={event => onStatus(event.target.value as ChapterStatus)}>{STATUSES.map(status => <option key={status}>{status}</option>)}</select></div>
    <div className="chapter-priority-cell"><span className={`priority-indicator priority-${chapter.priority.toLowerCase()}`}><CircleDot size={13} />{chapter.priority}</span></div>
    <div className="chapter-test-cell">{classification === 'Untested' ? <StatusBadge tone="muted">Untested</StatusBadge> : <StatusBadge tone={classification}>{classification} · {Math.round(average ?? 0)}%</StatusBadge>}{dropping && <StatusBadge tone="dropping">Dropping</StatusBadge>}<small>{results.length ? `${results.length} test${results.length === 1 ? '' : 's'}` : 'No usable score'}</small></div>
    <div className="chapter-actions"><button onClick={() => onMove(-1)} aria-label={`Move ${chapter.name} earlier`}><ArrowUp size={14} /></button><button onClick={() => onMove(1)} aria-label={`Move ${chapter.name} later`}><ArrowDown size={14} /></button><button onClick={onEdit} aria-label={`Edit ${chapter.name}`}><Edit3 size={14} /></button><button onClick={onDelete} aria-label={`Delete ${chapter.name}`}><Trash2 size={14} /></button></div>
  </article>
}

function ChapterDialog({ chapter: initial, onClose, onSave, isNew = false }: { chapter: Chapter; onClose: () => void; onSave: (chapter: Chapter) => Promise<void>; isNew?: boolean }) {
  const [chapter, setChapter] = useState(initial)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const set = <K extends keyof Chapter>(key: K, value: Chapter[K]) => setChapter(current => ({ ...current, [key]: value }))
  const save = async () => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try { await onSave(chapter) }
    finally { savingRef.current = false; setSaving(false) }
  }
  return <Dialog title={isNew ? 'Add a chapter' : 'Chapter notes'} subtitle="A good study map leaves space for your own thinking." onClose={onClose} className="chapter-dialog">
    <div className="form-stack">
      <div className="form-grid two"><Field label="Chapter name" required><input autoFocus maxLength={140} value={chapter.name} onChange={event => set('name', event.target.value)} placeholder="e.g. Centre of Mass" /></Field><Field label="Subject"><select value={chapter.subject} onChange={event => set('subject', event.target.value as Subject)}>{SUBJECTS.map(subject => <option key={subject}>{subject}</option>)}</select></Field></div>
      <div className="form-grid three"><Field label="Status"><select value={chapter.status} onChange={event => set('status', event.target.value as ChapterStatus)}>{STATUSES.map(status => <option key={status}>{status}</option>)}</select></Field><Field label="Priority"><select value={chapter.priority} onChange={event => set('priority', event.target.value as Priority)}>{PRIORITIES.map(priority => <option key={priority}>{priority}</option>)}</select></Field><Field label="Weightage (optional)"><input maxLength={80} value={chapter.weightage ?? ''} onChange={event => set('weightage', event.target.value || null)} placeholder="e.g. 4–6 questions" /></Field></div>
      <Field label="Study notes"><textarea rows={3} maxLength={20000} value={chapter.notes} onChange={event => set('notes', event.target.value)} placeholder="What do you want to remember about this chapter?" /></Field>
      <Field label="Formulas & shortcuts"><textarea rows={3} maxLength={20000} value={chapter.formula_notes} onChange={event => set('formula_notes', event.target.value)} placeholder="Useful formulas, conditions, shortcuts…" /></Field>
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button loading={saving} onClick={() => void save()}>{saving ? 'Saving…' : isNew ? 'Add chapter' : 'Save notes'} <Check size={16} /></Button></div>
    </div>
  </Dialog>
}
