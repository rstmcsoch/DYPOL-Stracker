import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useData, type DataContextValue } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { useTheme } from '../contexts/AppearanceContext'
import { createId } from '../shared/lib/id'
import { indiaToday, prettyDate } from '../shared/lib/date'
import { dueCards, reviewCard, type CardRating } from '../shared/lib/jee/cards'
import { SUBJECTS, type CardKind, type StudyCard, type Subject } from '../shared/types'
import { AlarmClock, Check, Eye, Pencil, Plus, Sigma, Trash2, WandSparkles } from '../components/icons'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Overlays'
import { Screen } from '../components/ui/Screen'
import { SelectField, TextField } from '../components/ui/Forms'
import { ProgressBar } from '../components/ui/Progress'
import { OverflowMenu } from '../components/ui/OverflowMenu'
import { EmptyState, NotebookCard, PageHeader, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui/Surfaces'
import { ChapterSelect, ChipFilter } from '../components/jee/shared'

type KindFilter = 'all' | CardKind

/** Formula and flashcard decks on the R1 → R7 → R30 ladder. Due cards also surface in Study now. */
export function DecksScreen() {
  const theme = useTheme()
  const params = useLocalSearchParams<{ chapter?: string }>()
  const { data, upsert, remove, upsertMany, refresh, syncState } = useData()
  const { notify } = useToast()
  const today = indiaToday()
  const dueOverall = useMemo(() => dueCards(data.studyCards, today), [data.studyCards, today])
  const defaultChapter = (typeof params.chapter === 'string' ? params.chapter : '') || dueOverall[0]?.chapter_id || data.chapters.find(chapter => chapter.formula_notes.trim())?.id || data.chapters[0]?.id || ''
  const [chapterId, setChapterId] = useState(defaultChapter)
  const [subject, setSubject] = useState<'all' | Subject>('all')
  const [kind, setKind] = useState<KindFilter>('all')
  const [reviewing, setReviewing] = useState(false)
  const [editing, setEditing] = useState<StudyCard | 'new' | null>(null)
  const chapter = data.chapters.find(item => item.id === chapterId)
  const cards = useMemo(() => data.studyCards.filter(card => card.chapter_id === chapterId && (kind === 'all' || card.kind === kind)).sort((a, b) => a.kind.localeCompare(b.kind) || a.position - b.position), [data.studyCards, chapterId, kind])
  const chapterDue = dueCards(data.studyCards, today, chapterId)
  const gaps = data.settings.revision_gaps

  const removeCard = async (card: StudyCard) => {
    try {
      await remove('study_cards', card)
      notify('Card removed. Undo is available briefly.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not remove this card.', 'error')
    }
  }

  const importFormulaNotes = async () => {
    if (!chapter) return
    const lines = chapter.formula_notes.split('\n').map(line => line.trim()).filter(Boolean)
    const existing = new Set(data.studyCards.filter(card => card.chapter_id === chapter.id && card.kind === 'formula').map(card => card.back))
    const fresh = lines.filter(line => !existing.has(line)).slice(0, 200)
    if (!fresh.length) {
      notify('Every formula line in this chapter is already a card.')
      return
    }
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
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not import formulas.', 'error')
    }
  }

  return (
    <Screen refreshing={syncState === 'syncing'} onRefresh={() => void refresh()}>
      <PageHeader
        eyebrow="FORMULAS & FLASHCARDS ON THE R1 → R7 → R30 LADDER"
        title="Formula & flashcards"
        subtitle="Cards you know move out to R7, then R30. Difficult ones come back tomorrow. Due cards also surface in Study now."
        action={<Button onPress={() => setEditing('new')} disabled={!chapterId} icon={<Plus size={16} color={theme.colors.buttonPrimaryInk} />}>New card</Button>}
      />
      <View style={styles.statGrid}>
        <Stat label="Due overall" value={dueOverall.length} note="across all chapters" />
        <Stat label="Due in this chapter" value={chapterDue.length} note={chapter?.name ?? 'Pick a chapter'} />
        <Stat label="Cards" value={data.studyCards.length} note="formulas and flashcards" />
      </View>

      <NotebookCard padding={14} style={{ gap: 12 }}>
        <SelectField<'all' | Subject>
          label="Subject"
          value={subject}
          options={[{ value: 'all', label: 'All subjects' }, ...SUBJECTS.map(item => ({ value: item, label: item }))]}
          onChange={setSubject}
        />
        <ChapterSelect chapters={data.chapters} value={chapterId} onChange={setChapterId} subject={subject} label="Chapter" />
        <ChipFilter<KindFilter> label="Deck" value={kind} onChange={setKind} options={[{ value: 'all', label: 'Both' }, { value: 'formula', label: 'Formulas' }, { value: 'flashcard', label: 'Flashcards' }]} />
      </NotebookCard>

      {!chapter ? (
        <NotebookCard><EmptyState title="No chapter selected." description="Pick a chapter to open its decks." /></NotebookCard>
      ) : (
        <>
          <View style={styles.actions}>
            <Button onPress={() => setReviewing(true)} disabled={chapterDue.length === 0} icon={<Eye size={16} color={theme.colors.buttonPrimaryInk} />}>Review {chapterDue.length} due</Button>
            {chapter.formula_notes.trim() ? <Button variant="secondary" onPress={() => void importFormulaNotes()} icon={<WandSparkles size={15} color={theme.colors.ink} />}>Make formula cards from chapter notes</Button> : null}
          </View>

          <SectionHeading title={chapter.name} note={`${cards.length} card${cards.length === 1 ? '' : 's'} in view · ${gaps.map(gap => `R${gap}`).join(' → ')} ladder`} action={<SubjectBadge subject={chapter.subject} />} />
          {cards.length === 0 ? (
            <NotebookCard>
              <EmptyState icon={<Sigma size={24} color={theme.colors.muted} />} title="No cards in this deck yet." description="Add a formula you keep forgetting, or a question you want to rehearse. Cards stay private to your account." action={<Button variant="secondary" size="sm" onPress={() => setEditing('new')} icon={<Plus size={15} color={theme.colors.ink} />}>Add a card</Button>} />
            </NotebookCard>
          ) : (
            <View style={{ gap: 10 }}>
              {cards.map(card => {
                const isDue = dueCards([card], today).length > 0
                return (
                  <NotebookCard key={card.id} padding={14} style={{ gap: 8 }}>
                    <View style={styles.cardHead}>
                      <StatusBadge tone={card.kind === 'formula' ? 'warn' : 'good'}>{card.kind === 'formula' ? 'Formula' : 'Flashcard'}</StatusBadge>
                      {isDue ? <StatusBadge tone="bad">Due</StatusBadge> : card.next_review_at ? (
                        <View style={styles.inline}><AlarmClock size={12} color={theme.colors.muted} /><Text style={[theme.type.badge, { color: theme.colors.muted }]}>{prettyDate(card.next_review_at.slice(0, 10))}</Text></View>
                      ) : null}
                      {card.difficulty === 'difficult' ? <StatusBadge tone="bad">Difficult</StatusBadge> : null}
                      <View style={{ marginLeft: 'auto' }}>
                        <OverflowMenu label={`Actions for card ${card.front}`} title="Card" items={[
                          { id: 'edit', label: 'Edit', icon: <Pencil size={15} color={theme.colors.ink} />, onSelect: () => setEditing(card) },
                          { id: 'delete', label: 'Delete', icon: <Trash2 size={15} color={theme.colors.red} />, danger: true, onSelect: () => void removeCard(card) }
                        ]} />
                      </View>
                    </View>
                    <Text accessibilityRole="header" style={[theme.type.label, { color: theme.colors.ink }]}>{card.front}</Text>
                    <CardBack card={card} />
                    <Text style={[theme.type.badge, { color: theme.colors.muted }]}>Reviewed {card.reviews} time{card.reviews === 1 ? '' : 's'}</Text>
                  </NotebookCard>
                )
              })}
            </View>
          )}
        </>
      )}

      {reviewing && chapter ? (
        <ReviewDialog cards={chapterDue} chapterName={chapter.name} gaps={gaps} onClose={() => setReviewing(false)} onRate={async (card, rating) => {
          const updated = reviewCard(card, rating, gaps, new Date())
          await upsert('study_cards', updated)
          return updated
        }} />
      ) : null}
      {editing && chapter ? (
        <CardDialog
          key={editing === 'new' ? 'new' : editing.id}
          card={editing === 'new' ? undefined : editing}
          chapterId={chapter.id}
          nextPosition={cards.length}
          onClose={() => setEditing(null)}
          upsert={upsert}
          editing={editing}
          notifyText="Card saved."
        />
      ) : null}
    </Screen>
  )
}

function CardBack({ card }: { card: StudyCard }) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  return (
    <View style={[styles.back, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={styles.backHead}>
        <Text style={[theme.type.label, { color: theme.colors.accent }]}>{open ? 'Hide answer' : 'Show answer'}</Text>
      </Pressable>
      {open ? (
        <View style={{ gap: 4 }}>
          <Text style={[theme.type.body, { color: theme.colors.inkSoft }]}>{card.back}</Text>
          {card.hint ? <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Hint: {card.hint}</Text> : null}
        </View>
      ) : null}
    </View>
  )
}

function ReviewDialog({ cards, chapterName, gaps, onClose, onRate }: {
  cards: StudyCard[]
  chapterName: string
  gaps: number[]
  onClose: () => void
  onRate: (card: StudyCard, rating: CardRating) => Promise<StudyCard>
}) {
  const theme = useTheme()
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
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save this review.', 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog visible onClose={onClose} title={`Review · ${chapterName}`} subtitle={`${gaps.map(gap => `R${gap}`).join(' → ')} schedule · ${Math.min(index + 1, queue.length)} of ${queue.length}`}>
      {finished || !card ? (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 12 }}>
          <Check size={26} color={theme.colors.green} />
          <Text style={[theme.type.h3, { color: theme.colors.ink }]}>Session complete</Text>
          <Text style={[theme.type.caption, { color: theme.colors.inkSoft, textAlign: 'center' }]}>{stats.known} known · {stats.difficult} difficult. Known cards are scheduled further out; difficult ones return tomorrow.</Text>
          <Button onPress={onClose}>Done</Button>
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <ProgressBar value={(index / queue.length) * 100} label="Review progress" />
          <View style={[styles.reviewCard, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]} accessibilityLiveRegion="polite">
            <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{card.kind === 'formula' ? 'Formula' : 'Flashcard'}</Text>
            <Text style={[theme.type.h3, { color: theme.colors.ink }]}>{card.front}</Text>
            {revealed ? (
              <View style={{ gap: 6 }}>
                <Text style={[theme.type.body, { color: theme.colors.inkSoft }]}>{card.back}</Text>
                {card.hint ? <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Hint: {card.hint}</Text> : null}
              </View>
            ) : (
              <Button variant="secondary" onPress={() => setRevealed(true)} icon={<Eye size={15} color={theme.colors.ink} />}>Reveal answer</Button>
            )}
          </View>
          {revealed ? (
            <View style={styles.reviewActions}>
              <Button variant="danger" loading={busy} onPress={() => void rate('difficult')}>Difficult — again tomorrow</Button>
              <Button loading={busy} onPress={() => void rate('known')} icon={<Check size={15} color={theme.colors.buttonPrimaryInk} />}>Known</Button>
            </View>
          ) : null}
        </View>
      )}
    </Dialog>
  )
}

function CardDialog({ card, chapterId, nextPosition, onClose, upsert, editing, notifyText }: {
  card?: StudyCard
  chapterId: string
  nextPosition: number
  onClose: () => void
  upsert: DataContextValue['upsert']
  editing: StudyCard | 'new' | null
  notifyText: string
}) {
  const theme = useTheme()
  const [kind, setKind] = useState<CardKind>(card?.kind ?? 'formula')
  const [front, setFront] = useState(card?.front ?? '')
  const [back, setBack] = useState(card?.back ?? '')
  const [hint, setHint] = useState(card?.hint ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { notify } = useToast()
  const submit = async () => {
    if (saving) return
    if (!front.trim() || !back.trim()) {
      setError('Both the front and the answer are needed.')
      return
    }
    if (front.length > 5000 || back.length > 10000 || hint.length > 2000) {
      setError('Keep the front under 5000, the answer under 10000, and the hint under 2000 characters.')
      return
    }
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const value = { kind, front: front.trim(), back: back.trim(), hint: hint.trim(), position: card?.position ?? nextPosition, chapter_id: chapterId }
      if (editing === 'new' || !card) await upsert('study_cards', { ...value, id: createId(), reviews: 0, last_reviewed_at: null, next_review_at: null, difficulty: null, created_at: now, updated_at: now })
      else await upsert('study_cards', { ...card, ...value, updated_at: now })
      notify(notifyText)
      onClose()
    } catch (saveError) {
      notify(saveError instanceof Error ? saveError.message : 'Could not save the card.', 'error')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog visible onClose={onClose} title={card ? 'Edit card' : 'New card'} subtitle="Formulas and flashcards share one scheduling ladder.">
      <View style={{ gap: 14 }}>
        <SelectField<CardKind> label="Deck" value={kind} options={[{ value: 'formula', label: 'Formula' }, { value: 'flashcard', label: 'Flashcard' }]} onChange={setKind} />
        <TextField label={kind === 'formula' ? 'Formula name or prompt' : 'Question'} required multiline maxLength={5000} value={front} placeholder={kind === 'formula' ? 'e.g. Capacitance of parallel plates' : 'e.g. Why does a conductor have zero field inside?'} onChangeText={setFront} />
        <TextField label={kind === 'formula' ? 'Formula' : 'Answer'} required multiline maxLength={10000} value={back} placeholder={kind === 'formula' ? 'C = ε₀A / d' : 'Charges redistribute so the field cancels inside.'} onChangeText={setBack} />
        <TextField label="Hint (optional)" maxLength={2000} value={hint} onChangeText={setHint} />
        {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.red }}>{error}</Text> : null}
        <View style={styles.dialogActions}>
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button loading={saving} onPress={() => void submit()} icon={<Check size={16} color={theme.colors.buttonPrimaryInk} />}>{card ? 'Save card' : 'Add card'}</Button>
        </View>
      </View>
    </Dialog>
  )
}

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  const theme = useTheme()
  return (
    <NotebookCard padding={14} style={styles.stat}>
      <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{label}</Text>
      <Text style={[theme.type.metric, { color: theme.colors.ink, fontSize: 26, lineHeight: 28 }]}>{value}</Text>
      <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>{note}</Text>
    </NotebookCard>
  )
}

const styles = StyleSheet.create({
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { flexBasis: '47%', flexGrow: 1, gap: 4 },
  actions: { gap: 10 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  back: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 6 },
  backHead: { minHeight: 36, justifyContent: 'center' },
  reviewCard: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 12 },
  reviewActions: { gap: 10 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }
})
