import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlarmClock, Check, Edit3, Eye, Plus, Sigma, Trash2, WandSparkles } from 'lucide-react'
import { Button, Dialog, EmptyState, Field, NotebookCard, OverflowMenu, PageHeader, ProgressBar, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui'
import { ChapterSelect, ChipFilter } from '../components/jee/shared'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { createId } from '../lib/id'
import { indiaToday, prettyDate } from '../lib/date'
import { reviewCard, dueCards, type CardRating } from '../lib/jee/cards'
import type { CardKind, StudyCard } from '../types'

type KindFilter = 'all' | CardKind

export default function DecksPage() {
  const { data, upsert, remove, upsertMany } = useData()
  const { notify } = useToast()
  const [params] = useSearchParams()
  const today = indiaToday()
  const dueOverall = useMemo(() => dueCards(data.studyCards, today), [data.studyCards, today])
  const defaultChapter = params.get('chapter') ?? dueOverall[0]?.chapter_id ?? data.chapters.find(chapter => chapter.formula_notes.trim())?.id ?? data.chapters[0]?.id ?? ''
  const [chapterId, setChapterId] = useState(defaultChapter)
  const [subject, setSubject] = useState<'all' | 'Physics' | 'Chemistry' | 'Maths'>('all')
  const [kind, setKind] = useState<KindFilter>('all')
  const [reviewing, setReviewing] = useState(false)
  const [editing, setEditing] = useState<StudyCard | 'new' | null>(null)
  const chapter = data.chapters.find(item => item.id === chapterId)
  const cards = useMemo(() => data.studyCards.filter(card => card.chapter_id === chapterId && (kind === 'all' || card.kind === kind)).sort((a, b) => a.kind.localeCompare(b.kind) || a.position - b.position), [data.studyCards, chapterId, kind])
  const chapterDue = dueCards(data.studyCards, today, chapterId)
  const gaps = data.settings.revision_gaps

  const remover = async (card: StudyCard) => {
    try { await remove('study_cards', card); notify('Card removed. Undo is available briefly.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not remove this card.', 'error') }
  }

  const importFormulaNotes = async () => {
    if (!chapter) return
    const lines = chapter.formula_notes.split('\n').map(line => line.trim()).filter(Boolean)
    const existing = new Set(data.studyCards.filter(card => card.chapter_id === chapter.id && card.kind === 'formula').map(card => card.back))
    const fresh = lines.filter(line => !existing.has(line)).slice(0, 200)
    if (!fresh.length) { notify('Every formula line in this chapter is already a card.'); return }
    const now = new Date().toISOString()
    const base = data.studyCards.filter(card => card.chapter_id === chapter.id && card.kind === 'formula').length
    try {
      await upsertMany('study_cards', fresh.map((line, index) => ({
        id: createId(), chapter_id: chapter.id, kind: 'formula' as const,
        front: line.includes(':') ? line.split(':')[0]!.trim().slice(0, 4900) || line.slice(0, 4900) : `Formula ${base + index + 1}`,
        back: line.slice(0, 9900), hint: '', position: base + index, difficulty: null, reviews: 0, last_reviewed_at: null, next_review_at: null,
        created_at: now, updated_at: now
      })))
      notify(`${fresh.length} formula card${fresh.length === 1 ? '' : 's'} created from your notes.`)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not import formulas.', 'error') }
  }

  return <div className="content-page decks-page">
    <PageHeader
      eyebrow="FORMULAS & FLASHCARDS ON THE R1 → R7 → R30 LADDER"
      title="Formula & flashcards"
      subtitle="Cards you know move out to R7, then R30. Difficult ones come back tomorrow. Due cards also surface in Study now."
      action={<Button onClick={() => setEditing('new')} disabled={!chapterId}><Plus size={16} /> New card</Button>}
    />

    <section className="jee-stat-grid" aria-label="Due cards">
      <NotebookCard className="jee-stat"><span>Due overall</span><strong>{dueOverall.length}</strong><small>across all chapters</small></NotebookCard>
      <NotebookCard className="jee-stat"><span>Due in this chapter</span><strong>{chapterDue.length}</strong><small>{chapter?.name ?? 'Pick a chapter'}</small></NotebookCard>
      <NotebookCard className="jee-stat"><span>Cards</span><strong>{data.studyCards.length}</strong><small>formulas and flashcards</small></NotebookCard>
    </section>

    <NotebookCard className="jee-filter-card">
      <div className="jee-filter-grid">
        <label className="jee-select"><span>Subject</span><select value={subject} onChange={event => setSubject(event.target.value as typeof subject)}><option value="all">All subjects</option><option>Physics</option><option>Chemistry</option><option>Maths</option></select></label>
        <ChapterSelect chapters={data.chapters} value={chapterId} onChange={setChapterId} subject={subject} label="Chapter" />
      </div>
      <ChipFilter<KindFilter> label="Deck" value={kind} onChange={setKind} options={[{ value: 'all', label: 'Both' }, { value: 'formula', label: 'Formulas' }, { value: 'flashcard', label: 'Flashcards' }]} />
    </NotebookCard>

    {!chapter ? <NotebookCard><EmptyState title="No chapter selected." description="Pick a chapter to open its decks." /></NotebookCard> : <>
      <div className="jee-deck-actions">
        <Button onClick={() => setReviewing(true)} disabled={chapterDue.length === 0}><Eye size={16} /> Review {chapterDue.length} due</Button>
        {chapter.formula_notes.trim() && <Button variant="secondary" onClick={() => void importFormulaNotes()}><WandSparkles size={15} /> Make formula cards from chapter notes</Button>}
      </div>

      <SectionHeading title={`${chapter.name}`} note={`${cards.length} card${cards.length === 1 ? '' : 's'} in view · ${gaps.map(gap => `R${gap}`).join(' → ')} ladder`} action={<SubjectBadge subject={chapter.subject} />} />
      {cards.length === 0 ? <NotebookCard><EmptyState icon={<Sigma size={24} />} title="No cards in this deck yet." description="Add a formula you keep forgetting, or a question you want to rehearse. Cards stay private to your account." action={<Button variant="secondary" size="sm" onClick={() => setEditing('new')}><Plus size={15} /> Add a card</Button>} /></NotebookCard>
      : <div className="jee-card-grid">
        {cards.map(card => {
          const isDue = dueCards([card], today).length > 0
          return <NotebookCard key={card.id} className="jee-deck-card">
            <div className="jee-deck-card-head">
              <StatusBadge tone={card.kind === 'formula' ? 'Okay' : 'Strong'}>{card.kind === 'formula' ? 'Formula' : 'Flashcard'}</StatusBadge>
              {isDue ? <StatusBadge tone="weak">Due</StatusBadge> : card.next_review_at && <span className="jee-muted jee-small"><AlarmClock size={12} aria-hidden="true" /> {prettyDate(card.next_review_at.slice(0, 10))}</span>}
              {card.difficulty === 'difficult' && <StatusBadge tone="dropping">Difficult</StatusBadge>}
              <OverflowMenu label={`Actions for card ${card.front}`} items={[
                { id: 'edit', label: 'Edit', icon: <Edit3 size={15} />, onSelect: () => setEditing(card) },
                { id: 'delete', label: 'Delete', icon: <Trash2 size={15} />, danger: true, onSelect: () => void remover(card) }
              ]} />
            </div>
            <strong className="jee-deck-front">{card.front}</strong>
            <details className="jee-deck-back"><summary>Show answer</summary><p>{card.back}</p>{card.hint && <small>Hint: {card.hint}</small>}</details>
            <small className="jee-muted">Reviewed {card.reviews} time{card.reviews === 1 ? '' : 's'}</small>
          </NotebookCard>
        })}
      </div>}
    </>}

    {reviewing && chapter && <ReviewDialog cards={chapterDue} chapterName={chapter.name} gaps={gaps} onClose={() => setReviewing(false)} onRate={async (card, rating) => {
      const updated = reviewCard(card, rating, gaps, new Date())
      await upsert('study_cards', updated)
      return updated
    }} />}
    {editing && chapter && <CardDialog key={editing === 'new' ? 'new' : editing.id} card={editing === 'new' ? undefined : editing} chapterId={chapter.id} nextPosition={cards.length} onClose={() => setEditing(null)} onSave={async value => {
      const now = new Date().toISOString()
      if (editing === 'new') await upsert('study_cards', { ...value, id: createId(), chapter_id: chapter.id, reviews: 0, last_reviewed_at: null, next_review_at: null, difficulty: null, created_at: now, updated_at: now })
      else await upsert('study_cards', { ...editing, ...value, updated_at: now })
      notify('Card saved.')
    }} />}
  </div>
}

function ReviewDialog({ cards, chapterName, gaps, onClose, onRate }: {
  cards: StudyCard[]; chapterName: string; gaps: number[]; onClose: () => void; onRate: (card: StudyCard, rating: CardRating) => Promise<StudyCard>
}) {
  const queue = cards
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stats, setStats] = useState({ known: 0, difficult: 0 })
  const { notify } = useToast()
  const card = queue[index]
  const finished = index >= queue.length
  const rate = async (rating: CardRating) => {
    if (!card || busy) return
    setBusy(true)
    try {
      await onRate(card, rating)
      setStats(current => ({ ...current, [rating]: current[rating] + 1 }))
      setRevealed(false)
      setIndex(value => value + 1)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save this review.', 'error') }
    finally { setBusy(false) }
  }
  return <Dialog title={`Review · ${chapterName}`} subtitle={`${gaps.map(gap => `R${gap}`).join(' → ')} schedule · ${Math.min(index + 1, queue.length)} of ${queue.length}`} onClose={onClose} className="jee-dialog">
    {finished || !card ? <div className="jee-review-done">
      <Check size={26} aria-hidden="true" />
      <h3>Session complete</h3>
      <p>{stats.known} known · {stats.difficult} difficult. Known cards are scheduled further out; difficult ones return tomorrow.</p>
      <Button onClick={onClose}>Done</Button>
    </div> : <div className="jee-review">
      <ProgressBar value={(index / queue.length) * 100} label="Review progress" />
      <div className="jee-review-card" aria-live="polite">
        <span className="jee-muted jee-small">{card.kind === 'formula' ? 'Formula' : 'Flashcard'}</span>
        <p className="jee-review-front">{card.front}</p>
        {revealed ? <div className="jee-review-back"><p>{card.back}</p>{card.hint && <small>Hint: {card.hint}</small>}</div>
          : <Button variant="secondary" onClick={() => setRevealed(true)}><Eye size={15} /> Reveal answer</Button>}
      </div>
      {revealed && <div className="jee-review-actions">
        <Button variant="danger" onClick={() => void rate('difficult')} loading={busy}>Difficult — again tomorrow</Button>
        <Button onClick={() => void rate('known')} loading={busy}><Check size={15} /> Known</Button>
      </div>}
    </div>}
  </Dialog>
}

function CardDialog({ card, chapterId, nextPosition, onClose, onSave }: {
  card?: StudyCard; chapterId: string; nextPosition: number; onClose: () => void
  onSave: (value: Pick<StudyCard, 'kind' | 'front' | 'back' | 'hint' | 'position' | 'chapter_id'>) => Promise<void>
}) {
  const [kind, setKind] = useState<CardKind>(card?.kind ?? 'formula')
  const [front, setFront] = useState(card?.front ?? '')
  const [back, setBack] = useState(card?.back ?? '')
  const [hint, setHint] = useState(card?.hint ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { notify } = useToast()
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (!front.trim() || !back.trim()) { setError('Both the front and the answer are needed.'); return }
    if (front.length > 5000 || back.length > 10000 || hint.length > 2000) { setError('Keep the front under 5000, the answer under 10000, and the hint under 2000 characters.'); return }
    setSaving(true)
    try { await onSave({ kind, front: front.trim(), back: back.trim(), hint: hint.trim(), position: card?.position ?? nextPosition, chapter_id: chapterId }); onClose() }
    catch (saveError) { notify(saveError instanceof Error ? saveError.message : 'Could not save the card.', 'error') }
    finally { setSaving(false) }
  }
  return <Dialog title={card ? 'Edit card' : 'New card'} subtitle="Formulas and flashcards share one scheduling ladder." onClose={onClose} className="jee-dialog">
    <form className="form-stack" noValidate onSubmit={submit}>
      <Field label="Deck"><select value={kind} onChange={event => setKind(event.target.value as CardKind)}><option value="formula">Formula</option><option value="flashcard">Flashcard</option></select></Field>
      <Field label={kind === 'formula' ? 'Formula name or prompt' : 'Question'} required><textarea rows={2} maxLength={5000} value={front} onChange={event => setFront(event.target.value)} placeholder={kind === 'formula' ? 'e.g. Capacitance of parallel plates' : 'e.g. Why does a conductor have zero field inside?'} /></Field>
      <Field label={kind === 'formula' ? 'Formula' : 'Answer'} required><textarea rows={3} maxLength={10000} value={back} onChange={event => setBack(event.target.value)} placeholder={kind === 'formula' ? 'C = ε₀A / d' : 'Charges redistribute so the field cancels inside.'} /></Field>
      <Field label="Hint (optional)"><input maxLength={2000} value={hint} onChange={event => setHint(event.target.value)} /></Field>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>{card ? 'Save card' : 'Add card'} <Check size={16} /></Button></div>
    </form>
  </Dialog>
}
