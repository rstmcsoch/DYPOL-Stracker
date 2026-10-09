import { differenceInCalendarDays, parseISO } from 'date-fns'
import { indiaDate } from '../date.js'
import { pyqCompletion } from './progress.js'
import type { AppData, BacklogItem, ReminderKind } from '../../types/index.js'

/** An active item, or a snoozed one whose wake-up date has arrived. Done items never wake. */
export function isAwake(item: BacklogItem, today: string): boolean {
  if (item.status === 'active') return true
  return item.status === 'snoozed' && item.snoozed_until !== null && item.snoozed_until <= today
}

export interface ReminderItem { kind: ReminderKind; title: string; body: string }

export const REMINDER_LABEL: Record<ReminderKind, string> = {
  revision: 'Due revision', backlog: 'Backlog', practice: 'Practice', pyq: 'PYQs', mock: 'Mock', plan: 'Study plan'
}

/**
 * Reminder candidates that apply right now. Only enabled reminder types are returned,
 * and each one is backed by a real count — no generic nagging when there is nothing to do.
 */
export function computeReminders(data: AppData, today: string): ReminderItem[] {
  if (!data.settings.reminders_enabled) return []
  const enabled = new Set(data.settings.reminder_types)
  const items: ReminderItem[] = []

  if (enabled.has('revision')) {
    const due = data.revisions.filter(item => !item.completed_at && item.due_on <= today).length
    if (due) items.push({ kind: 'revision', title: 'Revision is due', body: `${due} revision${due === 1 ? '' : 's'} due or overdue in Stracker.` })
  }
  if (enabled.has('backlog')) {
    const due = data.backlogItems.filter(item => isAwake(item, today) && item.due_on !== null && item.due_on <= today).length
    if (due) items.push({ kind: 'backlog', title: 'Backlog is due', body: `${due} backlog item${due === 1 ? '' : 's'} due today or earlier.` })
  }
  if (enabled.has('practice') && !data.practiceSessions.some(item => item.practice_date === today)) {
    items.push({ kind: 'practice', title: 'No practice logged today', body: 'A short DPP block keeps your accuracy honest.' })
  }
  if (enabled.has('pyq')) {
    const started = data.chapters.filter(chapter => chapter.status !== 'Not Started')
    const pending = started.reduce((sum, chapter) => sum + pyqCompletion(data.pyqRecords, chapter.id, 'Main', data.settings).pendingYears.length, 0)
    if (pending > 0) items.push({ kind: 'pyq', title: 'PYQs are waiting', body: `${pending} PYQ year${pending === 1 ? '' : 's'} pending on chapters you have started.` })
  }
  if (enabled.has('mock')) {
    const latest = [...data.tests].sort((a, b) => b.test_date.localeCompare(a.test_date))[0]
    const days = latest ? differenceInCalendarDays(parseISO(`${today}T12:00:00`), parseISO(`${latest.test_date}T12:00:00`)) : null
    if (days === null || days >= 14) items.push({ kind: 'mock', title: 'Time for a mock check', body: days === null ? 'No test is logged yet.' : `Your last test was ${days} days ago.` })
  }
  if (enabled.has('plan') && !data.tasks.some(task => task.task_date === today)) {
    items.push({ kind: 'plan', title: 'Plan today', body: 'Add one task so today has a clear start.' })
  }
  return items
}

const FIRED_KEY = 'stracker:reminders-fired'

/** True once per day, after the configured time, and only if this device has not fired it yet. */
export function shouldFireToday(reminderTime: string, now: Date, storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): boolean {
  const day = indiaDate(now)
  const [hours, minutes] = reminderTime.split(':').map(Number)
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  const hh = Number(parts.find(part => part.type === 'hour')?.value ?? 0)
  const mm = Number(parts.find(part => part.type === 'minute')?.value ?? 0)
  if (hh * 60 + mm < (hours ?? 0) * 60 + (minutes ?? 0)) return false
  if (!storage) return false
  const fired = storage.getItem(FIRED_KEY)
  if (fired === day) return false
  storage.setItem(FIRED_KEY, day)
  return true
}
