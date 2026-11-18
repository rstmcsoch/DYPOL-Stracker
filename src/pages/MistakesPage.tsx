import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { AlertTriangle, ArrowUpRight, Camera, CheckCircle2, CirclePlus, ImagePlus, Layers, NotebookPen, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { Button, ConfirmDialog, Dialog, EmptyState, Field, NotebookCard, PageHeader, StatusBadge, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { indiaDate, indiaToday, prettyDate } from '../lib/date'
import { createId } from '../lib/id'
import type { ErrorCategory, Mistake, Subject } from '../types'
import { useExamSubjects, useReportSubjects } from '../lib/exams/useExamSubjects'
import { mistakeSubjectOptions } from '../lib/exams/subjects'
import { MISTAKE_CAUSES, causeOf, startRetry, typeForCause } from '../lib/mistake-cause'
import { RetryPanel } from '../components/jee/RetryPanel'
import { T } from '../lib/student-layout/T'
import { usePageSlots } from '../lib/student-layout/use-layout'

const mistakeSchema = z.object({ chapter_id: z.string().uuid(), mistake_type: z.enum(['Concept','Silly','Calculation','Time','Guess']), cause: z.enum(['Silly mistake','Concept gap','Calculation error','Time pressure','Misread question','Guess / bad attempt','Unattempted']).nullable().optional(), question_note: z.string().trim().min(1).max(10000), solution_note: z.string().max(10000) })

export default function MistakesPage() {
  const sl = usePageSlots('mistakes')
  const subjectList = useReportSubjects()
  const { data, upsert, upsertMany, remove } = useData()
  const { notify } = useToast()
  const [search, setSearch] = useState('')
  const [subject, setSubject] = useState<'all' | Subject>('all')
  const [type, setType] = useState<'all' | ErrorCategory>('all')
  // One page, three views: the whole notebook, the retry queue (the old /retry page) and
  // what has already been retried. `?tab=retry` keeps every old /retry link working.
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: 'all' | 'retry' | 'retried' = tabParam === 'retry' || tabParam === 'retried' ? tabParam : 'all'
  const setTab = (next: 'all' | 'retry' | 'retried') => {
    const nextParams = new URLSearchParams(params)
    if (next === 'all') nextParams.delete('tab'); else nextParams.set('tab', next)
    setParams(nextParams, { replace: true })
  }
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Mistake | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Mistake | null>(null)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const term = search.trim().toLowerCase()
  const filtered = useMemo(() => data.mistakes.filter(mistake => {
    const chapter = data.chapters.find(item => item.id === mistake.chapter_id)
    const text = `${mistake.question_note} ${mistake.solution_note} ${mistake.mistake_type} ${chapter?.name ?? ''}`.toLowerCase()
    if (term && !text.includes(term)) return false
    if (subject !== 'all' && chapter?.subject !== subject) return false
    if (type !== 'all' && causeOf(mistake) !== type) return false
    if (tab === 'retried' && mistake.retry_status !== 'retried') return false
    return true
  }).sort((a, b) => b.created_at.localeCompare(a.created_at)), [data.mistakes, data.chapters, term, subject, type, tab])

  const saveMistake = async (record: Mistake): Promise<Record<string, string> | null> => {
    const checked = mistakeSchema.safeParse(record)
    if (!checked.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of checked.error.issues) fieldErrors[String(issue.path[0] ?? 'form')] ??= issue.message
      return fieldErrors
    }
    try { await upsert('mistakes', { ...record, updated_at: new Date().toISOString() }); notify(editing ? 'Mistake note updated.' : 'Saved to your mistake notebook.'); setDialogOpen(false); setEditing(null); return null }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save mistake. Retry.', 'error'); return null }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    try {
      await remove('mistakes', deleteTarget)
      notify('Mistake deleted.')
      setDeleteTarget(null)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not delete this entry.', 'error') }
    finally { deletingRef.current = false; setDeleting(false) }
  }

  /**
   * Close the recall loop: a mistake note becomes a flashcard in the same chapter, with the
   * question as the front and "what I'll remember" as the back. Duplicates are refused so a
   * second tap cannot flood the deck.
   */
  const makeCard = async (mistake: Mistake) => {
    const chapter = data.chapters.find(item => item.id === mistake.chapter_id)
    if (!chapter) { notify('That chapter was removed, so there is nowhere to file the card.', 'error'); return }
    const front = mistake.question_note.trim().slice(0, 4900)
    const existing = data.studyCards.find(card => card.chapter_id === chapter.id && card.kind === 'flashcard' && card.front.trim() === front)
    if (existing) { notify(`Already in ${chapter.name} — this note is a card already.`); return }
    const now = new Date().toISOString()
    try {
      await upsertMany('study_cards', [{
        id: createId(), chapter_id: chapter.id, kind: 'flashcard', front,
        back: (mistake.solution_note.trim() || `Cause: ${causeOf(mistake)}`).slice(0, 9900),
        hint: '', position: data.studyCards.filter(card => card.chapter_id === chapter.id).length,
        difficulty: null, reviews: 0, last_reviewed_at: null, next_review_at: null,
        last_rating: null, created_at: now, updated_at: now
      }])
      notify(`Flashcard added to ${chapter.name}. It will show up in Reviews.`)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not create the card.', 'error') }
  }

  const setRetry = async (mistake: Mistake, next: Partial<Mistake>, message: string) => {
    try { await upsert('mistakes', { ...mistake, ...next, updated_at: new Date().toISOString() }); notify(message) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not update retry status.', 'error') }
  }

  const readyCount = data.mistakes.filter(item => item.retry_later && item.retry_status === 'pending').length
  const retriedCount = data.mistakes.filter(item => item.retry_status === 'retried').length

  return <div className="content-page mistakes-page">
    <PageHeader layoutId="mistakes.header" title="Mistake notebook" doodle={<span>✎</span>} action={<Button onClick={() => { setEditing(null); setDialogOpen(true) }}><CirclePlus size={17} />{' '}<T k="mistakes:add-a-mistake">{"Add a mistake"}</T></Button>} />
    {!sl.hidden('overview') && <div {...sl.attrs('overview')} className="mistake-overview-row"><NotebookCard className="mistake-stat-note"><div className="mistake-stat-icon"><NotebookPen size={18} /></div><div><strong>{data.mistakes.length}</strong><span><T k="mistakes:notes-in-your-notebook">{"notes in your notebook"}</T></span></div><span className="note-corner-doodle">✦</span></NotebookCard><NotebookCard className="mistake-stat-note retry-stat"><div className="mistake-stat-icon"><RotateCcw size={18} /></div><div><strong>{readyCount}</strong><span><T k="mistakes:ready-to-retry">{"ready to retry"}</T></span></div><button onClick={() => setTab('retry')}><T k="mistakes:open-retry-list">{"Open retry list"}</T>{' '}<ArrowUpRight size={14} /></button></NotebookCard><NotebookCard className="mistake-stat-note mistake-stat-help"><AlertTriangle size={17} /><p><T k="mistakes:record-the">{"Record the"}</T>{' '}<em><T k="mistakes:why">{"why"}</T></em>{' '}<T k="mistakes:as-carefully-as-the-answer-patterns-emer">{"too, not just the answer."}</T></p></NotebookCard></div>}
    <div className="mistake-tabs" role="tablist" aria-label="Mistake notebook views">
      <button role="tab" id="mistakes-tab-all" aria-selected={tab === 'all'} aria-controls="mistakes-panel-all" className={tab === 'all' ? 'is-active' : ''} onClick={() => setTab('all')}><NotebookPen size={15} /> Notebook <span>{data.mistakes.length}</span></button>
      <button role="tab" id="mistakes-tab-retry" aria-selected={tab === 'retry'} aria-controls="mistakes-panel-retry" className={tab === 'retry' ? 'is-active' : ''} onClick={() => setTab('retry')}><RotateCcw size={15} /> Retry list <span>{readyCount}</span></button>
      <button role="tab" id="mistakes-tab-retried" aria-selected={tab === 'retried'} aria-controls="mistakes-panel-retried" className={tab === 'retried' ? 'is-active' : ''} onClick={() => setTab('retried')}><CheckCircle2 size={15} /> Retried <span>{retriedCount}</span></button>
    </div>
    {tab === 'retry' ? <section role="tabpanel" id="mistakes-panel-retry" aria-labelledby="mistakes-tab-retry" {...sl.attrs('retry')} hidden={sl.hidden('retry')}>
      <RetryPanel layout="embedded" onBrowseNotebook={() => setTab('all')} />
    </section> : <section role="tabpanel" id={`mistakes-panel-${tab}`} aria-labelledby={`mistakes-tab-${tab}`}>
    <NotebookCard {...sl.attrs('board')} className="mistake-board">
      <div className="mistake-toolbar"><div className="search-field"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search question notes…" aria-label="Search mistake notes" />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}</div><select aria-label="Filter subject" value={subject} onChange={event => setSubject(event.target.value as 'all' | Subject)}><option value="all">All subjects</option>{subjectList.map(item => <option key={item}>{item}</option>)}</select><select aria-label="Filter mistake type" value={type} onChange={event => setType(event.target.value as 'all' | ErrorCategory)}><option value="all">All causes</option>{MISTAKE_CAUSES.map(item => <option key={item}>{item}</option>)}</select></div>
      {filtered.length === 0 ? <EmptyState icon={<NotebookPen size={25} />} title={tab === 'retried' ? 'Nothing retried yet.' : data.mistakes.length ? 'No notes match.' : 'No mistakes logged yet.'} action={<Button variant="secondary" size="sm" onClick={() => data.mistakes.length ? (setSearch(''), setSubject('all'), setType('all')) : setDialogOpen(true)}>{data.mistakes.length ? 'Clear filters' : <><CirclePlus size={15} /> Add your first note</>}</Button>} /> : <div className="mistake-card-grid">{filtered.map(mistake => {
        const chapter = data.chapters.find(item => item.id === mistake.chapter_id)
        const linkedTest = data.tests.find(item => item.id === mistake.test_id)
        const image = mistake.image_data ?? mistake.image_preview
        return <article className="mistake-entry-card" key={mistake.id}>
          <div className="mistake-entry-top"><span className={`mistake-type-chip mistake-${mistake.mistake_type.toLowerCase()}`} title={`Cause: ${causeOf(mistake)}`}>{causeOf(mistake)}</span><span className="mistake-entry-date">{prettyDate(indiaDate(mistake.created_at), { day: 'numeric', month: 'short' })}</span><button className="mistake-delete-button" onClick={() => setDeleteTarget(mistake)} aria-label="Delete mistake note"><Trash2 size={15} /></button></div>
          <div className="mistake-entry-tags">{chapter ? <><SubjectBadge subject={chapter.subject} /><span>{chapter.name}</span></> : <StatusBadge tone="weak"><T k="mistakes:chapter-removed">{"Chapter removed"}</T></StatusBadge>}{linkedTest && <span className="linked-test-label">From {linkedTest.title}</span>}</div>
          <h3>{mistake.question_note}</h3>
          {mistake.solution_note && <div className="mistake-solution"><span><T k="mistakes:what-ill-remember">{"WHAT I’LL REMEMBER"}</T></span><p>{mistake.solution_note}</p></div>}
          {image && <button className="mistake-image-preview" onClick={() => setLightbox(image)} aria-label="Open attached image"><img src={image} alt="Attached question or working" loading="lazy" /><span><ImagePlus size={14} />{' '}<T k="mistakes:view-image">{"View image"}</T></span></button>}
          <div className="mistake-entry-bottom"><span>{mistake.retry_status === 'retried' ? <StatusBadge tone="Strong"><T k="mistakes:retried">{"Retried"}</T></StatusBadge> : mistake.retry_later ? <StatusBadge tone="Okay"><T k="mistakes:retry-later">{"Retry later"}</T></StatusBadge> : <StatusBadge tone="muted"><T k="mistakes:notebook">{"Notebook"}</T></StatusBadge>}</span><div>{mistake.retry_status === 'pending' && <><button className="mistake-row-action" onClick={() => void setRetry(mistake, mistake.retry_later ? { retry_later: false, retry_due_on: null } : { retry_later: true, retry_status: 'pending', ...startRetry(indiaToday(), mistake.retry_count ?? 0) }, mistake.retry_later ? 'Removed from the retry list.' : 'Added to your retry list — it comes back for a spaced second pass.')}>{mistake.retry_later ? 'Keep in notes' : 'Retry later'}</button>{mistake.retry_later && <button className="mistake-row-action" onClick={() => void setRetry(mistake, { retry_later: false, retry_status: 'retried' }, 'Marked retried — that’s how a slip turns into recall.')}>Mark retried</button>}</>}{mistake.retry_status === 'retried' && <button className="mistake-row-action" onClick={() => void setRetry(mistake, { retry_later: true, retry_status: 'pending', ...startRetry(indiaToday(), 0) }, 'Back on the retry list for another spaced pass.')}>Retry again</button>}<button className="mistake-row-action card" onClick={() => void makeCard(mistake)} title="Turn this note into a flashcard"><Layers size={13} /> Make card</button><button className="mistake-row-action edit" onClick={() => { setEditing(mistake); setDialogOpen(true) }}><T k="mistakes:edit">{"Edit"}</T></button></div></div>
        </article>
      })}</div>}
      <div className="mistake-board-footer"><span>{filtered.length} note{filtered.length === 1 ? '' : 's'} shown{tab === 'retried' ? ' · retried' : ''}</span>{readyCount > 0 && <button onClick={() => setTab('retry')}><T k="mistakes:go-to-retry-list">{"Go to retry list"}</T>{' '}<ArrowUpRight size={14} /></button>}</div>
    </NotebookCard>
    </section>}
    {dialogOpen && <MistakeDialog key={editing?.id ?? 'new-mistake'} initial={editing} data={data} onClose={() => { setDialogOpen(false); setEditing(null) }} onSave={saveMistake} />}
    {deleteTarget && <ConfirmDialog title={`Delete “${deleteTarget.question_note.slice(0, 48)}${deleteTarget.question_note.length > 48 ? '…' : ''}”?`} message="The note and its image will be removed. You can undo the note briefly." onCancel={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()} loading={deleting} />}
    {lightbox && <Dialog lk="mistakes:question-image" title="Question image" onClose={() => setLightbox(null)} className="image-lightbox"><img src={lightbox} alt="Full size question or working" /><div className="dialog-actions"><Button variant="secondary" onClick={() => setLightbox(null)}><T k="mistakes:close-image">{"Close image"}</T></Button></div></Dialog>}
  </div>
}

function MistakeDialog({ initial, data, onClose, onSave }: { initial: Mistake | null; data: ReturnType<typeof useData>['data']; onClose: () => void; onSave: (mistake: Mistake) => Promise<Record<string, string> | null> }) {
  const { saveImage } = useData()
  const { notify } = useToast()
  const { user } = useAuth()
  const now = new Date().toISOString()
  const initialImageData = typeof initial?.image_data === 'string' && initial.image_data.startsWith('data:image/') ? initial.image_data : null
  const initialImagePreview = initial?.image_preview ?? initialImageData
  const [entryId] = useState(() => initial?.id ?? createId())
  const [chapterId, setChapterId] = useState(initial?.chapter_id ?? '')
  const initialSubject = data.chapters.find(chapter => chapter.id === initial?.chapter_id)?.subject ?? ''
  // Every subject of the student's exam (same source as the other pickers), then any other subject that already has chapters.
  const examSubjectList = useExamSubjects(initialSubject || null)
  const subjectOptions = mistakeSubjectOptions(examSubjectList, data.chapters)
  const [subject, setSubject] = useState<string>(initialSubject)
  const [testId, setTestId] = useState(initial?.test_id ?? '')
  const [cause, setCause] = useState<ErrorCategory>(initial ? causeOf(initial) : 'Concept gap')
  const [question, setQuestion] = useState(initial?.question_note ?? '')
  const [solution, setSolution] = useState(initial?.solution_note ?? '')
  const [retryLater, setRetryLater] = useState(initial?.retry_later ?? false)
  const [imagePath, setImagePath] = useState<string | null>(initial?.image_path ?? null)
  const [imageData, setImageData] = useState<string | null>(initialImageData)
  const [imagePreview, setImagePreview] = useState<string | null>(initialImagePreview)
  const [imagePending, setImagePending] = useState(initial?.image_pending ?? Boolean(initialImageData && !initial?.image_path && !user?.isLocal))
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [imageBusy, setImageBusy] = useState(false)
  const chapters = data.chapters.filter(chapter => chapter.subject === subject).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
  const clearFieldError = (key: string) => setErrors(current => { const next = { ...current }; delete next[key]; return next })

  const chooseImage = async (file?: File) => {
    if (!file) return
    setImageBusy(true)
    try {
      const image = await saveImage(file)
      setImagePath(image.path); setImageData(image.dataUrl); setImagePreview(image.dataUrl); setImagePending(!image.path && !user?.isLocal)
      notify(user?.isLocal ? 'Compressed image ready to save on this device.' : navigator.onLine ? 'Compressed image will upload when you save the note.' : 'Compressed image will sync with the note when you reconnect.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Image upload failed. Try again.', 'error') }
    finally { setImageBusy(false) }
  }
  const clearImage = () => {
    setImagePath(null); setImageData(null); setImagePreview(null); setImagePending(false)
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (imageBusy || busyRef.current) return
    const pickedChapter = data.chapters.find(chapter => chapter.id === chapterId)
    if (!subject || !pickedChapter || pickedChapter.subject !== subject) {
      setErrors(current => ({ ...current, ...(!subject ? { subject: 'Choose a subject first.' } : {}), chapter_id: subject ? 'Choose a chapter from the selected subject.' : 'Choose a subject, then a chapter.' }))
      notify('Choose a subject and one of its chapters.', 'error')
      return
    }
    busyRef.current = true
    setBusy(true)
    const id = entryId
    const next = {
      id, chapter_id: chapterId, test_id: testId || null, cause, mistake_type: typeForCause(cause),
      question_note: question.trim(), solution_note: solution.trim(), image_path: imagePath,
      image_data: imageData, image_preview: imagePreview, image_pending: imagePending,
      retry_later: retryLater, retry_status: initial?.retry_status ?? 'pending',
      created_at: initial?.created_at ?? now, updated_at: now,
      image_previous_path: initial?.image_path && initial.image_path !== imagePath ? initial.image_path : null
    } as Mistake
    try {
      const fieldErrors = await onSave(next)
      setErrors(fieldErrors ?? {})
      if (fieldErrors) notify('Please correct the highlighted mistake fields.', 'error')
    } finally { busyRef.current = false; setBusy(false) }
  }

  return <Dialog title={initial ? 'Edit mistake note' : 'Save a learning moment'} onClose={onClose} className="mistake-dialog">
    <form className="form-stack" noValidate onSubmit={submit}>
      <div className="form-grid three"><Field lk="mistakes:subject" label="Subject" required error={errors.subject}><select required value={subject} onChange={event => { setSubject(event.target.value); setChapterId(''); clearFieldError('subject'); clearFieldError('chapter_id') }}><option value="">Choose a subject</option>{subjectOptions.map(item => <option key={item} value={item}>{item}</option>)}</select></Field><Field lk="mistakes:chapter" label="Chapter" required error={errors.chapter_id}><select required value={chapterId} disabled={!subject} onChange={event => { setChapterId(event.target.value); clearFieldError('chapter_id') }}><option value="">{!subject ? 'Pick a subject first' : chapters.length ? 'Choose a chapter' : `No ${subject} chapters yet`}</option>{chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}</select>{subject && chapters.length === 0 && <span className="field-hint">Add {subject} chapters in Syllabus first, then log this mistake against one.</span>}</Field><Field lk="mistakes:mistake-type" label="Why did it go wrong?" hint="Used across the notebook and mock analysis."><select value={cause} onChange={event => setCause(event.target.value as ErrorCategory)}>{MISTAKE_CAUSES.map(item => <option key={item}>{item}</option>)}</select></Field></div>
      <Field lk="mistakes:what-was-the-question-or-mistake" label="What was the question or mistake?" required error={errors.question_note}><textarea autoFocus required maxLength={10000} rows={4} value={question} onChange={event => { setQuestion(event.target.value); setErrors(current => { const next = { ...current }; delete next.question_note; return next }) }} placeholder="Enough to recognise it next time…" /></Field>
      <Field lk="mistakes:solution-what-ill-remember" label="Solution / what I’ll remember" error={errors.solution_note}><textarea maxLength={10000} rows={3} value={solution} onChange={event => { setSolution(event.target.value); setErrors(current => { const next = { ...current }; delete next.solution_note; return next }) }} placeholder="The key idea or check for next time…" /></Field>
      <div className="form-grid two"><Field lk="mistakes:related-test" label="Related test"><select value={testId} onChange={event => setTestId(event.target.value)}><option value="">No linked test</option>{data.tests.map(test => <option key={test.id} value={test.id}>{test.title} · {prettyDate(test.test_date)}</option>)}</select></Field><label className="retry-toggle"><input type="checkbox" checked={retryLater} onChange={event => setRetryLater(event.target.checked)} /><span className="toggle-visual" /><span><strong><T k="mistakes:put-this-on-my-retry-list">{"Put this on my retry list"}</T></strong><small><T k="mistakes:bring-it-back-for-another-attempt">{"Try it again later."}</T></small></span></label></div>
      <div className="field"><span className="field-label"><T k="mistakes:question-image">{"Question image"}</T>{' '}<span className="field-hint inline"><T k="mistakes:optional-compressed-before-saving">{"(optional · compressed before saving)"}</T></span></span>{imagePreview ? <div className="upload-preview"><img src={imagePreview} alt="Selected question image preview" /><div><span>{imagePending ? 'Saved on this device' : 'Image attached'}</span><button type="button" onClick={() => void clearImage()}><Trash2 size={14} />{' '}<T k="mistakes:remove">{"Remove"}</T></button></div></div> : <label className={`image-dropzone ${imageBusy ? 'is-busy' : ''}`}><input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { void chooseImage(event.target.files?.[0]); event.currentTarget.value = '' }} disabled={imageBusy} /><span className="image-upload-icon"><Camera size={19} /></span><strong>{imageBusy ? 'Preparing a small image…' : 'Add a JPG, PNG, or WebP'}</strong><small><T k="mistakes:up-to-10-mb-before-compression-stored-pr">{"Up to 10 MB before compression; stored privately"}</T></small></label>}</div>
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}><T k="mistakes:cancel">{"Cancel"}</T></Button><Button type="submit" loading={busy} disabled={imageBusy}>{initial ? 'Save note' : 'Add to notebook'}</Button></div>
    </form>
  </Dialog>
}
