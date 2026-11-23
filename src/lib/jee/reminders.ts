import { differenceInCalendarDays, parseISO } from 'date-fns'
import { cachedDateFormat, indiaDate, plusDays } from '../date.js'
import { pyqCompletion } from './progress.js'
import type { AppData, BacklogItem, ReminderKind } from '../../types/index.js'

/** An active item, or a snoozed one whose wake-up date has arrived. Done items never wake. */
export function isAwake(item: Pick<BacklogItem, 'status' | 'snoozed_until'>, today: string): boolean {
  if (item.status === 'active') return true
  return item.status === 'snoozed' && item.snoozed_until !== null && item.snoozed_until <= today
}

/**
 * Home's backlog counts. Due now: awake today and due today or earlier. Due tomorrow: due
 * exactly tomorrow and awake by tomorrow (active, or a snooze that ends by then). Completed
 * items never count, and the two sets cannot overlap because their due dates differ.
 */
export function backlogDueCounts(items: readonly BacklogItem[], today: string): { dueNow: number; dueTomorrow: number } {
  const tomorrow = plusDays(today, 1)
  let dueNow = 0
  let dueTomorrow = 0
  for (const item of items) {
    if (item.status === 'done' || item.due_on === null) continue
    if (item.due_on <= today) { if (isAwake(item, today)) dueNow += 1 }
    else if (item.due_on === tomorrow && isAwake(item, tomorrow)) dueTomorrow += 1
  }
  return { dueNow, dueTomorrow }
}

export interface ReminderItem { kind: ReminderKind; title: string; body: string }

/**
 * The sitting planner: a full mock (or test) already on the calendar for a future date.
 * Stracker has no separate "schedule" table — a planned paper is a test row with a future
 * `test_date`, which keeps one source of truth and lets the student edit it like any test.
 */
export function upcomingSittings(data: AppData, today: string): { id: string; title: string; date: string; type: string }[] {
  return data.tests
    .filter(test => test.test_date > today && (test.marks_obtained === null || test.marks_obtained === undefined))
    .sort((a, b) => a.test_date.localeCompare(b.test_date))
    .map(test => ({ id: test.id, title: test.title, date: test.test_date, type: test.test_type }))
}

/** Days between two IST calendar dates (`yyyy-mm-dd`), absolute. */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T12:00:00`)
  const end = Date.parse(`${to}T12:00:00`)
  return Math.round(Math.abs(end - start) / 86_400_000)
}

/** A gap longer than this between full mocks is worth a nudge. */
export const MOCK_GAP_WARN_DAYS = 14

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
  if (enabled.has('mock')) {
    // Sitting planner: the reminder mock rule already exists, but a gap between mocks is the
    // thing that actually costs marks. Warn when the last paper is 14+ days old, or when the
    // next scheduled one is close and nothing is booked.
    const lastMock = [...data.tests].filter(test => test.test_type === 'Full Mock').sort((a, b) => b.test_date.localeCompare(a.test_date))[0]
    const mockGap = lastMock ? daysBetween(lastMock.test_date, today) : null
    if (mockGap !== null && mockGap >= MOCK_GAP_WARN_DAYS) {
      items.push({ kind: 'mock', title: 'No full mock recently', body: `Your last full mock was ${mockGap} days ago. A paper every 1–2 weeks keeps timing real.` })
    }
  }
  for (const sitting of upcomingSittings(data, today)) {
    const days = daysBetween(today, sitting.date)
    if (days <= 3 && days >= 0) items.push({ kind: 'mock', title: 'Mock booked soon', body: `${sitting.title} is in ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`}.` })
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
  const parts = cachedDateFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  const hh = Number(parts.find(part => part.type === 'hour')?.value ?? 0)
  const mm = Number(parts.find(part => part.type === 'minute')?.value ?? 0)
  if (hh * 60 + mm < (hours ?? 0) * 60 + (minutes ?? 0)) return false
  if (!storage) return false
  const fired = storage.getItem(FIRED_KEY)
  if (fired === day) return false
  storage.setItem(FIRED_KEY, day)
  return true
}
