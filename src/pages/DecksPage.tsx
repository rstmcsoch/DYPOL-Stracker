import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlarmClock, Check, CheckCircle2, ClipboardPaste, Edit3, Eye, FileDown, Layers, Plus, Sigma, Trash2, WandSparkles } from 'lucide-react'
import { Button, Dialog, EmptyState, Field, NotebookCard, OverflowMenu, PageHeader, ProgressBar, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui'
import { ChapterSelect, ChipFilter } from '../components/jee/shared'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { createId } from '../lib/id'
import { createFormulaSheet } from '../lib/report'
import { indiaToday, prettyDate } from '../lib/date'
import { reviewCard, dueCards, dueInChapterDisplay, defaultDeckChapter, ratingPreview, RATING_LABELS } from '../lib/jee/cards'
import { CARD_RATINGS, type CardKind, type CardRating, type Chapter, type StudyCard } from '../types'
import { useReportSubjects } from '../lib/exams/useExamSubjects'
import { T } from '../lib/student-layout/T'
import { usePageSlots } from '../lib/student-layout/use-layout'

type KindFilter = 'all' | CardKind

export default function DecksPage() {
  const sl = usePageSlots('decks')
  const deckSubjects = useReportSubjects()
  const { data, upsert, remove, upsertMany } = useData()
  const { notify } = useToast()
  const [params] = useSearchParams()
  const today = indiaToday()
  const allDue = useMemo(() => dueCards(data.studyCards, today), [data.studyCards, today])
  const [chapterId, setChapterId] = useState(params.get('chapter') ?? '')
  const defaultChapter = defaultDeckChapter(data.chapters, allDue, params.get('chapter'))
  // Data often arrives after the first render; keep the user's pick, otherwise follow the default.
  const activeChapterId = chapterId && data.chapters.some(item => item.id === chapterId) ? chapterId : defaultChapter
  const [subject, setSubjectState] = useState<string>('all')
  // A card's subject is its chapter's subject; cards whose chapter is gone match no subject.
  const subjectOfChapter = useMemo(() => new Map(data.chapters.map(item => [item.id, item.subject])), [data.chapters])
  const dueOverall = useMemo(() => subject === 'all' ? allDue : allDue.filter(card => subjectOfChapter.get(card.chapter_id) === subject), [allDue, subject, subjectOfChapter])
  // Soonest future card in the open chapter, so "nothing due" can say when to come back
  // instead of leaving the student with a dead button and no plan.
  const nextDue = useMemo(() => {
    const chapter = data.chapters.find(item => item.id === activeChapterId)
    if (!chapter) return null
    return data.studyCards.filter(card => card.chapter_id === chapter.id).map(card => card.next_review_at?.slice(0, 10)).filter((date): date is string => Boolean(date) && date! > today).sort()[0] ?? null
  }, [data.chapters, data.studyCards, activeChapterId, today])
  const setSubject = (next: string) => {
    setSubjectState(next)
    if (next === 'all' || subjectOfChapter.get(activeChapterId) === next) return
    // The open chapter belongs to another subject: switch to this subject's chapter with the
    // most due cards (then the first one), or show the empty state when it has none.
    const inSubject = data.chapters.filter(item => item.subject === next)
    const withDue = inSubject.map(item => ({ id: item.id, due: allDue.filter(card => card.chapter_id === item.id).length })).sort((a, b) => b.due - a.due)[0]
    setChapterId(withDue && withDue.due > 0 ? withDue.id : inSubject[0]?.id ?? '')
  }
  const [kind, setKind] = useState<KindFilter>('all')
  // Which queue is open: the chapter's due cards, or every due card across chapters.
  const [reviewQueue, setReviewQueue] = useState<'chapter' | 'all' | null>(null)
  const [pasting, setPasting] = useState(false)
  const [editing, setEditing] = useState<StudyCard | 'new' | null>(null)
  const chapter = data.chapters.find(item => item.id === activeChapterId)
  const cards = useMemo(() => data.studyCards.filter(card => card.chapter_id === activeChapterId && (kind === 'all' || card.kind === kind)).sort((a, b) => a.kind.localeCompare(b.kind) || a.position - b.position), [data.studyCards, activeChapterId, kind])
  const chapterDue = dueCards(data.studyCards, today, activeChapterId)
  const gaps = data.settings.revision_gaps

  const remover = async (card: StudyCard) => {
    try { await remove('study_cards', card); notify('Card removed.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not remove this card.', 'error') }
  }

  /** Print a whole subject's formulas at once — the revision artefact students actually use. */
  const exportSheet = async () => {
    if (!chapter) return
    try { await createFormulaSheet(data, chapter.subject); notify(`Formula sheet exported for ${chapter.subject}.`) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not build the formula sheet.', 'error') }
  }

  const importFormulaNotes = async () => {
    if (!chapter) return
    const lines = chapter.formula_notes.split('\n').map(line => line.trim()).filter(Boolean)
    const existing = new Set(data.studyCards.filter(card => card.chapter_id === chapter.id && card.kind === 'formula').map(card => card.back))
    const fresh = lines.filter(line => !existing.has(line)).slice(0, 200)
    if (!fresh.length) { notify('All formulas in this chapter are already cards.'); return }
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
    <PageHeader layoutId="decks.header"
      title="Formula & flashcards"
      subtitle="Rate each card. Good and Easy push it further out."
      action={<Button onClick={() => setEditing('new')} disabled={data.chapters.length === 0}><Plus size={16} />{' '}<T k="decks:new-card">{"New card"}</T></Button>}
    />

    {!sl.hidden('summary') && <section {...sl.attrs('summary')} className="jee-stat-grid" aria-label="Due cards">
      <NotebookCard className="jee-stat"><span><T k="decks:due-overall">{"Due overall"}</T></span><strong>{dueOverall.length}</strong><small>{subject === 'all' ? 'across all chapters' : `across ${subject}`}</small></NotebookCard>
      <NotebookCard className="jee-stat"><span><T k="decks:due-in-this-chapter">{"Due in this chapter"}</T></span><strong>{dueInChapterDisplay(activeChapterId, chapterDue.length)}</strong><small>{chapter?.name ?? 'Pick a chapter'}</small></NotebookCard>
      <NotebookCard className="jee-stat"><span><T k="decks:cards">{"Cards"}</T></span><strong>{data.studyCards.length}</strong><small><T k="decks:formulas-and-flashcards">{"formulas and flashcards"}</T></small></NotebookCard>
    </section>}

    <NotebookCard {...sl.attrs('filters')} className="jee-filter-card">
      <div className="jee-filter-grid">
        <label className="jee-select"><span><T k="decks:subject">{"Subject"}</T></span><select value={subject} onChange={event => setSubject(event.target.value)}><option value="all">All subjects</option>{deckSubjects.map(item => <option key={item}>{item}</option>)}</select></label>
        <ChapterSelect chapters={data.chapters} value={activeChapterId} onChange={setChapterId} subject={subject} label="Chapter" />
      </div>
      <ChipFilter<KindFilter> lk="decks" label="Deck" value={kind} onChange={setKind} options={[{ value: 'all', label: 'Both' }, { value: 'formula', label: 'Formulas' }, { value: 'flashcard', label: 'Flashcards' }]} />
    </NotebookCard>

    {!chapter ? <NotebookCard><EmptyState title={subject !== 'all' && !data.chapters.some(item => item.subject === subject) ? `No ${subject} chapters yet. Add one in Syllabus.` : 'Pick a chapter to open its decks.'} /></NotebookCard> : <>
      <div className="jee-deck-actions">
        <Button onClick={() => setReviewQueue('chapter')} disabled={chapterDue.length === 0}><Eye size={16} /> Review {chapterDue.length} due</Button>
        <Button variant="secondary" onClick={() => setReviewQueue('all')} disabled={dueOverall.length === 0}><Layers size={15} /> Review all {dueOverall.length} due</Button>
        {chapter.formula_notes.trim() && <Button variant="secondary" onClick={() => void importFormulaNotes()}><WandSparkles size={15} />{' '}<T k="decks:make-formula-cards-from-chapter-notes">{"Make formula cards from chapter notes"}</T></Button>}
        <Button variant="quiet" onClick={() => setPasting(true)}><ClipboardPaste size={15} /> Paste cards</Button>
        <Button variant="quiet" onClick={() => void exportSheet()} disabled={!chapter}><FileDown size={15} /> Formula sheet PDF</Button>
      </div>

      {cards.length > 0 && chapterDue.length === 0 && <p className="jee-deck-rest-note">
        <CheckCircle2 size={15} aria-hidden="true" /> Nothing due in this deck. {nextDue ? `Next card comes back ${prettyDate(nextDue)}` : 'Come back tomorrow'} — or review ahead now.
      </p>}

      <SectionHeading title={`${chapter.name}`} note={`${cards.length} card${cards.length === 1 ? '' : 's'} in view · ${gaps.map(gap => `R${gap}`).join(' → ')} ladder`} action={<SubjectBadge subject={chapter.subject} />} />
      {cards.length === 0 ? <NotebookCard><EmptyState lk="decks:no-cards-in-this-deck-yet" icon={<Sigma size={24} />} title="No cards in this deck yet." action={<Button variant="secondary" size="sm" onClick={() => setEditing('new')}><Plus size={15} />{' '}<T k="decks:add-a-card">{"Add a card"}</T></Button>} /></NotebookCard>
      : <div className="jee-card-grid">
        {cards.map(card => {
          const isDue = dueCards([card], today).length > 0
          return <NotebookCard key={card.id} className="jee-deck-card">
            <div className="jee-deck-card-head">
              <StatusBadge tone={card.kind === 'formula' ? 'Okay' : 'Strong'}>{card.kind === 'formula' ? 'Formula' : 'Flashcard'}</StatusBadge>
              {isDue ? <StatusBadge tone="weak"><T k="decks:due">{"Due"}</T></StatusBadge> : card.next_review_at && <span className="jee-muted jee-small"><AlarmClock size={12} aria-hidden="true" /> {prettyDate(card.next_review_at.slice(0, 10))}</span>}
              {card.last_rating ? <StatusBadge tone={card.last_rating === 'again' || card.last_rating === 'hard' ? 'dropping' : 'muted'}>{RATING_LABELS[card.last_rating]}</StatusBadge> : card.difficulty === 'difficult' && <StatusBadge tone="dropping"><T k="decks:difficult">{"Difficult"}</T></StatusBadge>}
              <OverflowMenu label={`Actions for card ${card.front}`} items={[
                { id: 'edit', label: 'Edit', icon: <Edit3 size={15} />, onSelect: () => setEditing(card) },
                { id: 'delete', label: 'Delete', icon: <Trash2 size={15} />, danger: true, onSelect: () => void remover(card) }
              ]} />
            </div>
            <strong className="jee-deck-front">{card.front}</strong>
            <details className="jee-deck-back"><summary><T k="decks:show-answer">{"Show answer"}</T></summary><p>{card.back}</p>{card.hint && <small>Hint: {card.hint}</small>}</details>
            <small className="jee-muted">Reviewed {card.reviews} time{card.reviews === 1 ? '' : 's'}</small>
          </NotebookCard>
        })}
      </div>}
    </>}

    {pasting && chapter && <PasteCardsDialog chapter={chapter} onClose={() => setPasting(false)} onSave={async cards => {
      await upsertMany('study_cards', cards)
      notify(`${cards.length} card${cards.length === 1 ? '' : 's'} added to ${chapter.name}.`)
    }} />}
    {reviewQueue === 'chapter' && chapter && <ReviewDialog cards={chapterDue} chapterName={chapter.name} gaps={gaps} onClose={() => setReviewQueue(null)} onRate={async (card, rating) => {
      const updated = reviewCard(card, rating, gaps, new Date())
      await upsert('study_cards', updated)
      return updated
    }} />}
    {reviewQueue === 'all' && <ReviewDialog cards={dueOverall} chapterName={subject === 'all' ? 'Every chapter' : subject} gaps={gaps} onClose={() => setReviewQueue(null)} onRate={async (card, rating) => {
      const updated = reviewCard(card, rating, gaps, new Date())
      await upsert('study_cards', updated)
      return updated
    }} />}
    {editing && <CardDialog key={editing === 'new' ? 'new' : editing.id} card={editing === 'new' ? undefined : editing} chapters={data.chapters} subjects={deckSubjects} initialChapterId={editing === 'new' ? activeChapterId : editing.chapter_id} positionFor={target => data.studyCards.filter(item => item.chapter_id === target).length} onClose={() => setEditing(null)} onSave={async value => {
      const now = new Date().toISOString()
      if (editing === 'new') await upsert('study_cards', { ...value, id: createId(), reviews: 0, last_reviewed_at: null, next_review_at: null, difficulty: null, last_rating: null, created_at: now, updated_at: now })
      else await upsert('study_cards', { ...editing, ...value, updated_at: now })
      // Follow the card to the chapter it was saved in so it is visible straight away.
      if (value.chapter_id !== activeChapterId) {
        setChapterId(value.chapter_id)
        const savedSubject = subjectOfChapter.get(value.chapter_id)
        if (subject !== 'all' && savedSubject !== subject) setSubjectState(savedSubject ?? 'all')
      }
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
  const [stats, setStats] = useState<Record<CardRating, number>>({ again: 0, hard: 0, good: 0, easy: 0 })
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
      <h3><T k="decks:session-complete">{"Session complete"}</T></h3>
      <p>{CARD_RATINGS.map(rating => `${stats[rating]} ${RATING_LABELS[rating].toLowerCase()}`).join(' · ')}. Again cards stay due today, Hard ones return tomorrow, Good and Easy move up the ladder.</p>
      <Button onClick={onClose}><T k="decks:done">{"Done"}</T></Button>
    </div> : <div className="jee-review">
      <ProgressBar value={(index / queue.length) * 100} label="Review progress" />
      <div className="jee-review-card" aria-live="polite">
        <span className="jee-muted jee-small">{card.kind === 'formula' ? 'Formula' : 'Flashcard'}</span>
        <p className="jee-review-front">{card.front}</p>
        {revealed ? <div className="jee-review-back"><p>{card.back}</p>{card.hint && <small>Hint: {card.hint}</small>}</div>
          : <Button variant="secondary" onClick={() => setRevealed(true)}><Eye size={15} />{' '}<T k="decks:reveal-answer">{"Reveal answer"}</T></Button>}
      </div>
      {revealed && <div className="jee-review-actions jee-review-ratings" role="group" aria-label="Rate this card">
        {CARD_RATINGS.map(rating => <Button key={rating} variant={rating === 'again' ? 'danger' : rating === 'good' ? 'primary' : 'secondary'} onClick={() => void rate(rating)} loading={busy} aria-label={`${RATING_LABELS[rating]} — next review ${ratingPreview(card, rating, gaps)}`}>
          {rating === 'good' && <Check size={15} />}{RATING_LABELS[rating]}<small className="jee-rating-when">{ratingPreview(card, rating, gaps)}</small>
        </Button>)}
      </div>}
    </div>}
  </Dialog>
}

function CardDialog({ card, chapters, subjects, initialChapterId, positionFor, onClose, onSave }: {
  card?: StudyCard; chapters: Chapter[]; subjects: readonly string[]; initialChapterId: string; positionFor: (chapterId: string) => number; onClose: () => void
  onSave: (value: Pick<StudyCard, 'kind' | 'front' | 'back' | 'hint' | 'position' | 'chapter_id'>) => Promise<void>
}) {
  const initialChapter = chapters.find(item => item.id === initialChapterId)
  const [kind, setKind] = useState<CardKind>(card?.kind ?? 'formula')
  const [subject, setSubject] = useState<string>(initialChapter?.subject ?? '')
  const [chapterId, setChapterId] = useState(initialChapter?.id ?? '')
  const [front, setFront] = useState(card?.front ?? '')
  const [back, setBack] = useState(card?.back ?? '')
  const [hint, setHint] = useState(card?.hint ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { notify } = useToast()
  const subjectOptions = [...new Set([...subjects, ...chapters.map(item => item.subject)])].filter(item => chapters.some(chapter => chapter.subject === item))
  const chapterOptions = chapters.filter(item => item.subject === subject)
  const changeSubject = (next: string) => {
    setSubject(next)
    if (!chapters.some(item => item.id === chapterId && item.subject === next)) setChapterId('')
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    const target = chapters.find(item => item.id === chapterId)
    if (!subject) { setError('Choose a subject.'); return }
    if (!target || target.subject !== subject) { setError('Choose a chapter from the selected subject.'); return }
    if (!front.trim() || !back.trim()) { setError('Both the front and the answer are needed.'); return }
    if (front.length > 5000 || back.length > 10000 || hint.length > 2000) { setError('Keep the front under 5000, the answer under 10000, and the hint under 2000 characters.'); return }
    setSaving(true)
    const position = card && card.chapter_id === target.id ? card.position : positionFor(target.id)
    try { await onSave({ kind, front: front.trim(), back: back.trim(), hint: hint.trim(), position, chapter_id: target.id }); onClose() }
    catch (saveError) { notify(saveError instanceof Error ? saveError.message : 'Could not save the card.', 'error') }
    finally { setSaving(false) }
  }
  return <Dialog title={card ? 'Edit card' : 'New card'} onClose={onClose} className="jee-dialog">
    <form className="form-stack" noValidate onSubmit={submit}>
      <div className="form-grid two">
        <Field lk="decks:subject" label="Subject" required><select value={subject} onChange={event => changeSubject(event.target.value)}><option value="" disabled>Choose a subject</option>{subjectOptions.map(item => <option key={item} value={item}>{item}</option>)}</select></Field>
        <Field lk="decks:chapter" label="Chapter" required><select value={chapterId} onChange={event => setChapterId(event.target.value)} disabled={!subject}><option value="" disabled>{subject ? 'Choose a chapter' : 'Pick a subject first'}</option>{chapterOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      </div>
      <Field lk="decks:deck" label="Deck"><select value={kind} onChange={event => setKind(event.target.value as CardKind)}><option value="formula">Formula</option><option value="flashcard">Flashcard</option></select></Field>
      <Field label={kind === 'formula' ? 'Formula name or prompt' : 'Question'} required><textarea rows={2} maxLength={5000} value={front} onChange={event => setFront(event.target.value)} placeholder={kind === 'formula' ? 'e.g. Capacitance of parallel plates' : 'e.g. Why does a conductor have zero field inside?'} /></Field>
      <Field label={kind === 'formula' ? 'Formula' : 'Answer'} required><textarea rows={3} maxLength={10000} value={back} onChange={event => setBack(event.target.value)} placeholder={kind === 'formula' ? 'C = ε₀A / d' : 'Charges redistribute so the field cancels inside.'} /></Field>
      <Field lk="decks:hint-optional" label="Hint (optional)"><input maxLength={2000} value={hint} onChange={event => setHint(event.target.value)} /></Field>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}><T k="decks:cancel">{"Cancel"}</T></Button><Button type="submit" loading={saving}>{card ? 'Save card' : 'Add card'} <Check size={16} /></Button></div>
    </form>
  </Dialog>
}

/**
 * Paste a list of cards instead of typing them one at a time. One card per line, either
 * `front | back` or a plain line (front = line, back = blank). Mirrors the existing
 * "formula cards from chapter notes" import, but for anything the student has already written.
 */
function PasteCardsDialog({ chapter, onClose, onSave }: {
  chapter: Chapter; onClose: () => void; onSave: (cards: StudyCard[]) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<CardKind>('flashcard')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { notify } = useToast()
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const parsed = lines.map((line, index) => {
    const [front, ...rest] = line.split('|')
    return { front: (front ?? '').trim().slice(0, 4900), back: rest.join('|').trim().slice(0, 9900), index }
  }).filter(card => card.front.length > 0)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (!parsed.length) { setError('Add at least one line.'); return }
    if (parsed.length > 300) { setError('Paste up to 300 cards at a time.'); return }
    setSaving(true)
    const now = new Date().toISOString()
    try {
      await onSave(parsed.map((card, offset) => ({
        id: createId(), chapter_id: chapter.id, kind, front: card.front, back: card.back,
        hint: '', position: offset, difficulty: null, reviews: 0, last_reviewed_at: null,
        next_review_at: null, last_rating: null, created_at: now, updated_at: now
      })))
      onClose()
    } catch (caught) { notify(caught instanceof Error ? caught.message : 'Could not add the cards.', 'error') }
    finally { setSaving(false) }
  }
  return <Dialog lk="decks:paste-cards" title="Paste cards" subtitle="One card per line: front | back." onClose={onClose} className="jee-dialog">
    <form className="form-stack" noValidate onSubmit={submit}>
      <Field lk="decks:l-kind" label="Add as"><select value={kind} onChange={event => setKind(event.target.value as CardKind)}><option value="flashcard">Flashcards</option><option value="formula">Formulas</option></select></Field>
      <Field lk="decks:l-cards" label="Cards" hint={`${parsed.length} ready · ${chapter.name}`}><textarea rows={8} maxLength={40000} value={text} onChange={event => { setText(event.target.value); setError(null) }} placeholder={'Newton’s second law | F = ma\nAngular momentum | L = Iω'} /></Field>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving} disabled={!parsed.length}>Add {parsed.length || ''} card{parsed.length === 1 ? '' : 's'}</Button></div>
    </form>
  </Dialog>
}
