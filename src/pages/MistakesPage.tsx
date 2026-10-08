import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { AlertTriangle, ArrowUpRight, Camera, CirclePlus, ImagePlus, NotebookPen, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { Button, ConfirmDialog, Dialog, EmptyState, Field, NotebookCard, PageHeader, StatusBadge, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { indiaDate, prettyDate } from '../lib/date'
import { createId } from '../lib/id'
import type { Mistake, MistakeType, Subject } from '../types'
import { SUBJECTS } from '../types'

const MISTAKE_TYPES: MistakeType[] = ['Concept', 'Silly', 'Calculation', 'Time', 'Guess']
const mistakeSchema = z.object({ chapter_id: z.string().uuid(), mistake_type: z.enum(['Concept','Silly','Calculation','Time','Guess']), question_note: z.string().trim().min(1).max(10000), solution_note: z.string().max(10000) })

export default function MistakesPage() {
  const { data, upsert, remove } = useData()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [subject, setSubject] = useState<'all' | Subject>('all')
  const [type, setType] = useState<'all' | MistakeType>('all')
  const [retryFilter, setRetryFilter] = useState<'all' | 'retry' | 'resolved'>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Mistake | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Mistake | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const term = search.trim().toLowerCase()
  const filtered = useMemo(() => data.mistakes.filter(mistake => {
    const chapter = data.chapters.find(item => item.id === mistake.chapter_id)
    const text = `${mistake.question_note} ${mistake.solution_note} ${mistake.mistake_type} ${chapter?.name ?? ''}`.toLowerCase()
    if (term && !text.includes(term)) return false
    if (subject !== 'all' && chapter?.subject !== subject) return false
    if (type !== 'all' && mistake.mistake_type !== type) return false
    if (retryFilter === 'retry' && (!mistake.retry_later || mistake.retry_status !== 'pending')) return false
    if (retryFilter === 'resolved' && mistake.retry_status !== 'retried') return false
    return true
  }).sort((a, b) => b.created_at.localeCompare(a.created_at)), [data.mistakes, data.chapters, term, subject, type, retryFilter])

  const saveMistake = async (record: Mistake) => {
    const checked = mistakeSchema.safeParse(record)
    if (!checked.success) { notify(checked.error.issues[0]?.message ?? 'Check the mistake details.', 'error'); return }
    try { await upsert('mistakes', { ...record, updated_at: new Date().toISOString() }); notify(editing ? 'Mistake note updated.' : 'Saved to your mistake notebook.'); setDialogOpen(false); setEditing(null) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save mistake. Retry.', 'error') }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await remove('mistakes', deleteTarget)
      notify('Mistake entry deleted. Use Undo if needed.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not delete this entry.', 'error') }
    setDeleteTarget(null)
  }

  const setRetry = async (mistake: Mistake, next: Partial<Mistake>, message: string) => {
    try { await upsert('mistakes', { ...mistake, ...next, updated_at: new Date().toISOString() }); notify(message) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not update retry status.', 'error') }
  }

  return <div className="content-page mistakes-page">
    <PageHeader eyebrow="THE BEST LEARNING HIDES HERE" title="Mistake notebook" subtitle="Keep the question, the reason, and what you’ll remember next time." doodle={<span>✎</span>} action={<Button onClick={() => { setEditing(null); setDialogOpen(true) }}><CirclePlus size={17} /> Add a mistake</Button>} />
    <div className="mistake-overview-row"><NotebookCard className="mistake-stat-note"><div className="mistake-stat-icon"><NotebookPen size={18} /></div><div><strong>{data.mistakes.length}</strong><span>notes in your notebook</span></div><span className="note-corner-doodle">✦</span></NotebookCard><NotebookCard className="mistake-stat-note retry-stat"><div className="mistake-stat-icon"><RotateCcw size={18} /></div><div><strong>{data.mistakes.filter(item => item.retry_later && item.retry_status === 'pending').length}</strong><span>ready to retry</span></div><button onClick={() => navigate('/retry')}>Open retry list <ArrowUpRight size={14} /></button></NotebookCard><NotebookCard className="mistake-stat-note mistake-stat-help"><AlertTriangle size={17} /><p>Record the <em>why</em> as carefully as the answer. Patterns emerge with practice.</p></NotebookCard></div>
    <NotebookCard className="mistake-board">
      <div className="mistake-toolbar"><div className="search-field"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search question notes…" aria-label="Search mistake notes" />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}</div><select aria-label="Filter subject" value={subject} onChange={event => setSubject(event.target.value as 'all' | Subject)}><option value="all">All subjects</option>{SUBJECTS.map(item => <option key={item}>{item}</option>)}</select><select aria-label="Filter mistake type" value={type} onChange={event => setType(event.target.value as 'all' | MistakeType)}><option value="all">All mistake types</option>{MISTAKE_TYPES.map(item => <option key={item}>{item}</option>)}</select><select aria-label="Filter retry status" value={retryFilter} onChange={event => setRetryFilter(event.target.value as 'all' | 'retry' | 'resolved')}><option value="all">All entries</option><option value="retry">Retry list</option><option value="resolved">Retried</option></select></div>
      {filtered.length === 0 ? <EmptyState icon={<NotebookPen size={25} />} title={data.mistakes.length ? 'No notes match.' : 'Nothing here yet.'} description={data.mistakes.length ? 'Adjust a filter to find that note.' : 'Your mistake notebook will become one of your most useful study tools.'} action={<Button variant="secondary" size="sm" onClick={() => data.mistakes.length ? (setSearch(''), setSubject('all'), setType('all'), setRetryFilter('all')) : setDialogOpen(true)}>{data.mistakes.length ? 'Clear filters' : <><CirclePlus size={15} /> Add your first note</>}</Button>} /> : <div className="mistake-card-grid">{filtered.map(mistake => {
        const chapter = data.chapters.find(item => item.id === mistake.chapter_id)
        const linkedTest = data.tests.find(item => item.id === mistake.test_id)
        const image = mistake.image_data ?? mistake.image_preview
        return <article className="mistake-entry-card" key={mistake.id}>
          <div className="mistake-entry-top"><span className={`mistake-type-chip mistake-${mistake.mistake_type.toLowerCase()}`}>{mistake.mistake_type}</span><span className="mistake-entry-date">{prettyDate(indiaDate(mistake.created_at), { day: 'numeric', month: 'short' })}</span><button className="mistake-delete-button" onClick={() => setDeleteTarget(mistake)} aria-label="Delete mistake note"><Trash2 size={15} /></button></div>
          <div className="mistake-entry-tags">{chapter ? <><SubjectBadge subject={chapter.subject} /><span>{chapter.name}</span></> : <StatusBadge tone="weak">Chapter removed</StatusBadge>}{linkedTest && <span className="linked-test-label">From {linkedTest.title}</span>}</div>
          <h3>{mistake.question_note}</h3>
          {mistake.solution_note && <div className="mistake-solution"><span>WHAT I’LL REMEMBER</span><p>{mistake.solution_note}</p></div>}
          {image && <button className="mistake-image-preview" onClick={() => setLightbox(image)} aria-label="Open attached image"><img src={image} alt="Attached question or working" loading="lazy" /><span><ImagePlus size={14} /> View image</span></button>}
          <div className="mistake-entry-bottom"><span>{mistake.retry_status === 'retried' ? <StatusBadge tone="Strong">Retried</StatusBadge> : mistake.retry_later ? <StatusBadge tone="Okay">Retry later</StatusBadge> : <StatusBadge tone="muted">Notebook</StatusBadge>}</span><div>{mistake.retry_status === 'pending' && <button className="mistake-row-action" onClick={() => void setRetry(mistake, { retry_later: !mistake.retry_later }, mistake.retry_later ? 'Removed from the retry list.' : 'Added to your retry list.')}>{mistake.retry_later ? 'Keep in notes' : 'Retry later'}</button>}<button className="mistake-row-action edit" onClick={() => { setEditing(mistake); setDialogOpen(true) }}>Edit</button></div></div>
        </article>
      })}</div>}
      <div className="mistake-board-footer"><span>{filtered.length} note{filtered.length === 1 ? '' : 's'} shown</span><button onClick={() => navigate('/retry')}>Go to retry list <ArrowUpRight size={14} /></button></div>
    </NotebookCard>
    {dialogOpen && <MistakeDialog key={editing?.id ?? 'new-mistake'} initial={editing} data={data} onClose={() => { setDialogOpen(false); setEditing(null) }} onSave={saveMistake} />}
    {deleteTarget && <ConfirmDialog title="Delete this mistake note?" message="The note and its attached image will be removed. You can undo the note deletion for a few seconds." onCancel={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()} />}
    {lightbox && <Dialog title="Question image" onClose={() => setLightbox(null)} className="image-lightbox"><img src={lightbox} alt="Full size question or working" /><div className="dialog-actions"><Button variant="secondary" onClick={() => setLightbox(null)}>Close image</Button></div></Dialog>}
  </div>
}

function MistakeDialog({ initial, data, onClose, onSave }: { initial: Mistake | null; data: ReturnType<typeof useData>['data']; onClose: () => void; onSave: (mistake: Mistake) => Promise<void> }) {
  const { saveImage } = useData()
  const { notify } = useToast()
  const { user } = useAuth()
  const now = new Date().toISOString()
  const initialImageData = typeof initial?.image_data === 'string' && initial.image_data.startsWith('data:image/') ? initial.image_data : null
  const initialImagePreview = initial?.image_preview ?? initialImageData
  const [entryId] = useState(() => initial?.id ?? createId())
  const [chapterId, setChapterId] = useState(initial?.chapter_id ?? '')
  const [testId, setTestId] = useState(initial?.test_id ?? '')
  const [mistakeType, setMistakeType] = useState<MistakeType>(initial?.mistake_type ?? 'Concept')
  const [question, setQuestion] = useState(initial?.question_note ?? '')
  const [solution, setSolution] = useState(initial?.solution_note ?? '')
  const [retryLater, setRetryLater] = useState(initial?.retry_later ?? false)
  const [imagePath, setImagePath] = useState<string | null>(initial?.image_path ?? null)
  const [imageData, setImageData] = useState<string | null>(initialImageData)
  const [imagePreview, setImagePreview] = useState<string | null>(initialImagePreview)
  const [imagePending, setImagePending] = useState(initial?.image_pending ?? Boolean(initialImageData && !initial?.image_path && !user?.isLocal))
  const [busy, setBusy] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const chapters = [...data.chapters].sort((a, b) => a.subject.localeCompare(b.subject) || a.position - b.position)

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
    if (imageBusy || busy) return
    const id = entryId
    const next = {
      id, chapter_id: chapterId, test_id: testId || null, mistake_type: mistakeType,
      question_note: question.trim(), solution_note: solution.trim(), image_path: imagePath,
      image_data: imageData, image_preview: imagePreview, image_pending: imagePending,
      retry_later: retryLater, retry_status: initial?.retry_status ?? 'pending',
      created_at: initial?.created_at ?? now, updated_at: now,
      image_previous_path: initial?.image_path && initial.image_path !== imagePath ? initial.image_path : null
    } as Mistake
    setBusy(true)
    try {
      await onSave(next)
    } finally { setBusy(false) }
  }

  return <Dialog title={initial ? 'Edit mistake note' : 'Save a learning moment'} subtitle="Small, specific notes are easier to revisit." onClose={onClose} className="mistake-dialog">
    <form className="form-stack" onSubmit={submit}>
      <div className="form-grid two"><Field label="Chapter" required><select required value={chapterId} onChange={event => setChapterId(event.target.value)}><option value="">Choose a chapter</option>{chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.subject} · {chapter.name}</option>)}</select></Field><Field label="Mistake type"><select value={mistakeType} onChange={event => setMistakeType(event.target.value as MistakeType)}>{MISTAKE_TYPES.map(type => <option key={type}>{type}</option>)}</select></Field></div>
      <Field label="What was the question or mistake?" required><textarea autoFocus required maxLength={10000} rows={4} value={question} onChange={event => setQuestion(event.target.value)} placeholder="Write enough to recognize the question next time…" /></Field>
      <Field label="Solution / what I’ll remember"><textarea maxLength={10000} rows={3} value={solution} onChange={event => setSolution(event.target.value)} placeholder="The key idea, missed condition, or check to use next time…" /></Field>
      <div className="form-grid two"><Field label="Related test"><select value={testId} onChange={event => setTestId(event.target.value)}><option value="">No linked test</option>{data.tests.map(test => <option key={test.id} value={test.id}>{test.title} · {prettyDate(test.test_date)}</option>)}</select></Field><label className="retry-toggle"><input type="checkbox" checked={retryLater} onChange={event => setRetryLater(event.target.checked)} /><span className="toggle-visual" /><span><strong>Put this on my retry list</strong><small>Bring it back for another attempt.</small></span></label></div>
      <div className="field"><span className="field-label">Question image <span className="field-hint inline">(optional · compressed before saving)</span></span>{imagePreview ? <div className="upload-preview"><img src={imagePreview} alt="Selected question image preview" /><div><span>{imagePending ? 'Saved on this device' : 'Image attached'}</span><button type="button" onClick={() => void clearImage()}><Trash2 size={14} /> Remove</button></div></div> : <label className={`image-dropzone ${imageBusy ? 'is-busy' : ''}`}><input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { void chooseImage(event.target.files?.[0]); event.currentTarget.value = '' }} disabled={imageBusy} /><span className="image-upload-icon"><Camera size={19} /></span><strong>{imageBusy ? 'Preparing a small image…' : 'Add a JPG, PNG, or WebP'}</strong><small>Up to 10 MB before compression; stored privately</small></label>}</div>
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} disabled={imageBusy}>{initial ? 'Save note' : 'Add to notebook'}</Button></div>
    </form>
  </Dialog>
}
