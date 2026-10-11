import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, EyeOff, Eye, Pencil, Plus } from 'lucide-react'
import { PageHeader } from '../pageParts'
import { Button, Panel } from '../ui'
import { controlFetch } from '../api'
import { EXAM_ID_PATTERN, examYears, groupByCategory, type ExamDefinition } from '../../lib/exams/catalog'

type ListResponse = { ok: true; exams: ExamDefinition[] }
type Draft = { id: string; name: string; category: string; years: string; sessions: string; boards: string; boards_addon: boolean; hidden: boolean; isNew: boolean }

const splitList = (value: string) => value.split(/[\n,]/).map(item => item.trim()).filter(Boolean)
const toDraft = (exam?: ExamDefinition): Draft => exam
  ? { id: exam.id, name: exam.name, category: exam.category, years: exam.years.join(', '), sessions: exam.sessions.join(', '), boards: exam.boards.join(', '), boards_addon: exam.boards_addon, hidden: exam.hidden, isNew: false }
  : { id: '', name: '', category: '', years: '', sessions: '', boards: '', boards_addon: false, hidden: false, isNew: true }

/** Owner-only exam catalogue. Removing an exam hides it; students already on it keep it. */
export default function ExamsPage() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['control', 'exams'], queryFn: () => controlFetch<ListResponse>('exams') })
  const exams = useMemo(() => query.data?.exams ?? [], [query.data])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = () => client.invalidateQueries({ queryKey: ['control', 'exams'] })
  const fail = (error: unknown) => setProblem(error instanceof Error ? error.message : 'That did not work. Nothing changed.')
  const save = useMutation({
    mutationFn: (exam: Omit<ExamDefinition, 'sort_order'> & { sort_order?: number }) => controlFetch('exams', { method: 'PUT', body: { exam } }),
    onSuccess: () => { setDraft(null); setProblem(null); setNotice('Saved. Students see the change the next time the exam list loads.'); void refresh() },
    onError: fail
  })
  const reorder = useMutation({
    mutationFn: (order: string[]) => controlFetch('exams', { method: 'POST', body: { order } }),
    onSuccess: () => { setProblem(null); void refresh() },
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
    const existing = exams.find(exam => exam.id === id)
    save.mutate({ id, name: draft.name.trim(), category: draft.category.trim(), years, sessions: splitList(draft.sessions), boards: splitList(draft.boards), boards_addon: draft.boards_addon, hidden: draft.hidden, ...(existing ? { sort_order: existing.sort_order } : {}) })
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
    reorder.mutate(order)
  }

  const toggleHidden = (exam: ExamDefinition) => save.mutate({ ...exam, hidden: !exam.hidden })
  const busy = save.isPending || reorder.isPending

  return <>
    <PageHeader title="Exams" description="The exams students can choose in Settings. Removing an exam hides it from the list; students already preparing for it are not affected." actions={<Button variant="primary" size="sm" onClick={() => { setDraft(toDraft()); setProblem(null) }}><Plus size={14} aria-hidden="true" /> Add exam</Button>} />
    {problem && <p className="cc-field__error" role="alert">{problem}</p>}
    {notice && <p className="cc-muted" role="status">{notice}</p>}
    {draft && <Panel title={draft.isNew ? 'Add an exam' : `Edit ${draft.name}`} description="Years: leave blank to offer this year and the next three. Lists can be separated by commas.">
      <div className="cc-stack cc-exam-form">
        <label>Id (permanent){' '}<input value={draft.id} disabled={!draft.isNew} onChange={event => setDraft({ ...draft, id: event.target.value.toLowerCase() })} placeholder="e.g. neet-pg" /></label>
        <label>Name <input value={draft.name} maxLength={80} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Category <input value={draft.category} maxLength={40} list="cc-exam-categories" onChange={event => setDraft({ ...draft, category: event.target.value })} /></label>
        <datalist id="cc-exam-categories">{groupByCategory(exams).map(([category]) => <option key={category} value={category} />)}</datalist>
        <label>Target years <input value={draft.years} onChange={event => setDraft({ ...draft, years: event.target.value })} placeholder="blank = automatic" /></label>
        <label>Attempts / sessions <input value={draft.sessions} onChange={event => setDraft({ ...draft, sessions: event.target.value })} placeholder="e.g. January, May, September" /></label>
        <label>Boards to choose from (school classes) <input value={draft.boards} onChange={event => setDraft({ ...draft, boards: event.target.value })} placeholder="e.g. CBSE, ICSE / ISC, State board" /></label>
        <label className="cc-check"><input type="checkbox" checked={draft.boards_addon} onChange={event => setDraft({ ...draft, boards_addon: event.target.checked })} /> Allow students to add Class 12 boards alongside this exam</label>
        <div className="cc-row">
          <Button variant="primary" size="sm" disabled={busy} onClick={submit}>{save.isPending ? 'Saving…' : 'Save exam'}</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setDraft(null); setProblem(null) }}>Cancel</Button>
        </div>
      </div>
    </Panel>}
    <Panel title="Exam list" description="Order here is the order students see. Hidden exams stay in the list for you and can be brought back.">
      {query.isLoading ? <p className="cc-muted">Loading the exam list…</p>
        : query.isError ? <p className="cc-muted">{query.error instanceof Error ? query.error.message : 'The exam list could not be loaded.'} <Button size="sm" onClick={() => void query.refetch()}>Try again</Button></p>
          : <ol className="cc-exam-list">
            {exams.map((exam, index) => <li key={exam.id} className={exam.hidden ? 'is-hidden' : undefined}>
              <div className="cc-exam-main">
                <strong>{exam.name}</strong> <span className="cc-muted">{exam.category} · {examYears(exam).join(', ')}{exam.sessions.length ? ` · ${exam.sessions.join(', ')}` : ''}{exam.boards_addon ? ' · boards add-on' : ''}{exam.hidden ? ' · hidden' : ''}</span>
              </div>
              <div className="cc-row">
                <Button size="sm" variant="ghost" aria-label={`Move ${exam.name} up`} disabled={busy || index === 0} onClick={() => move(exam.id, -1)}><ArrowUp size={13} aria-hidden="true" /></Button>
                <Button size="sm" variant="ghost" aria-label={`Move ${exam.name} down`} disabled={busy || index === exams.length - 1} onClick={() => move(exam.id, 1)}><ArrowDown size={13} aria-hidden="true" /></Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDraft(toDraft(exam)); setProblem(null) }}><Pencil size={13} aria-hidden="true" /> Edit</Button>
                <Button size="sm" variant={exam.hidden ? 'default' : 'danger'} disabled={busy} onClick={() => toggleHidden(exam)}>{exam.hidden ? <><Eye size={13} aria-hidden="true" /> Bring back</> : <><EyeOff size={13} aria-hidden="true" /> Remove</>}</Button>
              </div>
            </li>)}
          </ol>}
    </Panel>
  </>
}
