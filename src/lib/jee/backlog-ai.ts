import { isAwake } from './reminders.js'
import type { BacklogItem, Chapter } from '../../types/index.js'

/**
 * The /backlog list in the shape Stracker AI should use: open items first, snoozed
 * items clearly marked as snoozed, and never mixed with the chapter revision schedule.
 * Item notes are omitted so they are not sent on unless a later tool asks for one.
 */
type BacklogRow = Pick<BacklogItem, 'title' | 'type' | 'subject' | 'chapter_id' | 'priority' | 'due_on' | 'status' | 'snoozed_until' | 'completed_at'>

export function listBacklogForAI(items: readonly BacklogRow[], chapters: readonly Pick<Chapter, 'id' | 'name' | 'subject'>[], today: string) {
  const chapterById = new Map(chapters.map(chapter => [chapter.id, chapter]))
  const open = items.filter(item => item.status !== 'done')
  const active = open.filter(item => isAwake(item, today))
  const snoozed = open.filter(item => item.status === 'snoozed' && !isAwake(item, today))
  const row = (item: BacklogRow) => {
    const chapter = item.chapter_id ? chapterById.get(item.chapter_id) : undefined
    const asleep = item.status === 'snoozed' && !isAwake(item, today)
    return {
      title: item.title,
      type: item.type,
      subject: item.subject ?? chapter?.subject ?? null,
      chapter: chapter?.name ?? null,
      priority: item.priority,
      due_on: item.due_on,
      status: asleep ? 'snoozed' as const : 'open' as const,
      snoozed_until: asleep ? item.snoozed_until : null,
      overdue: !asleep && item.due_on !== null && item.due_on < today
    }
  }
  return {
    source: '/backlog',
    note: 'This is the leftover-work backlog (lectures, topics and practice). It is not the chapter revision schedule.',
    open: active.map(row),
    snoozed: snoozed.map(row),
    open_count: active.length,
    snoozed_count: snoozed.length
  }
}
