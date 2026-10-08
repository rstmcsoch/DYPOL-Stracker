import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BarChart3, Check, ClipboardList, Edit3, Plus, Target, Timer, Trash2 } from 'lucide-react'
import { Button, Dialog, EmptyState, Field, NotebookCard, OverflowMenu, PageHeader, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui'
import { ChapterSelect, ChipFilter, Meter, Pct, SubjectSelect, minutesLabel } from '../components/jee/shared'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { createId } from '../lib/id'
import { indiaToday, prettyDate, plusDays } from '../lib/date'
import { aggregatePractice, PRACTICE_MIN_ATTEMPTS_FOR_SIGNAL } from '../lib/jee/progress'
import { practiceStudySessionId } from '../lib/jee/ids'
import { validatePractice, type PracticeFormInput, type PracticeValue } from '../lib/jee/forms'
import { PRACTICE_SOURCES, type AppData, type Chapter, type PracticeSession, type PracticeSource, type Subject, type StudySession } from '../types'

type Period = '7' | '30' | '90' | 'all'

export default function PracticePage() {
  const { data, upsert, remove } = useData()
  const { notify } = useToast()
  const [params, setParams] = useSearchParams()
  const [subject, setSubject] = useState<Subject | 'all'>('all')
  const [chapterFilter, setChapterFilter] = useState('')
  const [source, setSource] = useState<PracticeSource | 'all'>('all')
  const [period, setPeriod] = useState<Period>('30')
  const [editing, setEditing] = useState<PracticeSession | null>(null)
  const [creating, setCreating] = useState(params.get('add') === '1')
  const [presetChapter, setPresetChapter] = useState(params.get('chapter') ?? '')
  const today = indiaToday()
  const chapterById = useMemo(() => new Map(data.chapters.map(chapter => [chapter.id, chapter])), [data.chapters])

  const from = period === 'all' ? '' : plusDays(today, -Number(period))
  const filtered = useMemo(() => data.practiceSessions.filter(item => {
    const chapter = chapterById.get(item.chapter_id)
    if (!chapter) return false
    if (subject !== 'all' && chapter.subject !== subject) return false
    if (chapterFilter && item.chapter_id !== chapterFilter) return false
    if (source !== 'all' && item.source !== source) return false
    if (from && item.practice_date < from) return false
    return true
  }).sort((a, b) => b.practice_date.localeCompare(a.practice_date) || b.created_at.localeCompare(a.created_at)), [data.practiceSessions, chapterById, subject, chapterFilter, source, from])

  const overall = aggregatePractice(filtered)
  const byChapter = useMemo(() => {
    const groups = new Map<string, PracticeSession[]>()
    for (const item of filtered) groups.set(item.chapter_id, [...(groups.get(item.chapter_id) ?? []), item])
    return [...groups.entries()].map(([chapterId, sessions]) => ({ chapter: chapterById.get(chapterId)!, agg: aggregatePractice(sessions) }))
      .filter(item => item.chapter).sort((a, b) => b.agg.attempted - a.agg.attempted)
  }, [filtered, chapterById])
  const subjectChapters = data.chapters.filter(chapter => subject === 'all' || chapter.subject === subject)
  const hasAny = data.practiceSessions.length > 0

  const openCreate = (chapterId = '') => {
    setPresetChapter(chapterId); setEditing(null); setCreating(true)
    if (params.get('add')) setParams({}, { replace: true })
  }
  const remover = async (session: PracticeSession) => {
    try { await remove('practice_sessions', session); notify('Practice block removed. Undo is available briefly.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not remove this block.', 'error') }
  }

  return <div className="content-page practice-page">
    <PageHeader
      eyebrow="DPP & PRACTICE, LOGGED SEPARATELY FROM TESTS"
      title="Practice log"
      subtitle="Questions you solved outside mocks — DPPs, modules, sheets. These feed chapter accuracy and Weak areas, but never count as a test."
      action={<Button onClick={() => openCreate()}><Plus size={16} /> Log practice</Button>}
    />

    <section className="jee-stat-grid" aria-label="Practice summary">
      <NotebookCard className="jee-stat"><span>Questions attempted</span><strong>{overall.attempted.toLocaleString('en-IN')}</strong><small>{overall.sessions} block{overall.sessions === 1 ? '' : 's'} in view</small></NotebookCard>
      <NotebookCard className="jee-stat"><span>Accuracy</span><strong><Pct value={overall.accuracy} digits={1} /></strong><small>{overall.correct} correct · {overall.incorrect} incorrect</small></NotebookCard>
      <NotebookCard className="jee-stat"><span>Recent accuracy</span><strong><Pct value={overall.recentAccuracy} digits={1} /></strong><small>last three blocks</small></NotebookCard>
      <NotebookCard className="jee-stat"><span>Practice volume</span><strong>{minutesLabel(overall.timeMinutes)}</strong><small>time recorded in view</small></NotebookCard>
    </section>

    <NotebookCard className="jee-filter-card">
      <div className="jee-filter-grid">
        <SubjectSelect value={subject} onChange={value => { setSubject(value as Subject | 'all'); setChapterFilter('') }} />
        <ChapterSelect chapters={subjectChapters} value={chapterFilter} onChange={setChapterFilter} allowNone noneLabel="All chapters" subject={subject} label="Chapter" />
        <label className="jee-select"><span>Source</span><select value={source} onChange={event => setSource(event.target.value as PracticeSource | 'all')}><option value="all">All sources</option>{PRACTICE_SOURCES.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
      <ChipFilter<Period> label="Date" value={period} onChange={setPeriod} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: 'all', label: 'All time' }]} />
    </NotebookCard>

    {!hasAny ? <NotebookCard><EmptyState icon={<ClipboardList size={26} />} title="No practice logged yet." description="Log a DPP or module block with how many you attempted and got right. Accuracy by chapter appears here straight away." action={<Button variant="secondary" size="sm" onClick={() => openCreate()}><Plus size={15} /> Log your first block</Button>} /></NotebookCard>
    : <div className="jee-two-col">
      <section>
        <SectionHeading title="Chapter performance" note={`${byChapter.length} chapter${byChapter.length === 1 ? '' : 's'} with practice in view`} />
        {byChapter.length === 0 ? <NotebookCard><EmptyState icon={<Target size={22} />} title="Nothing matches these filters." description="Widen the date range or clear the chapter or source filter." /></NotebookCard> : <div className="jee-chapter-list">
          {byChapter.map(({ chapter, agg }) => <ChapterPracticeRow key={chapter.id} chapter={chapter} agg={agg} weakThreshold={data.settings.weak_threshold} onLog={() => openCreate(chapter.id)} />)}
        </div>}
      </section>
      <section>
        <SectionHeading title="History" note="Newest first. Edit or remove any block." />
        <NotebookCard className="jee-history-card">
          {filtered.length === 0 ? <p className="jee-muted jee-pad">No blocks in this view.</p> : <ul className="jee-history-list">
            {filtered.slice(0, 80).map(item => {
              const chapter = chapterById.get(item.chapter_id)
              const accuracy = item.attempted > 0 ? (item.correct / item.attempted) * 100 : null
              return <li key={item.id} className="jee-history-row">
                <div className="jee-history-main">
                  <strong>{chapter?.name}</strong>
                  <div className="jee-row-meta">
                    {chapter && <SubjectBadge subject={chapter.subject} />}
                    <span>{prettyDate(item.practice_date)}</span>
                    <StatusBadge tone="muted">{item.source}</StatusBadge>
                  </div>
                  <div className="jee-row-numbers">
                    <span><b>{item.attempted}</b> attempted</span>
                    <span><b>{item.correct}</b> correct</span>
                    <span><b>{item.incorrect}</b> incorrect</span>
                    <span><b><Pct value={accuracy} digits={0} /></b> accuracy</span>
                    {item.time_minutes !== null && <span><Timer size={12} aria-hidden="true" /> {minutesLabel(item.time_minutes)}</span>}
                  </div>
                  {item.notes && <p className="jee-note">{item.notes}</p>}
                </div>
                <OverflowMenu label={`Actions for ${chapter?.name ?? 'practice block'} on ${item.practice_date}`} items={[
                  { id: 'edit', label: 'Edit block', icon: <Edit3 size={15} />, onSelect: () => { setCreating(false); setEditing(item) } },
                  { id: 'delete', label: 'Delete block', icon: <Trash2 size={15} />, danger: true, onSelect: () => void remover(item) }
                ]} />
              </li>
            })}
          </ul>}
          {filtered.length > 80 && <p className="jee-muted jee-pad">Showing the newest 80 of {filtered.length}. Narrow the filters to see older blocks.</p>}
        </NotebookCard>
      </section>
    </div>}

    {creating && <PracticeDialog key={`new-${presetChapter}`} data={data} initialChapterId={presetChapter} onClose={() => setCreating(false)} onSave={async value => {
      const id = createId()
      await savePractice(id, value, data, upsert, remove)
      notify('Practice logged. Chapter accuracy is updated.')
    }} />}
    {editing && <PracticeDialog key={editing.id} data={data} existing={editing} onClose={() => setEditing(null)} onSave={async value => {
      await savePractice(editing.id, value, data, upsert, remove, editing.created_at)
      notify('Practice block updated.')
    }} />}
  </div>
}

async function savePractice(id: string, value: PracticeValue, data: AppData, upsert: ReturnType<typeof useData>['upsert'], remove: ReturnType<typeof useData>['remove'], createdAt?: string) {
  const now = new Date().toISOString()
  const existing = data.practiceSessions.find(item => item.id === id)
  const record: PracticeSession = {
    id, chapter_id: value.chapter_id, practice_date: value.practice_date, attempted: value.attempted, correct: value.correct,
    incorrect: value.incorrect, source: value.source, time_minutes: value.time_minutes, notes: value.notes,
    created_at: createdAt ?? existing?.created_at ?? now, updated_at: now
  }
  await upsert('practice_sessions', record)
  // Mirror the practice minutes into study time (Practice activity) under a stable ID, so
  // the study split and streaks see it without double counting on later edits.
  const chapter = data.chapters.find(item => item.id === value.chapter_id)
  const studyId = practiceStudySessionId(id)
  const studyExisting = data.sessions.find(item => item.id === studyId)
  if (value.time_minutes && value.time_minutes > 0) {
    const session: StudySession = {
      id: studyId, subject: chapter?.subject ?? null, chapter_id: value.chapter_id,
      started_at: `${value.practice_date}T12:00:00.000+05:30`, ended_at: null,
      duration_minutes: value.time_minutes, completion_state: 'completed', mode: 'Custom', activity: 'Practice',
      created_at: studyExisting?.created_at ?? now, updated_at: now
    }
    await upsert('study_sessions', session)
  } else if (studyExisting) {
    await remove('study_sessions', studyExisting, { undo: false })
  }
}

function ChapterPracticeRow({ chapter, agg, weakThreshold, onLog }: { chapter: Chapter; agg: ReturnType<typeof aggregatePractice>; weakThreshold: number; onLog: () => void }) {
  const weak = agg.attempted >= PRACTICE_MIN_ATTEMPTS_FOR_SIGNAL && agg.accuracy !== null && agg.accuracy < weakThreshold
  const trend = agg.recentAccuracy !== null && agg.accuracy !== null ? agg.recentAccuracy - agg.accuracy : null
  return <NotebookCard className={`jee-chapter-row ${weak ? 'is-weak' : ''}`}>
    <div className="jee-chapter-row-head">
      <div><strong>{chapter.name}</strong><div className="jee-row-meta"><SubjectBadge subject={chapter.subject} />{weak && <StatusBadge tone="weak">Practice weak</StatusBadge>}</div></div>
      <Button variant="quiet" size="sm" onClick={onLog}><Plus size={14} /> Log</Button>
    </div>
    <div className="jee-chapter-row-stats">
      <span><b>{agg.attempted}</b> attempted</span>
      <span><b><Pct value={agg.accuracy} digits={0} /></b> accuracy</span>
      <span>recent <b><Pct value={agg.recentAccuracy} digits={0} /></b>{trend !== null && trend !== 0 && <em className={trend > 0 ? 'jee-up' : 'jee-down'}>{trend > 0 ? '▲' : '▼'} {Math.abs(Math.round(trend))}</em>}</span>
      <span><b>{agg.incorrect}</b> incorrect</span>
    </div>
    <Meter value={agg.accuracy} label={`${chapter.name} practice accuracy`} tone={weak ? 'orange' : 'green'} />
    <p className="jee-muted jee-small">{agg.sessions} block{agg.sessions === 1 ? '' : 's'}{agg.timeMinutes ? ` · ${minutesLabel(agg.timeMinutes)}` : ''}{agg.attempted < PRACTICE_MIN_ATTEMPTS_FOR_SIGNAL ? ` · needs ${PRACTICE_MIN_ATTEMPTS_FOR_SIGNAL} questions before it flags weakness` : ''}</p>
  </NotebookCard>
}

function PracticeDialog({ data, initialChapterId = '', existing, onClose, onSave }: {
  data: AppData; initialChapterId?: string; existing?: PracticeSession; onClose: () => void
  onSave: (value: PracticeValue) => Promise<void>
}) {
  const today = indiaToday()
  const initialChapter = existing ? data.chapters.find(item => item.id === existing.chapter_id) : data.chapters.find(item => item.id === initialChapterId)
  const [subject, setSubject] = useState<Subject | 'all'>(initialChapter?.subject ?? 'all')
  const [form, setForm] = useState<PracticeFormInput>({
    chapterId: existing?.chapter_id ?? initialChapterId,
    date: existing?.practice_date ?? today,
    attempted: existing ? String(existing.attempted) : '',
    correct: existing ? String(existing.correct) : '',
    incorrect: existing ? String(existing.incorrect) : '',
    source: existing?.source ?? 'DPP',
    minutes: existing?.time_minutes != null ? String(existing.time_minutes) : '',
    notes: existing?.notes ?? ''
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const { notify } = useToast()
  const set = (key: keyof PracticeFormInput, value: string) => {
    setForm(current => ({ ...current, [key]: value }))
    setErrors(current => { const next = { ...current }; delete next[key]; return next })
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    const result = validatePractice(form, today)
    if (!result.ok) { setErrors(result.errors); notify('Check the highlighted fields.', 'error'); return }
    setSaving(true)
    try { await onSave(result.value); onClose() }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save this block.', 'error') }
    finally { setSaving(false) }
  }
  const attempted = Number(form.attempted)
  const correct = Number(form.correct)
  const accuracy = attempted > 0 && Number.isFinite(correct) && form.correct !== '' ? (correct / attempted) * 100 : null
  return <Dialog title={existing ? 'Edit practice block' : 'Log practice'} subtitle="Questions you attempted outside tests. Correct + incorrect can’t exceed attempted." onClose={onClose} className="jee-dialog">
    <form className="form-stack" noValidate onSubmit={submit}>
      <div className="form-grid two">
        <SubjectSelect value={subject} onChange={value => { setSubject(value as Subject | 'all'); set('chapterId', '') }} allowAll label="Subject filter" />
        <Field label="Date" error={errors.date} required><input type="date" max={today} value={form.date} onChange={event => set('date', event.target.value)} /></Field>
      </div>
      <div className="jee-field-wide"><ChapterSelect chapters={data.chapters} value={form.chapterId} onChange={value => set('chapterId', value)} subject={subject} label="Chapter" /></div>
      {errors.chapterId && <p className="field-error" role="alert">{errors.chapterId}</p>}
      <div className="form-grid three">
        <Field label="Attempted" error={errors.attempted} required><input inputMode="numeric" value={form.attempted} onChange={event => set('attempted', event.target.value)} placeholder="120" /></Field>
        <Field label="Correct" error={errors.correct} required><input inputMode="numeric" value={form.correct} onChange={event => set('correct', event.target.value)} placeholder="92" /></Field>
        <Field label="Incorrect" error={errors.incorrect} required><input inputMode="numeric" value={form.incorrect} onChange={event => set('incorrect', event.target.value)} placeholder="28" /></Field>
      </div>
      <div className="form-grid two">
        <Field label="Source"><select value={form.source} onChange={event => set('source', event.target.value)}>{PRACTICE_SOURCES.map(item => <option key={item} value={item}>{item}</option>)}</select></Field>
        <Field label="Time spent (min, optional)" error={errors.minutes}><input inputMode="numeric" value={form.minutes} onChange={event => set('minutes', event.target.value)} placeholder="45" /></Field>
      </div>
      <Field label="Notes (optional)" error={errors.notes}><textarea rows={2} maxLength={5000} value={form.notes} onChange={event => set('notes', event.target.value)} placeholder="e.g. DPP 7, Q14–20 were gauss-law heavy" /></Field>
      <div className="jee-live-accuracy" aria-live="polite"><BarChart3 size={15} aria-hidden="true" /> Accuracy: <strong>{accuracy === null ? '—' : `${accuracy.toFixed(1)}%`}</strong>{accuracy !== null && <span className="jee-muted"> ({form.correct} of {form.attempted})</span>}</div>
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>{existing ? 'Save changes' : 'Log practice'} <Check size={16} /></Button></div>
    </form>
  </Dialog>
}

