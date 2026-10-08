import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlarmClock, Check, ChevronDown, ChevronUp, Edit3, Plus, Trash2, Undo2 } from 'lucide-react'
import { Button, Dialog, EmptyState, Field, NotebookCard, OverflowMenu, PageHeader, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui'
import { ChapterSelect, ChipFilter, SubjectSelect } from '../components/jee/shared'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { createId } from '../lib/id'
import { indiaToday, plusDays, prettyDate } from '../lib/date'
import { isAwake } from '../lib/jee/reminders'
import { validateBacklog, type BacklogFormInput, type BacklogValue } from '../lib/jee/forms'
import { BACKLOG_TYPES, type BacklogItem, type BacklogType, type Priority, type Subject, type AppData } from '../types'

type GroupBy = 'due' | 'subject' | 'type' | 'priority'
type TypeFilter = 'all' | BacklogType

const PRIORITY_RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 }

export default function BacklogPage() {
  const { data, upsert, remove } = useData()
  const { notify } = useToast()
  const [params, setParams] = useSearchParams()
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [subject, setSubject] = useState<Subject | 'all'>('all')
  const [priority, setPriority] = useState<'all' | Priority>('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('due')
  const [showDone, setShowDone] = useState(false)
  const [editing, setEditing] = useState<BacklogItem | null>(null)
  const [creating, setCreating] = useState(params.get('add') === '1')
  const today = indiaToday()
  const chapterById = useMemo(() => new Map(data.chapters.map(chapter => [chapter.id, chapter])), [data.chapters])

  const matches = (item: BacklogItem) => {
    if (typeFilter !== 'all' && item.type !== typeFilter) return false
    if (priority !== 'all' && item.priority !== priority) return false
    if (subject !== 'all') {
      const itemSubject = item.subject ?? (item.chapter_id ? chapterById.get(item.chapter_id)?.subject : null)
      if (itemSubject !== subject) return false
    }
    return true
  }
  const open = data.backlogItems.filter(item => item.status !== 'done' && matches(item))
  const active = open.filter(item => isAwake(item, today))
  const snoozed = open.filter(item => item.status === 'snoozed' && !isAwake(item, today))
  const completed = data.backlogItems.filter(item => item.status === 'done' && matches(item)).sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
  const dueNow = active.filter(item => item.due_on !== null && item.due_on <= today)
  const overdueCount = dueNow.filter(item => item.due_on !== null && item.due_on < today).length

  const save = async (item: BacklogItem, patch: Partial<BacklogItem>) => {
    try { await upsert('backlog_items', { ...item, ...patch, updated_at: new Date().toISOString() }) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not update the backlog item.', 'error') }
  }
  const complete = (item: BacklogItem) => save(item, { status: 'done', completed_at: new Date().toISOString(), snoozed_until: null }).then(() => notify('Backlog item cleared. Nice.'))
  const reopen = (item: BacklogItem) => save(item, { status: 'active', completed_at: null })
  const snooze = (item: BacklogItem, days: number) => save(item, { status: 'snoozed', snoozed_until: plusDays(today, days) }).then(() => notify(`Snoozed until ${prettyDate(plusDays(today, days))}.`))
  const removeItem = async (item: BacklogItem) => {
    try { await remove('backlog_items', item); notify('Removed. Undo is available briefly.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not remove the item.', 'error') }
  }

  const groups = useMemo(() => groupItems(active, groupBy, chapterById, today), [active, groupBy, chapterById, today])

  const renderRow = (item: BacklogItem) => {
    const chapter = item.chapter_id ? chapterById.get(item.chapter_id) : undefined
    const itemSubject = item.subject ?? chapter?.subject ?? null
    const overdue = item.due_on !== null && item.due_on < today
    return <li key={item.id} className={`jee-backlog-row ${overdue ? 'is-overdue' : ''}`}>
      <button type="button" className="jee-check" onClick={() => void complete(item)} aria-label={`Mark ${item.title} done`}><Check size={14} aria-hidden="true" /></button>
      <div className="jee-backlog-main">
        <strong>{item.title}</strong>
        <div className="jee-row-meta">
          <StatusBadge tone="muted">{item.type}</StatusBadge>
          {itemSubject && <SubjectBadge subject={itemSubject} />}
          {chapter && <span className="jee-muted">{chapter.name}</span>}
          <span className={`jee-priority jee-priority-${item.priority.toLowerCase()}`}>{item.priority}</span>
          {item.due_on && <span className={overdue ? 'jee-overdue' : 'jee-muted'}>{overdue ? 'Overdue · ' : 'Due '}{prettyDate(item.due_on)}</span>}
          {item.status === 'snoozed' && item.snoozed_until && <span className="jee-muted">Back {prettyDate(item.snoozed_until)}</span>}
        </div>
        {item.notes && <p className="jee-note">{item.notes}</p>}
      </div>
      <OverflowMenu label={`Actions for ${item.title}`} items={[
        { id: 'done', label: 'Mark done', icon: <Check size={15} />, onSelect: () => void complete(item) },
        { id: 'snooze1', label: 'Come back tomorrow', icon: <AlarmClock size={15} />, onSelect: () => void snooze(item, 1) },
        { id: 'snooze3', label: 'Come back in 3 days', icon: <AlarmClock size={15} />, onSelect: () => void snooze(item, 3) },
        { id: 'snooze7', label: 'Come back in a week', icon: <AlarmClock size={15} />, onSelect: () => void snooze(item, 7) },
        { id: 'edit', label: 'Edit', icon: <Edit3 size={15} />, onSelect: () => setEditing(item) },
        { id: 'delete', label: 'Delete', icon: <Trash2 size={15} />, danger: true, onSelect: () => void removeItem(item) }
      ]} />
    </li>
  }

  const counts = { due: dueNow.length, snoozed: snoozed.length }

  return <div className="content-page backlog-page">
    <PageHeader
      eyebrow="UNFINISHED WORK, IN ONE PLACE"
      title="Backlog"
      subtitle="Skipped lectures, unsolved DPPs, and topics to come back to. Anything due here is considered by “What should I study now?”."
      action={<Button onClick={() => { setCreating(true); if (params.get('add')) setParams({}, { replace: true }) }}><Plus size={16} /> Add item</Button>}
    />
    <section className="jee-stat-grid" aria-label="Backlog summary">
      <NotebookCard className="jee-stat"><span>Due now</span><strong>{counts.due}</strong><small>{overdueCount ? `${overdueCount} overdue` : 'nothing overdue'}</small></NotebookCard>
      <NotebookCard className="jee-stat"><span>Open</span><strong>{active.length}</strong><small>active items</small></NotebookCard>
      <NotebookCard className="jee-stat"><span>Snoozed</span><strong>{counts.snoozed}</strong><small>waiting to come back</small></NotebookCard>
      <NotebookCard className="jee-stat"><span>Cleared</span><strong>{data.backlogItems.filter(item => item.status === 'done').length}</strong><small>completed</small></NotebookCard>
    </section>

    <NotebookCard className="jee-filter-card">
      <ChipFilter<TypeFilter> label="Type" value={typeFilter} onChange={setTypeFilter} options={[{ value: 'all', label: 'All' }, ...BACKLOG_TYPES.map(type => ({ value: type, label: type === 'DPP' ? 'Unsolved DPPs' : type === 'Lecture' ? 'Skipped lectures' : 'Come back to' }))]} />
      <div className="jee-filter-grid">
        <SubjectSelect value={subject} onChange={value => setSubject(value as Subject | 'all')} />
        <label className="jee-select"><span>Priority</span><select value={priority} onChange={event => setPriority(event.target.value as 'all' | Priority)}><option value="all">Any priority</option><option>High</option><option>Medium</option><option>Low</option></select></label>
        <label className="jee-select"><span>Group by</span><select value={groupBy} onChange={event => setGroupBy(event.target.value as GroupBy)}><option value="due">Due date</option><option value="subject">Subject</option><option value="type">Type</option><option value="priority">Priority</option></select></label>
      </div>
    </NotebookCard>

    {data.backlogItems.length === 0 ? <NotebookCard><EmptyState icon={<Check size={24} />} title="The backlog is empty." description="Add a skipped lecture, an unsolved DPP, or a topic you want to revisit. Nothing is ever lost here." action={<Button variant="secondary" size="sm" onClick={() => setCreating(true)}><Plus size={15} /> Add the first item</Button>} /></NotebookCard>
    : <>
      {groups.length === 0 ? <NotebookCard><EmptyState icon={<Check size={22} />} title="Nothing open in this view." description="Clear the filters, or check snoozed items below." /></NotebookCard>
        : groups.map(group => <section key={group.key} className="jee-backlog-group">
          <SectionHeading title={group.title} note={`${group.items.length} item${group.items.length === 1 ? '' : 's'}`} />
          <NotebookCard><ul className="jee-backlog-list">{group.items.map(renderRow)}</ul></NotebookCard>
        </section>)}

      {snoozed.length > 0 && <section className="jee-backlog-group">
        <SectionHeading title="Snoozed" note="These return automatically on their date." />
        <NotebookCard><ul className="jee-backlog-list">{snoozed.map(renderRow)}</ul></NotebookCard>
      </section>}

      <NotebookCard className="jee-completed-toggle">
        <div><strong>Completed</strong><small>{completed.length} cleared item{completed.length === 1 ? '' : 's'}</small></div>
        <button type="button" aria-expanded={showDone} onClick={() => setShowDone(value => !value)}>{showDone ? <><ChevronUp size={15} /> Hide</> : <><ChevronDown size={15} /> Show</>}</button>
      </NotebookCard>
      {showDone && <NotebookCard><ul className="jee-backlog-list done">{completed.slice(0, 60).map(item => <li key={item.id} className="jee-backlog-row is-done">
        <button type="button" className="jee-check checked" onClick={() => void reopen(item)} aria-label={`Reopen ${item.title}`}><Undo2 size={13} aria-hidden="true" /></button>
        <div className="jee-backlog-main"><strong>{item.title}</strong><div className="jee-row-meta"><StatusBadge tone="muted">{item.type}</StatusBadge>{item.completed_at && <span className="jee-muted">Cleared {prettyDate(item.completed_at.slice(0, 10))}</span>}</div></div>
      </li>)}</ul></NotebookCard>}
    </>}

    {creating && <BacklogDialog data={data} onClose={() => setCreating(false)} onSave={async value => {
      const now = new Date().toISOString()
      await upsert('backlog_items', { id: createId(), ...value, status: 'active', snoozed_until: null, completed_at: null, created_at: now, updated_at: now })
      notify('Added to your backlog.')
    }} />}
    {editing && <BacklogDialog data={data} existing={editing} onClose={() => setEditing(null)} onSave={async value => {
      await upsert('backlog_items', { ...editing, ...value, updated_at: new Date().toISOString() })
      notify('Backlog item updated.')
    }} />}
  </div>
}

/** Group open items. `sort` keys keep groups in a meaningful order (overdue first, dates ascending). */
function groupItems(items: BacklogItem[], groupBy: GroupBy, chapterById: Map<string, { subject: Subject }>, today: string) {
  const buckets = new Map<string, { key: string; title: string; sort: string; items: BacklogItem[] }>()
  const put = (key: string, title: string, sort: string, item: BacklogItem) => {
    const bucket = buckets.get(key) ?? { key, title, sort, items: [] }
    bucket.items.push(item)
    buckets.set(key, bucket)
  }
  for (const item of items) {
    if (groupBy === 'due') {
      if (item.due_on === null) put('none', 'No due date', '9', item)
      else if (item.due_on < today) put('overdue', 'Overdue', '0', item)
      else if (item.due_on === today) put('today', 'Due today', '1', item)
      else put(`d-${item.due_on}`, `Due ${prettyDate(item.due_on)}`, `2${item.due_on}`, item)
    } else if (groupBy === 'subject') {
      const subject = String(item.subject ?? (item.chapter_id ? chapterById.get(item.chapter_id)?.subject : undefined) ?? 'General')
      put(subject, subject, String(['Physics', 'Chemistry', 'Maths', 'General'].indexOf(subject)), item)
    } else if (groupBy === 'type') {
      put(item.type, item.type === 'DPP' ? 'Unsolved DPPs' : item.type === 'Lecture' ? 'Skipped lectures' : 'Come back to', String(BACKLOG_TYPES.indexOf(item.type)), item)
    } else {
      put(item.priority, `${item.priority} priority`, String(PRIORITY_RANK[item.priority]), item)
    }
  }
  return [...buckets.values()].sort((a, b) => a.sort.localeCompare(b.sort)).map(bucket => ({
    ...bucket,
    items: [...bucket.items].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999') || a.title.localeCompare(b.title))
  }))
}

function BacklogDialog({ data, existing, onClose, onSave }: {
  data: AppData; existing?: BacklogItem; onClose: () => void; onSave: (value: BacklogValue) => Promise<void>
}) {
  const chapter = existing?.chapter_id ? data.chapters.find(item => item.id === existing.chapter_id) : undefined
  const [form, setForm] = useState<BacklogFormInput>({
    title: existing?.title ?? '', type: existing?.type ?? 'Lecture', subject: existing?.subject ?? chapter?.subject ?? '',
    chapterId: existing?.chapter_id ?? '', priority: existing?.priority ?? 'Medium', dueOn: existing?.due_on ?? '', notes: existing?.notes ?? ''
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const { notify } = useToast()
  const set = <K extends keyof BacklogFormInput>(key: K, value: BacklogFormInput[K]) => {
    setForm(current => ({ ...current, [key]: value }))
    setErrors(current => { const next = { ...current }; delete next[key]; return next })
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    const result = validateBacklog(form)
    if (!result.ok) { setErrors(result.errors); notify('Check the highlighted fields.', 'error'); return }
    setSaving(true)
    try { await onSave(result.value); onClose() }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save the item.', 'error') }
    finally { setSaving(false) }
  }
  return <Dialog title={existing ? 'Edit backlog item' : 'Add to backlog'} subtitle="A skipped lecture, an unsolved DPP, or something to come back to." onClose={onClose} className="jee-dialog">
    <form className="form-stack" noValidate onSubmit={submit}>
      <Field label="What is it?" required error={errors.title}><input autoFocus maxLength={200} value={form.title} onChange={event => set('title', event.target.value)} placeholder="e.g. Lecture 8 — EMI" /></Field>
      <div className="form-grid two">
        <Field label="Type" error={errors.type}><select value={form.type} onChange={event => set('type', event.target.value as BacklogType)}>{BACKLOG_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</select></Field>
        <Field label="Priority"><select value={form.priority} onChange={event => set('priority', event.target.value as Priority)}><option>High</option><option>Medium</option><option>Low</option></select></Field>
      </div>
      <div className="form-grid two">
        <Field label="Subject"><select value={form.subject} onChange={event => { set('subject', event.target.value as Subject | ''); set('chapterId', '') }}><option value="">General</option><option>Physics</option><option>Chemistry</option><option>Maths</option></select></Field>
        <Field label="Due date (optional)" error={errors.dueOn}><input type="date" value={form.dueOn} onChange={event => set('dueOn', event.target.value)} /></Field>
      </div>
      <ChapterSelect chapters={data.chapters} value={form.chapterId} onChange={value => set('chapterId', value)} subject={form.subject || 'all'} label="Linked chapter (optional)" allowNone noneLabel="No chapter" />
      <Field label="Notes (optional)" error={errors.notes}><textarea rows={2} maxLength={5000} value={form.notes} onChange={event => set('notes', event.target.value)} /></Field>
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>{existing ? 'Save changes' : 'Add to backlog'} <Check size={16} /></Button></div>
    </form>
  </Dialog>
}
