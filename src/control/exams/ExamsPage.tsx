import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, EyeOff, Eye, Pencil, Plus } from 'lucide-react'
import { PageHeader } from '../pageParts'
import { Button, Panel } from '../ui'
import { controlFetch } from '../api'
import { EXAM_ID_PATTERN, examYears, groupByCategory, type ExamDefinition } from '../../lib/exams/catalog'
import { parsePapersText, parsePerSubjectText, papersText, perSubjectText, validateMarkingScheme, type MarkingScheme } from '../../lib/exams/marking'
import { AI_MODEL_PROVIDERS, type AIModelProvider } from '../../lib/ai/model-preferences'
import { DEFAULT_MODEL_PREFERENCES } from '../../lib/ai/model-ranking'

type ListResponse = { ok: true; exams: ExamDefinition[]; aiModelPreferences: Record<AIModelProvider, string[]>; aiModelPreferencesStored?: boolean }
type Draft = { id: string; name: string; category: string; years: string; sessions: string; boards: string; boards_addon: boolean; subjects: string; session_label: string; hidden: boolean; isNew: boolean; markingFullTotal: string; markingOtherTotal: string; markingFullSubjects: string; markingOtherSubjects: string; markingFullDefault: string; markingOtherDefault: string; markingPapers: string; markingCombine: MarkingScheme['combine']; markingSource: string; markingNotes: string }

const splitList = (value: string) => value.split(/[\n,]/).map(item => item.trim()).filter(Boolean)
const toDraft = (exam?: ExamDefinition): Draft => {
  const marking = exam?.marking_scheme ?? null
  const base = { markingFullTotal: marking?.full.total?.toString() ?? '', markingOtherTotal: marking?.other.total?.toString() ?? '', markingFullSubjects: marking ? perSubjectText(marking.full.perSubject) : '', markingOtherSubjects: marking ? perSubjectText(marking.other.perSubject) : '', markingFullDefault: marking?.full.defaultPerSubject?.toString() ?? '', markingOtherDefault: marking?.other.defaultPerSubject?.toString() ?? '', markingPapers: papersText(marking?.full.papers), markingCombine: marking?.combine ?? 'sum_subjects' as MarkingScheme['combine'], markingSource: marking?.source ?? '', markingNotes: marking?.notes ?? '' }
  return exam
    ? { id: exam.id, name: exam.name, category: exam.category, years: exam.years.join(', '), sessions: exam.sessions.join(', '), boards: exam.boards.join(', '), boards_addon: exam.boards_addon, subjects: exam.subjects.join('\n'), session_label: exam.session_label, hidden: exam.hidden, isNew: false, ...base }
    : { id: '', name: '', category: '', years: '', sessions: '', boards: '', boards_addon: false, subjects: '', session_label: '', hidden: false, isNew: true, ...base }
}

const PROVIDER_LABELS: Record<AIModelProvider, string> = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Anthropic (Claude)', deepseek: 'DeepSeek', qwen: 'Qwen' }

function AiModelPreferencesPanel({ initial, saving, onSave }: { initial: Record<AIModelProvider, string[]>; saving: boolean; onSave: (prefs: Record<AIModelProvider, string[]>) => Promise<void> }) {
  const [lists, setLists] = useState<Record<AIModelProvider, string>>(() => Object.fromEntries(AI_MODEL_PROVIDERS.map(provider => [provider, initial[provider].join('\n')])) as Record<AIModelProvider, string>)
  const [dirty, setDirty] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { if (!dirty) setLists(Object.fromEntries(AI_MODEL_PROVIDERS.map(provider => [provider, initial[provider].join('\n')])) as Record<AIModelProvider, string>) }, [initial, dirty])
  const submit = () => {
    const prefs = {} as Record<AIModelProvider, string[]>
    for (const provider of AI_MODEL_PROVIDERS) {
      const list = lists[provider].split('\n').map(item => item.trim()).filter(Boolean)
      if (!list.length || list.length > 12 || new Set(list).size !== list.length || list.some(item => !/^[A-Za-z0-9][A-Za-z0-9._/*:-]{0,199}$/.test(item))) { setProblem(`${PROVIDER_LABELS[provider]} needs 1–12 unique model IDs or * patterns, one per line.`); return }
      prefs[provider] = list
    }
    setProblem(null)
    // Dirty clears only once the save has actually succeeded, so a failed save keeps the edits retryable.
    void onSave(prefs).then(() => setDirty(false)).catch(() => undefined)
  }
  return <Panel title="AI default models" description="Ranked lists used when a student adds a provider key. * matches a version (gemini-*-flash = newest flash first). The student's key must list the model and it must pass the timed auto-test; otherwise the next entry is tried.">
    <div className="cc-stack cc-exam-form">
      {problem && <p className="cc-field__error" role="alert">{problem}</p>}
      {AI_MODEL_PROVIDERS.map(provider => <label key={provider}>{PROVIDER_LABELS[provider]} — best first (one per line)<textarea rows={4} value={lists[provider]} onChange={event => { setDirty(true); setLists(current => ({ ...current, [provider]: event.target.value })) }} /></label>)}
      <div className="cc-row">
        <Button variant="primary" size="sm" disabled={saving} onClick={submit}>{saving ? 'Saving…' : 'Save AI model lists'}</Button>
        <Button variant="ghost" size="sm" disabled={saving} onClick={() => { setDirty(true); setProblem(null); setLists(Object.fromEntries(AI_MODEL_PROVIDERS.map(provider => [provider, DEFAULT_MODEL_PREFERENCES[provider].join('\n')])) as Record<AIModelProvider, string>) }}>Reset to built-in lists</Button>
      </div>
    </div>
  </Panel>
}

/** Owner-only exam catalogue. Removing an exam hides it; students already on it keep it. */
export default function ExamsPage() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['control', 'exams'], queryFn: () => controlFetch<ListResponse>('exams') })
  const exams = useMemo(() => query.data?.exams ?? [], [query.data])
  const [draft, setDraft] = useState<Draft | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const editorKey = draft ? `${draft.isNew ? 'new' : draft.id}` : null
  useEffect(() => {
    if (!editorKey) return
    editorRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    editorRef.current?.querySelector<HTMLElement>('input:not([disabled]), textarea, select')?.focus({ preventScroll: true })
  }, [editorKey])
  const [problem, setProblem] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = () => client.invalidateQueries({ queryKey: ['control', 'exams'] })
  const fail = (error: unknown) => setProblem(error instanceof Error ? error.message : 'That did not work. Nothing changed.')
  type ExamListData = ListResponse
  const patchCachedExams = (patch: (list: ExamDefinition[]) => ExamDefinition[]) => {
    client.setQueryData<ExamListData>(['control', 'exams'], current => current ? { ...current, exams: patch(current.exams) } : current)
  }
  const save = useMutation({
    mutationFn: (exam: Omit<ExamDefinition, 'sort_order' | 'subjects' | 'session_label' | 'marking_scheme'> & { sort_order?: number; subjects?: string[]; session_label?: string; marking_scheme?: unknown }) => controlFetch('exams', { method: 'PUT', body: { exam } }),
    onSuccess: () => { setDraft(null); setProblem(null); setNotice('Saved. Students see the change the next time the exam list loads.'); void refresh() },
    onError: fail
  })
  // Hide/show flips in the list immediately; only the clicked exam's button is busy, and a
  // failure rolls the row back. This never disables the rest of the section.
  const toggle = useMutation({
    mutationFn: (exam: ExamDefinition) => controlFetch('exams', { method: 'PUT', body: { exam: { id: exam.id, name: exam.name, category: exam.category, years: exam.years, sessions: exam.sessions, boards: exam.boards, boards_addon: exam.boards_addon, sort_order: exam.sort_order, hidden: !exam.hidden } } }),
    onMutate: async exam => {
      await client.cancelQueries({ queryKey: ['control', 'exams'] })
      const previous = client.getQueryData<ExamListData>(['control', 'exams'])
      patchCachedExams(list => list.map(item => item.id === exam.id ? { ...item, hidden: !exam.hidden } : item))
      return { previous }
    },
    onError: (error, _exam, context) => { if (context?.previous) client.setQueryData(['control', 'exams'], context.previous); fail(error) },
    onSuccess: () => { setProblem(null); setNotice('Saved. Students see the change the next time the exam list loads.') },
    onSettled: () => { void refresh() }
  })
  // Reorder is optimistic too: the row moves on click, the server catches up, and only the
  // moved exam's arrows are disabled while its write is in flight.
  const reorder = useMutation({
    mutationFn: (request: { order: string[]; movedId: string }) => controlFetch('exams', { method: 'POST', body: { order: request.order } }),
    onMutate: async request => {
      await client.cancelQueries({ queryKey: ['control', 'exams'] })
      const previous = client.getQueryData<ExamListData>(['control', 'exams'])
      if (previous) {
        const byId = new Map(previous.exams.map(exam => [exam.id, exam]))
        patchCachedExams(() => request.order.map((id, index) => {
          const exam = byId.get(id)
          return exam ? { ...exam, sort_order: (index + 1) * 10 } : exam
        }).filter((exam): exam is ExamDefinition => Boolean(exam)))
      }
      return { previous }
    },
    onError: (error, _request, context) => { if (context?.previous) client.setQueryData(['control', 'exams'], context.previous); fail(error) },
    onSuccess: () => setProblem(null),
    onSettled: () => { void refresh() }
  })
  const savePreferences = useMutation({
    mutationFn: (aiModelPreferences: Record<AIModelProvider, string[]>) => controlFetch('exams', { method: 'PUT', body: { aiModelPreferences } }),
    onSuccess: () => { setProblem(null); setNotice('AI default model lists saved. Students get the new ranking the next time they add or discover models for a key.'); void refresh() },
    onError: fail
  })

  const submit = () => {
    if (!draft) return
    const id = draft.id.trim()
    if (!EXAM_ID_PATTERN.test(id)) { setProblem('Use 2–40 lowercase letters, numbers or dashes for the id, e.g. "neet-pg".'); return }
    if (draft.isNew && exams.some(exam => exam.id === id)) { setProblem('That id is already used. Ids are permanent, so pick another.'); return }
    if (!draft.name.trim() || !draft.category.trim()) { setProblem('Name and category are required.'); return }
    const years = splitList(draft.years).map(Number)
    if (years.some(year => !Number.isInteger(year) || year < 2020 || year > 2100)) { setProblem('Years must be whole years between 2020 and 2100, or leave blank.'); return }
    const subjects = [...new Set(draft.subjects.split('\n').map(item => item.trim()).filter(Boolean))]
    if (!subjects.length) { setProblem('Add at least one subject (one per line).'); return }
    if (subjects.length > 30 || subjects.some(item => item.length > 60)) { setProblem('Use up to 30 subjects, each at most 60 characters.'); return }
    const existing = exams.find(exam => exam.id === id)
    let markingScheme: MarkingScheme | null = null
    const markingBlank = ![draft.markingFullTotal, draft.markingOtherTotal, draft.markingFullSubjects, draft.markingOtherSubjects, draft.markingFullDefault, draft.markingOtherDefault, draft.markingPapers, draft.markingSource, draft.markingNotes].some(value => value.trim())
    if (!markingBlank) {
      try {
        const total = (value: string) => value.trim() ? Number(value) : null
        const fullDefault = draft.markingFullDefault.trim() ? Number(draft.markingFullDefault) : undefined
        const otherDefault = draft.markingOtherDefault.trim() ? Number(draft.markingOtherDefault) : undefined
        const papers = parsePapersText(draft.markingPapers)
        markingScheme = {
          full: { total: total(draft.markingFullTotal), perSubject: parsePerSubjectText(draft.markingFullSubjects), ...(fullDefault !== undefined ? { defaultPerSubject: fullDefault } : {}), ...(papers.length ? { papers } : {}) },
          other: { total: total(draft.markingOtherTotal), perSubject: parsePerSubjectText(draft.markingOtherSubjects), ...(otherDefault !== undefined ? { defaultPerSubject: otherDefault } : {}) },
          combine: draft.markingCombine, source: draft.markingSource.trim(), ...(draft.markingNotes.trim() ? { notes: draft.markingNotes.trim() } : {})
        }
        const issues = validateMarkingScheme(markingScheme)
        if (issues.length) { setProblem(issues[0] ?? 'Check the marking defaults.'); return }
      } catch (error) { setProblem(error instanceof Error ? error.message : 'Check the marking defaults.'); return }
    }
    save.mutate({ id, name: draft.name.trim(), category: draft.category.trim(), years, sessions: splitList(draft.sessions), boards: splitList(draft.boards), boards_addon: draft.boards_addon, subjects, session_label: draft.session_label.trim(), hidden: draft.hidden, marking_scheme: markingScheme, ...(existing ? { sort_order: existing.sort_order } : {}) })
  }

  const move = (id: string, step: -1 | 1) => {
    const order = exams.map(exam => exam.id)
    const index = order.indexOf(id)
    const target = index + step
    if (index < 0 || target < 0 || target >= order.length) return
    const a = order[index]
    const b = order[target]
    if (a === undefined || b === undefined) return
    order[index] = b
    order[target] = a
    reorder.mutate({ order, movedId: id })
  }

  const toggleHidden = (exam: ExamDefinition) => toggle.mutate(exam)

  return <>
    <PageHeader title="Exams" description="The exams students can choose in Settings. Removing an exam hides it from the list; students already preparing for it are not affected." actions={<Button variant="primary" size="sm" onClick={() => { setDraft(toDraft()); setProblem(null) }}><Plus size={14} aria-hidden="true" /> Add exam</Button>} />
    {problem && <p className="cc-field__error" role="alert">{problem}</p>}
    {notice && <p className="cc-muted" role="status">{notice}</p>}
    {draft && <div ref={editorRef}><Panel title={draft.isNew ? 'Add an exam' : `Edit ${draft.name}`} description="Years: leave blank to offer this year and the next three. Lists can be separated by commas.">
      <div className="cc-stack cc-exam-form">
        <label>Id (permanent){' '}<input value={draft.id} disabled={!draft.isNew} onChange={event => setDraft({ ...draft, id: event.target.value.toLowerCase() })} placeholder="e.g. neet-pg" /></label>
        <label>Name <input value={draft.name} maxLength={80} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Category <input value={draft.category} maxLength={40} list="cc-exam-categories" onChange={event => setDraft({ ...draft, category: event.target.value })} /></label>
        <datalist id="cc-exam-categories">{groupByCategory(exams).map(([category]) => <option key={category} value={category} />)}</datalist>
        <label>Target years <input value={draft.years} onChange={event => setDraft({ ...draft, years: event.target.value })} placeholder="blank = automatic" /></label>
        <label>Attempts / sessions <input value={draft.sessions} onChange={event => setDraft({ ...draft, sessions: event.target.value })} placeholder="e.g. January, May, September" /></label>
        <label>Label for attempts / sessions <input value={draft.session_label} maxLength={30} onChange={event => setDraft({ ...draft, session_label: event.target.value })} placeholder='blank = "Attempt / session" (e.g. Stream)' /></label>
        <label>Subjects (one per line; add, rename or remove) <textarea rows={6} value={draft.subjects} onChange={event => setDraft({ ...draft, subjects: event.target.value })} placeholder={'Physics\nChemistry\nBiology'} /></label>
        <span className="cc-muted">Renaming or removing a subject does not change what students already logged; their older entries stay visible in their analytics.</span>
        <label>Boards to choose from (school classes) <input value={draft.boards} onChange={event => setDraft({ ...draft, boards: event.target.value })} placeholder="e.g. CBSE, ICSE / ISC, State board" /></label>
        <label className="cc-check"><input type="checkbox" checked={draft.boards_addon} onChange={event => setDraft({ ...draft, boards_addon: event.target.checked })} /> Allow students to add Class 12 boards alongside this exam</label>
        <strong>Marking defaults for Add Test</strong>
        <span className="cc-muted">These only pre-fill a new test form; saved tests are never changed. Leave every marking field blank to use the built-in fallback for this exam id.</span>
        <label>Full Mock total (blank = depends on subjects/papers) <input inputMode="decimal" value={draft.markingFullTotal} onChange={event => setDraft({ ...draft, markingFullTotal: event.target.value })} placeholder="e.g. 300" /></label>
        <label>Full Mock marks per subject (one per line, Subject = marks) <textarea rows={5} value={draft.markingFullSubjects} onChange={event => setDraft({ ...draft, markingFullSubjects: event.target.value })} placeholder={'Physics = 100\nChemistry = 100'} /></label>
        <label>Full Mock default marks for any other subject <input inputMode="decimal" value={draft.markingFullDefault} onChange={event => setDraft({ ...draft, markingFullDefault: event.target.value })} placeholder="optional" /></label>
        <label>Papers (optional; one per line: Paper 1 | 180 | Physics = 60; Chemistry = 60) <textarea rows={3} value={draft.markingPapers} onChange={event => setDraft({ ...draft, markingPapers: event.target.value })} placeholder="Paper 1 | 180 | Physics = 60; Chemistry = 60; Maths = 60" /></label>
        <label>Other test types total (blank = depends on subject) <input inputMode="decimal" value={draft.markingOtherTotal} onChange={event => setDraft({ ...draft, markingOtherTotal: event.target.value })} placeholder="e.g. 180" /></label>
        <label>Other test types marks per subject (one per line) <textarea rows={5} value={draft.markingOtherSubjects} onChange={event => setDraft({ ...draft, markingOtherSubjects: event.target.value })} placeholder={'Physics = 60\nChemistry = 60'} /></label>
        <label>Other test types default marks for any other subject <input inputMode="decimal" value={draft.markingOtherDefault} onChange={event => setDraft({ ...draft, markingOtherDefault: event.target.value })} placeholder="optional" /></label>
        <label>Combine rule <select value={draft.markingCombine} onChange={event => setDraft({ ...draft, markingCombine: event.target.value as MarkingScheme['combine'] })}><option value="sum_subjects">Sum entered subjects</option><option value="sum_papers">Sum papers (e.g. JEE Advanced Paper 1 + Paper 2 = 360)</option><option value="per_subject">Per subject/paper — no single combined official total</option></select></label>
        <label>Official source <input value={draft.markingSource} maxLength={200} onChange={event => setDraft({ ...draft, markingSource: event.target.value })} placeholder="e.g. NTA, NEET (UG) 2026" /></label>
        <label>Notes for students (optional) <textarea rows={2} maxLength={500} value={draft.markingNotes} onChange={event => setDraft({ ...draft, markingNotes: event.target.value })} /></label>
        <div className="cc-row">
          <Button variant="primary" size="sm" disabled={save.isPending} onClick={submit}>{save.isPending ? 'Saving…' : 'Save exam'}</Button>
          <Button variant="ghost" size="sm" onClick={() => { setDraft(null); setProblem(null) }}>Cancel</Button>
        </div>
      </div>
    </Panel></div>}
    {query.data && <AiModelPreferencesPanel initial={query.data.aiModelPreferences} saving={savePreferences.isPending} onSave={async prefs => { await savePreferences.mutateAsync(prefs) }} />}
    <Panel title="Exam list" description="Order here is the order students see. Hidden exams stay in the list for you and can be brought back.">
      {query.isLoading ? <p className="cc-muted">Loading the exam list…</p>
        : query.isError ? <p className="cc-muted">{query.error instanceof Error ? query.error.message : 'The exam list could not be loaded.'} <Button size="sm" onClick={() => void query.refetch()}>Try again</Button></p>
          : <ol className="cc-exam-list">
            {exams.map((exam, index) => <li key={exam.id} className={exam.hidden ? 'is-hidden' : undefined}>
              <div className="cc-exam-main">
                <strong>{exam.name}</strong> <span className="cc-muted">{exam.category} · {examYears(exam).join(', ')}{exam.sessions.length ? ` · ${exam.sessions.join(', ')}` : ''}{exam.boards_addon ? ' · boards add-on' : ''}{exam.subjects.length ? ` · ${exam.subjects.length} subjects` : ''}{exam.marking_scheme ? ` · Full ${exam.marking_scheme.full.total ?? 'per subject'} (${exam.marking_scheme.source})` : ' · built-in marking fallback'}{exam.hidden ? ' · hidden' : ''}</span>
              </div>
              <div className="cc-row">
                <Button size="sm" variant="ghost" aria-label={`Move ${exam.name} up`} disabled={index === 0 || (reorder.isPending && reorder.variables?.movedId === exam.id)} onClick={() => move(exam.id, -1)}><ArrowUp size={13} aria-hidden="true" /></Button>
                <Button size="sm" variant="ghost" aria-label={`Move ${exam.name} down`} disabled={index === exams.length - 1 || (reorder.isPending && reorder.variables?.movedId === exam.id)} onClick={() => move(exam.id, 1)}><ArrowDown size={13} aria-hidden="true" /></Button>
                <Button size="sm" variant="ghost" onClick={() => { setDraft(toDraft(exam)); setProblem(null) }}><Pencil size={13} aria-hidden="true" /> Edit</Button>
                <Button size="sm" variant={exam.hidden ? 'default' : 'danger'} disabled={toggle.isPending && toggle.variables?.id === exam.id} onClick={() => toggleHidden(exam)}>{toggle.isPending && toggle.variables?.id === exam.id ? 'Saving…' : exam.hidden ? <><Eye size={13} aria-hidden="true" /> Bring back</> : <><EyeOff size={13} aria-hidden="true" /> Remove</>}</Button>
              </div>
            </li>)}
          </ol>}
    </Panel>
  </>
}
