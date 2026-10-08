import type { Subject } from '../types'

export type FocusMode = 'Pomodoro' | 'Short Break' | 'Long Break' | 'Custom'
export interface TimerState {
  mode: FocusMode
  durations: { Pomodoro: number; 'Short Break': number; 'Long Break': number; Custom: number }
  remainingSeconds: number
  running: boolean
  endsAt: number | null
  segmentStartedAt: number | null
  focusStartedAt: string | null
  elapsedSeconds: number
  subject: Subject | null
  chapterId: string | null
  taskId: string | null
  finished: boolean
}

export const defaultTimerState: TimerState = {
  mode: 'Pomodoro', durations: { Pomodoro: 25, 'Short Break': 5, 'Long Break': 15, Custom: 40 },
  remainingSeconds: 25 * 60, running: false, endsAt: null, segmentStartedAt: null,
  focusStartedAt: null, elapsedSeconds: 0, subject: null, chapterId: null, taskId: null, finished: false
}

const FOCUS_MODES: FocusMode[] = ['Pomodoro', 'Short Break', 'Long Break', 'Custom']
const SUBJECTS: Subject[] = ['Physics', 'Chemistry', 'Maths']
const MAX_TIMER_MINUTES = 180

/** Reject malformed custom times before applying the timer's existing 1–180 minute range. */
export function safeCustomMinutes(value: number): number | null {
  if (!Number.isFinite(value) || !Number.isInteger(value)) return null
  return Math.max(1, Math.min(MAX_TIMER_MINUTES, value))
}

export function sanitizeTimerState(input: unknown, now = Date.now()): TimerState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return defaultTimerState
  const parsed = input as Partial<TimerState>
  const durationValue = (value: unknown, fallback: number) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= MAX_TIMER_MINUTES ? Number(value) : fallback
  const durations = {
    Pomodoro: durationValue(parsed.durations?.Pomodoro, defaultTimerState.durations.Pomodoro),
    'Short Break': durationValue(parsed.durations?.['Short Break'], defaultTimerState.durations['Short Break']),
    'Long Break': durationValue(parsed.durations?.['Long Break'], defaultTimerState.durations['Long Break']),
    Custom: durationValue(parsed.durations?.Custom, defaultTimerState.durations.Custom)
  }
  const mode = FOCUS_MODES.includes(parsed.mode as FocusMode) ? parsed.mode as FocusMode : defaultTimerState.mode
  const endsAt = typeof parsed.endsAt === 'number' && Number.isFinite(parsed.endsAt) ? parsed.endsAt : null
  const segmentStartedAt = typeof parsed.segmentStartedAt === 'number' && Number.isFinite(parsed.segmentStartedAt) ? parsed.segmentStartedAt : null
  const shouldRun = parsed.running === true && endsAt !== null && segmentStartedAt !== null
  const maxRemaining = durations[mode] * 60
  const safeEndsAt = shouldRun && endsAt !== null ? Math.min(endsAt, now + maxRemaining * 1000) : null
  const rawRemaining = Number(parsed.remainingSeconds)
  const rawElapsed = parsed.elapsedSeconds
  const restored: TimerState = {
    ...defaultTimerState, ...parsed, mode, durations,
    remainingSeconds: Number.isFinite(rawRemaining) ? Math.max(0, Math.min(maxRemaining, rawRemaining)) : maxRemaining,
    running: shouldRun, endsAt: safeEndsAt,
    segmentStartedAt: shouldRun ? segmentStartedAt : null,
    elapsedSeconds: typeof rawElapsed === 'number' && Number.isFinite(rawElapsed) ? Math.max(0, Math.min(MAX_TIMER_MINUTES * 60, rawElapsed)) : 0,
    focusStartedAt: typeof parsed.focusStartedAt === 'string' && Number.isFinite(Date.parse(parsed.focusStartedAt)) ? parsed.focusStartedAt : null,
    subject: SUBJECTS.includes(parsed.subject as Subject) ? parsed.subject as Subject : null,
    chapterId: typeof parsed.chapterId === 'string' ? parsed.chapterId : null,
    taskId: typeof parsed.taskId === 'string' ? parsed.taskId : null,
    finished: parsed.finished === true
  }
  if (restored.running && restored.endsAt !== null) restored.remainingSeconds = Math.max(0, Math.min(maxRemaining, Math.ceil((restored.endsAt - now) / 1000)))
  return restored
}
