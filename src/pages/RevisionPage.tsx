import { useMemo, useState } from 'react'
import { AlarmClock, ArrowRight, CalendarClock, Check, CheckCheck, Clock3, Sparkles } from 'lucide-react'
import { Button, EmptyState, NotebookCard, PageHeader, StatusBadge, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { indiaToday, plusDays, prettyDate } from '../lib/date'
import type { Revision } from '../types'

export default function RevisionPage() {
  const { data, upsert } = useData()
  const { notify } = useToast()
  const [showCompleted, setShowCompleted] = useState(false)
  const today = indiaToday()
  const tomorrow = plusDays(today, 1)
  const overdue = useMemo(() => data.revisions.filter(item => !item.completed_at && item.due_on < today).sort((a, b) => a.due_on.localeCompare(b.due_on)), [data.revisions, today])
  const dueToday = useMemo(() => data.revisions.filter(item => !item.completed_at && item.due_on === today), [data.revisions, today])
  const dueTomorrow = useMemo(() => data.revisions.filter(item => !item.completed_at && item.due_on === tomorrow), [data.revisions, tomorrow])
  const upcoming = useMemo(() => data.revisions.filter(item => !item.completed_at && item.due_on > tomorrow).sort((a, b) => a.due_on.localeCompare(b.due_on)), [data.revisions, tomorrow])
  const completed = useMemo(() => data.revisions.filter(item => item.completed_at).sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')).slice(0, 30), [data.revisions])

  const complete = async (revision: Revision) => {
    const now = new Date().toISOString()
    try {
      await upsert('chapter_revisions', { ...revision, completed_at: now, updated_at: now })
      const chapter = data.chapters.find(item => item.id === revision.chapter_id)
      if (chapter && chapter.status === 'Done') await upsert('chapters', { ...chapter, status: 'Revised', updated_at: now })
      const nextNo = revision.revision_number + 1
      if (nextNo <= data.settings.revision_gaps.length && !data.revisions.some(item => item.chapter_id === revision.chapter_id && item.revision_number === nextNo)) {
        const next: Revision = { id: crypto.randomUUID(), chapter_id: revision.chapter_id, revision_number: nextNo, due_on: plusDays(today, Math.max(1, data.settings.revision_gaps[nextNo - 1] ?? 7)), completed_at: null, created_at: now, updated_at: now }
        await upsert('chapter_revisions', next)
      }
      notify('Revision done. Your memory just got a little stronger.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not mark revision complete.', 'error') }
  }

  const snooze = async (revision: Revision) => {
    try { await upsert('chapter_revisions', { ...revision, due_on: plusDays(today, 1), updated_at: new Date().toISOString() }); notify('Moved to tomorrow. It is still in your queue.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not reschedule revision.', 'error') }
  }

  return <div className="content-page revision-page">
    <PageHeader eyebrow="SPACED PRACTICE, BETTER RECALL" title="Revision desk" subtitle="Small returns, spaced out. Every repeat makes a pathway easier to find." doodle={<span className="revision-title-doodle">↻</span>} action={<div className="revision-total-pill"><AlarmClock size={16} /><strong>{overdue.length + dueToday.length}</strong><span>need attention</span></div>} />
    {overdue.length > 0 && <RevisionSection title="Overdue" note="Oldest first — one at a time is enough." tone="overdue" icon={<Clock3 size={17} />} revisions={overdue} data={data} onComplete={complete} onSnooze={snooze} />}
    <div className="revision-two-column"><RevisionSection title="Due today" note={dueToday.length ? `${dueToday.length} ready for a quick recall pass.` : 'Nothing due today. Keep progressing.'} tone="today" icon={<CalendarClock size={17} />} revisions={dueToday} data={data} onComplete={complete} onSnooze={snooze} /><RevisionSection title="Tomorrow" note="A little peek at what’s coming." tone="tomorrow" icon={<Sparkles size={17} />} revisions={dueTomorrow} data={data} onComplete={complete} onSnooze={snooze} /></div>
    <RevisionSection title="Coming up" note="Scheduled next, so today can stay focused." tone="upcoming" icon={<ArrowRight size={17} />} revisions={upcoming} data={data} onComplete={complete} onSnooze={snooze} limit={10} />
    <NotebookCard className="revision-completed-toggle"><div><span className="completed-stamp"><CheckCheck size={16} /></span><span><strong>Recently completed</strong><small>{completed.length} revision{completed.length === 1 ? '' : 's'} in your record</small></span></div><button onClick={() => setShowCompleted(value => !value)} aria-expanded={showCompleted}>{showCompleted ? 'Hide' : 'Show'} <span aria-hidden="true">{showCompleted ? '↑' : '↓'}</span></button></NotebookCard>
    {showCompleted && <NotebookCard className="completed-revisions-board">{completed.length ? completed.map(revision => <RevisionRow key={revision.id} revision={revision} data={data} completed />) : <EmptyState icon={<CheckCheck size={23} />} title="No finished revisions yet." description="The ones you complete will show up here." />}</NotebookCard>}
  </div>
}

function RevisionSection({ title, note, tone, icon, revisions, data, onComplete, onSnooze, limit }: {
  title: string; note: string; tone: string; icon: React.ReactNode; revisions: Revision[]; data: ReturnType<typeof useData>['data'];
  onComplete: (revision: Revision) => void; onSnooze: (revision: Revision) => void; limit?: number
}) {
  const visible = limit ? revisions.slice(0, limit) : revisions
  return <section className={`revision-section revision-section-${tone}`}><div className="revision-section-head"><div className="revision-section-icon">{icon}</div><div><h2>{title}<span>{revisions.length}</span></h2><p>{note}</p></div></div>
    <NotebookCard className="revision-section-card">
      {!visible.length ? <div className="revision-section-empty"><span aria-hidden="true">✳</span><p>{title === 'Due today' ? 'Nothing is due today. Keep progressing.' : title === 'Tomorrow' ? 'No revision due tomorrow.' : title === 'Overdue' ? 'You’re all caught up.' : 'No upcoming revisions scheduled.'}</p></div> : <div className="revision-list">{visible.map(revision => <div key={revision.id} className="revision-list-row"><RevisionRow revision={revision} data={data} overdue={tone === 'overdue'} /><div className="revision-row-buttons"><button className="revision-snooze" onClick={() => onSnooze(revision)} aria-label="Move revision to tomorrow" title="Move to tomorrow">+1d</button><Button size="sm" onClick={() => onComplete(revision)}><Check size={14} /> Revised</Button></div></div>)}</div>}
      {limit && revisions.length > limit && <p className="revision-more-note">And {revisions.length - limit} more scheduled.</p>}
    </NotebookCard>
  </section>
}

function RevisionRow({ revision, data, overdue = false, completed = false }: { revision: Revision; data: ReturnType<typeof useData>['data']; overdue?: boolean; completed?: boolean }) {
  const chapter = data.chapters.find(item => item.id === revision.chapter_id)
  if (!chapter) return null
  return <div className={`revision-row-main ${overdue ? 'is-overdue' : ''} ${completed ? 'is-completed' : ''}`}>
    <div className="revision-number-mark">{completed ? <Check size={16} /> : `R${revision.revision_number}`}</div><div className="revision-chapter-copy"><strong>{chapter.name}</strong><div><SubjectBadge subject={chapter.subject} /><span>{completed ? `Completed ${prettyDate(revision.completed_at?.slice(0, 10))}` : `Due ${prettyDate(revision.due_on)}`}</span>{overdue && <StatusBadge tone="weak">Overdue</StatusBadge>}</div></div>
  </div>
}
