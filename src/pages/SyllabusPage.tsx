import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Check, ChevronDown, CircleDot, ClipboardPaste, Edit3, Filter, GripVertical, NotebookPen, Plus, Search, Trash2, X } from 'lucide-react'
import { Button, ConfirmDialog, Dialog, EmptyState, Field, NotebookCard, OverflowMenu, PageHeader, ProgressBar, StatusBadge, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { getChapterPerformance } from '../lib/analytics'
import { createId } from '../lib/id'
import { indiaToday, plusDays } from '../lib/date'
import type { Chapter, ChapterImportance, ChapterStatus, Priority, Subject } from '../types'
import { ChapterStageEditor } from '../components/jee/ChapterStageEditor'
import { useExamSubjects, useReportSubjects } from '../lib/exams/useExamSubjects'
import { subjectColor, subjectSlug } from '../lib/exams/subjects'
import { stableChapterOrder } from '../lib/syllabus-order'
import { hasChapterNote } from '../lib/syllabus'
import { T } from '../lib/student-layout/T'
import { usePageSlots } from '../lib/student-layout/use-layout'

const STATUSES: ChapterStatus[] = ['Not Started', 'Studying', 'Done', 'Revised']

const PRIORITIES: Priority[] = ['High', 'Medium', 'Low']

type StrengthFilter = 'all' | 'Weak' | 'Okay' | 'Strong'

export default function SyllabusPage() {
  const sl = usePageSlots('syllabus')
  const subjectList = useReportSubjects()
  const examSubjectList = useExamSubjects()
  const { data, upsert, upsertMany, remove } = useData()
  const { notify } = useToast()
  // Stable order: subject (exam order), then the student's own position, then name. A status
  // change or save never moves a row into another subject's block.
  const performance = useMemo(() => stableChapterOrder(getChapterPerformance(data), subjectList), [data, subjectList])
  const [searchParams, setSearchParams] = useSearchParams()
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [subjectFilter, setSubjectFilter] = useState<'all' | Subject>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ChapterStatus>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all')
  const [strengthFilter, setStrengthFilter] = useState<StrengthFilter>('all')
  const [testedFilter, setTestedFilter] = useState<'all' | 'tested' | 'untested'>('all')
  const [editing, setEditing] = useState<Chapter | null>(null)
  const [createSubject, setCreateSubject] = useState<Subject | null>(null)
  const [pasting, setPasting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Chapter | null>(null)
  const [deletingChapter, setDeletingChapter] = useState(false)
  const deletingChapterRef = useRef(false)
  const [busy, setBusy] = useState<string | null>(null)
  // Pointer-based drag reordering (touch and mouse), driven from the row's grip handle.
  const [dragActiveId, setDragActiveId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const dropTargetRef = useRef<string | null>(null)
  const dragRef = useRef<{ chapterId: string; pointerId: number; active: boolean; startX: number; startY: number } | null>(null)
  const lastPointer = useRef({ x: 0, y: 0 })
  const autoScrollRef = useRef<number | null>(null)

  useEffect(() => {
    dropTargetRef.current = dropTargetId
  }, [dropTargetId])

  useEffect(() => () => { if (autoScrollRef.current !== null) cancelAnimationFrame(autoScrollRef.current) }, [])

  // Deep link from Weak areas and elsewhere: /syllabus?chapter=<id> clears filters, scrolls to
  // that chapter and highlights it. The param stays until the chapter has loaded.
  useEffect(() => {
    const chapterParam = searchParams.get('chapter')
    if (!chapterParam) return
    const target = data.chapters.find(chapter => chapter.id === chapterParam)
    if (!target) return
    setSearch(''); setSubjectFilter('all'); setStatusFilter('all'); setPriorityFilter('all'); setStrengthFilter('all'); setTestedFilter('all')
    setHighlightId(target.id)
    const params = new URLSearchParams(searchParams); params.delete('chapter'); setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams, data.chapters])
  useEffect(() => {
    if (!highlightId) return
    const row = document.getElementById(`chapter-row-${highlightId}`)
    if (!row) return
    row.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    row.focus({ preventScroll: true })
  }, [highlightId])

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
      if (status === 'Done' || status === 'Revised') notify(`${chapter.name} marked done. Revisions scheduled.`)
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

  /** Persist a new order for one subject: `draggedId` lands at `targetId`'s slot. */
  const reorderChapters = useCallback(async (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return
    const dragged = data.chapters.find(item => item.id === draggedId)
    const target = data.chapters.find(item => item.id === targetId)
    if (!dragged || !target || dragged.subject !== target.subject) return
    const ordered = data.chapters.filter(item => item.subject === target.subject).sort((a, b) => a.position - b.position)
    const from = ordered.findIndex(item => item.id === dragged.id)
    const to = ordered.findIndex(item => item.id === target.id)
    const [moved] = ordered.splice(from, 1)
    if (moved) ordered.splice(to, 0, moved)
    try { await upsertMany('chapters', ordered.map((item, position) => ({ ...item, position, updated_at: new Date().toISOString() }))) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not reorder chapter.', 'error') }
  }, [data.chapters, notify, upsertMany])

  const updateDropTarget = useCallback((x: number, y: number) => {
    const state = dragRef.current
    if (!state?.active) return
    const element = document.elementFromPoint(x, y)?.closest('[data-chapter-row]')
    const id = element?.getAttribute('data-chapter-row')
    const target = id ? data.chapters.find(item => item.id === id) ?? null : null
    const dragged = data.chapters.find(item => item.id === state.chapterId)
    const valid = target && dragged && target.subject === dragged.subject && target.id !== dragged.id
    setDropTargetId(valid ? target.id : null)
  }, [data.chapters])

  const beginChapterDrag = (event: React.PointerEvent, chapter: Chapter) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    dragRef.current = { chapterId: chapter.id, pointerId: event.pointerId, active: false, startX: event.clientX, startY: event.clientY }
    lastPointer.current = { x: event.clientX, y: event.clientY }
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch { /* capture is best-effort */ }
  }

  const moveChapterDrag = (event: React.PointerEvent) => {
    const state = dragRef.current
    if (!state || state.pointerId !== event.pointerId) return
    lastPointer.current = { x: event.clientX, y: event.clientY }
    if (!state.active) {
      const moved = Math.abs(event.clientX - state.startX) > 6 || Math.abs(event.clientY - state.startY) > 6
      if (!moved) return
      state.active = true
      setDragActiveId(state.chapterId)
      try { navigator.vibrate?.(8) } catch { /* haptics are optional */ }
      if (autoScrollRef.current === null) {
        const step = () => {
          autoScrollRef.current = requestAnimationFrame(step)
          if (!dragRef.current?.active) return
          const edge = 72
          const y = lastPointer.current.y
          if (y < edge) window.scrollBy(0, -Math.min(14, (edge - y) / 4 + 4))
          else if (y > window.innerHeight - edge) window.scrollBy(0, Math.min(14, (y - (window.innerHeight - edge)) / 4 + 4))
          updateDropTarget(lastPointer.current.x, lastPointer.current.y)
        }
        autoScrollRef.current = requestAnimationFrame(step)
      }
    }
    event.preventDefault()
    updateDropTarget(event.clientX, event.clientY)
  }

  const endChapterDrag = (event: React.PointerEvent) => {
    const state = dragRef.current
    if (!state || state.pointerId !== event.pointerId) return
    dragRef.current = null
    if (autoScrollRef.current !== null) { cancelAnimationFrame(autoScrollRef.current); autoScrollRef.current = null }
    if (state.active) {
      const targetId = dropTargetRef.current
      setDragActiveId(null)
      setDropTargetId(null)
      if (targetId) void reorderChapters(state.chapterId, targetId)
    }
    setDragActiveId(null)
    setDropTargetId(null)
  }

  const cancelChapterDrag = () => {
    dragRef.current = null
    if (autoScrollRef.current !== null) { cancelAnimationFrame(autoScrollRef.current); autoScrollRef.current = null }
    setDragActiveId(null)
    setDropTargetId(null)
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

  /**
   * Paste a whole chapter list at once. Typing 64 JEE chapters (or a CA syllabus) one dialog
   * at a time was the single biggest setup cost in the app, especially for non-JEE exams that
   * start with an empty syllabus. Duplicates are skipped by name within the subject.
   */
  const importChapters = async (subject: Subject, names: string[]) => {
    const existing = new Set(data.chapters.filter(chapter => chapter.subject === subject).map(chapter => chapter.name.trim().toLowerCase()))
    const fresh: string[] = []
    for (const raw of names) {
      const name = raw.trim().slice(0, 140)
      if (!name || existing.has(name.toLowerCase())) continue
      existing.add(name.toLowerCase())
      fresh.push(name)
    }
    if (!fresh.length) return 0
    const now = new Date().toISOString()
    const base = data.chapters.filter(chapter => chapter.subject === subject).length
    await upsertMany('chapters', fresh.map((name, index) => ({
      id: createId(), user_id: data.profile?.user_id, subject, name, position: base + index,
      status: 'Not Started' as const, priority: 'Medium' as const, importance: 'medium' as const,
      weightage: null, notes: '', formula_notes: '', completed_on: null, created_at: now, updated_at: now
    })))
    return fresh.length
  }

  const deleteChapter = async () => {
    if (!deleteTarget || deletingChapterRef.current) return
    deletingChapterRef.current = true
    setDeletingChapter(true)
    try { await remove('chapters', deleteTarget); notify('Chapter removed. Use Undo if that was a slip.'); setDeleteTarget(null) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not delete chapter.', 'error') }
    finally { deletingChapterRef.current = false; setDeletingChapter(false) }
  }

  const subjectCounts = subjectList.map(subject => {
    const rows = data.chapters.filter(item => item.subject === subject)
    const complete = rows.filter(item => item.status === 'Done' || item.status === 'Revised').length
    const studying = rows.filter(item => item.status === 'Studying').length
    return { subject, total: rows.length, complete, studying, color: subjectColor(subject) }
  })
  // Summary cards only for subjects with chapters; long catalogues (CUET, school) would otherwise show every option.
  const stripCounts = subjectCounts.filter(item => item.total > 0)

  return <div className="content-page syllabus-page">
    <PageHeader layoutId="syllabus.header" title="Syllabus" doodle={<span>✎</span>} action={<div className="syllabus-header-actions"><Button variant="secondary" onClick={() => setPasting(true)}><ClipboardPaste size={16} />{' '}<T k="syllabus:paste-list">{"Paste list"}</T></Button><Button onClick={() => setCreateSubject(examSubjectList[0] ?? 'Physics')}><Plus size={17} />{' '}<T k="syllabus:add-chapter">{"Add chapter"}</T></Button></div>} />
    {stripCounts.length > 0 && <div className="syllabus-progress-strip">{stripCounts.map(item => <NotebookCard key={item.subject} className={`subject-progress-card subject-progress-${subjectSlug(item.subject)}`}><div className="subject-progress-top"><SubjectBadge subject={item.subject} withMark /><span><strong>{item.complete}</strong> / {item.total} done{item.studying > 0 ? ` · ${item.studying} studying` : ''}</span></div><ProgressBar value={item.total ? item.complete / item.total * 100 : 0} color={item.color} /><span className="subject-progress-foot">{item.total ? Math.round(item.complete / item.total * 100) : 0}% mapped</span></NotebookCard>)}</div>}
    <NotebookCard {...sl.attrs('board')} className="syllabus-board">
      <div className="board-heading"><div><span className="handwriting-label"><T k="syllabus:your-study-map">{"Your chapters"}</T></span><p>{data.chapters.length} chapter{data.chapters.length === 1 ? '' : 's'} across {stripCounts.length} subject{stripCounts.length === 1 ? '' : 's'}.</p></div><span className="board-doodle" aria-hidden="true">✳</span></div>
      <div className="syllabus-filters">
        <div className="search-field syllabus-search"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} onInput={event => setSearch((event.target as HTMLInputElement).value)} placeholder="Find a chapter or note…" aria-label="Search chapters and notes" />{search.trim() ? <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button> : null}</div>
        <div className="filter-controls">
          <select aria-label="Filter subject" value={subjectFilter} onChange={event => setSubjectFilter(event.target.value as 'all' | Subject)}><option value="all">All subjects</option>{subjectList.map(subject => <option key={subject}>{subject}</option>)}</select>
          <select aria-label="Filter status" value={statusFilter} onChange={event => setStatusFilter(event.target.value as 'all' | ChapterStatus)}><option value="all">All statuses</option>{STATUSES.map(status => <option key={status}>{status}</option>)}</select>
          <details className="filter-popover"><summary><Filter size={15} />{' '}<T k="syllabus:more-filters">{"More filters"}</T>{' '}<ChevronDown size={13} /></summary><div className="filter-popover-body"><label><T k="syllabus:priority">{"Priority"}</T><select value={priorityFilter} onChange={event => setPriorityFilter(event.target.value as 'all' | Priority)}><option value="all">Any priority</option>{PRIORITIES.map(item => <option key={item}>{item}</option>)}</select></label><label><T k="syllabus:performance">{"Performance"}</T><select value={strengthFilter} onChange={event => setStrengthFilter(event.target.value as StrengthFilter)}><option value="all">Any performance</option><option>Weak</option><option>Okay</option><option>Strong</option></select></label><label><T k="syllabus:test-history">{"Test history"}</T><select value={testedFilter} onChange={event => setTestedFilter(event.target.value as 'all' | 'tested' | 'untested')}><option value="all">Any</option><option value="tested">Tested</option><option value="untested">Untested</option></select></label></div></details>
          {(search.trim() || subjectFilter !== 'all' || statusFilter !== 'all' || priorityFilter !== 'all' || strengthFilter !== 'all' || testedFilter !== 'all') && <button className="clear-filter" onClick={clearFilters}><T k="syllabus:clear">{"Clear"}</T></button>}
        </div>
      </div>
      <div className="syllabus-table-head"><span><T k="syllabus:chapter-subject">{"CHAPTER / SUBJECT"}</T></span><span><T k="syllabus:status">{"STATUS"}</T></span><span><T k="syllabus:priority-2">{"PRIORITY"}</T></span><span><T k="syllabus:test-signal">{"TEST SIGNAL"}</T></span><span><T k="syllabus:order">{"ORDER"}</T></span></div>
      <div className="chapter-list">
        {filtered.map(item => {
          const subjectGroup = data.chapters.filter(chapter => chapter.subject === item.chapter.subject).sort((a, b) => a.position - b.position)
          const index = subjectGroup.findIndex(chapter => chapter.id === item.chapter.id)
          return <ChapterRow
            key={item.chapter.id}
            item={item}
            highlighted={highlightId === item.chapter.id}
            dragged={dragActiveId === item.chapter.id}
            dropTarget={dropTargetId === item.chapter.id}
            busy={busy === item.chapter.id}
            canMoveUp={index > 0}
            canMoveDown={index >= 0 && index < subjectGroup.length - 1}
            onEdit={() => setEditing(item.chapter)}
            onDelete={() => setDeleteTarget(item.chapter)}
            onStatus={status => void changeStatus(item.chapter, status)}
            onMove={direction => void moveChapter(item.chapter, direction)}
            onDragBegin={event => beginChapterDrag(event, item.chapter)}
            onDragMove={moveChapterDrag}
            onDragEnd={endChapterDrag}
            onDragCancel={cancelChapterDrag}
          />
        })}
        {filtered.length === 0 && (data.chapters.length === 0 ? <EmptyState lk="syllabus:no-chapters-yet" icon={<Search size={24} />} title="No chapters yet." action={<Button variant="secondary" size="sm" onClick={() => setCreateSubject(examSubjectList[0] ?? 'Physics')}><Plus size={15} />{' '}<T k="syllabus:add-chapter">{"Add chapter"}</T></Button>} /> : <EmptyState lk="syllabus:no-chapters-match" icon={<Search size={24} />} title="No chapters match." action={<Button variant="secondary" size="sm" onClick={clearFilters}><T k="syllabus:clear-filters">{"Clear filters"}</T></Button>} />)}
      </div>
      <div className="syllabus-board-footer"><span><GripVertical size={15} />{' '}<T k="syllabus:drag-the-grip-to-reorder-within-a-subjec">{"Drag to reorder chapters."}</T></span><span>{filtered.length} showing</span></div>
    </NotebookCard>
    {pasting && <PasteChaptersDialog subjects={examSubjectList} defaultSubject={subjectFilter !== 'all' ? subjectFilter : examSubjectList[0] ?? 'Physics'} onClose={() => setPasting(false)} onImport={async (subject, names) => {
      try {
        const count = await importChapters(subject, names)
        notify(count ? `${count} chapter${count === 1 ? '' : 's'} added to ${subject}.` : 'Every chapter in that list already exists.')
        if (count) setPasting(false)
      } catch (error) { notify(error instanceof Error ? error.message : 'Could not add the chapters.', 'error') }
    }} />}
    {editing && <ChapterDialog chapter={editing} onClose={() => setEditing(null)} onSave={saveChapter} />}
    {createSubject && <ChapterDialog chapter={{ id: createId(), user_id: data.profile?.user_id, subject: createSubject, name: '', position: data.chapters.filter(item => item.subject === createSubject).length, status: 'Not Started', priority: 'Medium', importance: 'medium', weightage: null, notes: '', formula_notes: '', completed_on: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }} onClose={() => setCreateSubject(null)} onSave={saveChapter} isNew />}
    {deleteTarget && <ConfirmDialog title={`Remove “${deleteTarget.name}”?`} message="Its revisions are removed too. You can undo briefly." onCancel={() => setDeleteTarget(null)} onConfirm={() => void deleteChapter()} loading={deletingChapter} />}
  </div>
}

function ChapterRow({ item, highlighted = false, dragged, dropTarget, busy, canMoveUp, canMoveDown, onEdit, onDelete, onStatus, onMove, onDragBegin, onDragMove, onDragEnd, onDragCancel }: {
  item: ReturnType<typeof getChapterPerformance>[number]; highlighted?: boolean; dragged: boolean; dropTarget: boolean; busy: boolean; canMoveUp: boolean; canMoveDown: boolean;
  onEdit: () => void; onDelete: () => void; onStatus: (status: ChapterStatus) => void; onMove: (direction: -1 | 1) => void;
  onDragBegin: (event: React.PointerEvent) => void; onDragMove: (event: React.PointerEvent) => void; onDragEnd: (event: React.PointerEvent) => void; onDragCancel: () => void
}) {
  const { chapter, classification, results, dropping, average } = item
  return <article
    data-chapter-row={chapter.id}
    id={`chapter-row-${chapter.id}`}
    tabIndex={-1}
    aria-current={highlighted ? 'true' : undefined}
    className={`chapter-row ${dragged ? 'chapter-dragging' : ''} ${dropTarget ? 'chapter-drop-target' : ''} ${highlighted ? 'chapter-highlight' : ''} subject-row-${chapter.subject.toLowerCase()}`}
  >
    <div className="chapter-main">
      <span
        className="chapter-grip"
        role="button"
        tabIndex={0}
        aria-label={`Reorder ${chapter.name} by dragging`}
        title={`Drag to reorder ${chapter.name}`}
        onPointerDown={onDragBegin}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragCancel}
        onKeyDown={event => {
          if (event.key === 'ArrowUp' && canMoveUp) { event.preventDefault(); onMove(-1) }
          if (event.key === 'ArrowDown' && canMoveDown) { event.preventDefault(); onMove(1) }
        }}
      ><GripVertical size={15} /></span>
      <span className="chapter-subject-mark" aria-hidden="true" />
      <div className="chapter-title-group"><div className="chapter-title-heading"><strong>{chapter.name}</strong>{hasChapterNote(chapter) && <span className="chapter-note-mark" title="Has a note" aria-label="Has a note"><NotebookPen size={12} aria-hidden="true" /></span>}</div><div className="chapter-inline-meta"><SubjectBadge subject={chapter.subject} /><span className={`priority-label label-${chapter.priority.toLowerCase()}`}>{chapter.priority} priority</span>{chapter.weightage && <span className="weightage-label">{chapter.weightage}</span>}</div></div>
    </div>
    <div className="chapter-status-cell"><select aria-label={`Status for ${chapter.name}`} value={chapter.status} disabled={busy} onChange={event => onStatus(event.target.value as ChapterStatus)}>{STATUSES.map(status => <option key={status}>{status}</option>)}</select></div>
    <div className="chapter-priority-cell"><span className={`priority-indicator priority-${chapter.priority.toLowerCase()}`}><CircleDot size={13} />{chapter.priority}</span></div>
    <div className="chapter-test-cell">{classification === 'Untested' ? <StatusBadge tone="muted"><T k="syllabus:untested">{"Untested"}</T></StatusBadge> : <StatusBadge tone={classification}>{classification} · {Math.round(average ?? 0)}%</StatusBadge>}{dropping && <StatusBadge tone="dropping"><T k="syllabus:dropping">{"Dropping"}</T></StatusBadge>}<small>{results.length ? `${results.length} test${results.length === 1 ? '' : 's'}` : 'No usable score'}</small></div>
    <div className="chapter-actions">
      <OverflowMenu
        label={`Actions for ${chapter.name}`}
        items={[
          { id: 'edit', label: 'Edit notes', icon: <Edit3 size={15} />, onSelect: onEdit },
          { id: 'up', label: 'Move up', icon: <ArrowUp size={15} />, disabled: !canMoveUp, onSelect: () => onMove(-1) },
          { id: 'down', label: 'Move down', icon: <ArrowDown size={15} />, disabled: !canMoveDown, onSelect: () => onMove(1) },
          { id: 'delete', label: 'Delete chapter', icon: <Trash2 size={15} />, danger: true, onSelect: onDelete }
        ]}
      />
    </div>
  </article>
}

function ChapterDialog({ chapter: initial, onClose, onSave, isNew = false }: { chapter: Chapter; onClose: () => void; onSave: (chapter: Chapter) => Promise<void>; isNew?: boolean }) {
  const dialogSubjects = useExamSubjects(initial.subject)
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
  return <Dialog title={isNew ? 'Add a chapter' : 'Chapter notes'}  onClose={onClose} className="chapter-dialog">
    <div className="form-stack">
      <div className="form-grid two"><Field lk="syllabus:chapter-name" label="Chapter name" required><input autoFocus maxLength={140} value={chapter.name} onChange={event => set('name', event.target.value)} placeholder="e.g. Centre of Mass" /></Field><Field lk="syllabus:subject" label="Subject"><select value={chapter.subject} onChange={event => set('subject', event.target.value as Subject)}>{dialogSubjects.map(subject => <option key={subject}>{subject}</option>)}</select></Field></div>
      <div className="form-grid three"><Field lk="syllabus:status-2" label="Status"><select value={chapter.status} onChange={event => set('status', event.target.value as ChapterStatus)}>{STATUSES.map(status => <option key={status}>{status}</option>)}</select></Field><Field lk="syllabus:priority" label="Priority"><select value={chapter.priority} onChange={event => set('priority', event.target.value as Priority)}>{PRIORITIES.map(priority => <option key={priority}>{priority}</option>)}</select></Field><Field lk="syllabus:weightage-optional" label="Weightage (optional)"><input maxLength={80} value={chapter.weightage ?? ''} onChange={event => set('weightage', event.target.value || null)} placeholder="e.g. 4–6 questions" /></Field></div>
      <Field lk="syllabus:importance-drives-weighted-progress" lk2="syllabus:set-in-settings-exam-weighted-progress-m" label="Importance (drives weighted progress)" hint="Medium by default. Change weights in Settings → Exam."><select value={chapter.importance ?? 'medium'} onChange={event => set('importance', event.target.value as ChapterImportance)}><option value="high">High importance</option><option value="medium">Medium importance</option><option value="low">Low importance</option></select></Field>
      <Field lk="syllabus:study-notes" label="Study notes"><textarea rows={3} maxLength={20000} value={chapter.notes} onChange={event => set('notes', event.target.value)} placeholder="What do you want to remember about this chapter?" /></Field>
      <Field lk="syllabus:formulas-shortcuts" label="Formulas & shortcuts"><textarea rows={3} maxLength={20000} value={chapter.formula_notes} onChange={event => set('formula_notes', event.target.value)} placeholder="Useful formulas, conditions, shortcuts…" /></Field>
      {!isNew && <ChapterStageEditor chapter={chapter} />}
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose} disabled={saving}><T k="syllabus:cancel">{"Cancel"}</T></Button><Button loading={saving} onClick={() => void save()}>{saving ? 'Saving…' : isNew ? 'Add chapter' : 'Save notes'} <Check size={16} /></Button></div>
    </div>
  </Dialog>
}

/** One chapter per line, for a whole subject at once. */
function PasteChaptersDialog({ subjects, defaultSubject, onClose, onImport }: {
  subjects: readonly Subject[]; defaultSubject: Subject; onClose: () => void
  onImport: (subject: Subject, names: string[]) => Promise<void>
}) {
  const [subject, setSubject] = useState<Subject>(defaultSubject)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const names = text.split('\n').map(line => line.replace(/^\s*[-*•\d.]+\s*/, '').trim()).filter(Boolean)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || !names.length) return
    setBusy(true)
    try { await onImport(subject, names.slice(0, 400)) } finally { setBusy(false) }
  }
  return <Dialog lk="syllabus:paste-a-chapter-list" title="Paste a chapter list" subtitle="One chapter per line." onClose={onClose}>
    <form className="form-stack" noValidate onSubmit={submit}>
      <Field lk="syllabus:l-subject" label="Subject"><select value={subject} onChange={event => setSubject(event.target.value)}>{subjects.map(item => <option key={item}>{item}</option>)}</select></Field>
      <Field lk="syllabus:l-chapters" label="Chapters" hint={`${names.length} chapter${names.length === 1 ? '' : 's'} ready · duplicates are skipped`}><textarea rows={9} maxLength={20000} value={text} onChange={event => setText(event.target.value)} placeholder={'Kinematics\nLaws of Motion\nWork, Energy & Power'} /></Field>
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} disabled={!names.length}>Add {names.length || ''} chapter{names.length === 1 ? '' : 's'}</Button></div>
    </form>
  </Dialog>
}
