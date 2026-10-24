import type { StudyActivity, StudySession, Subject } from '../types'

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
  /** What kind of studying this block is. Recorded on the study session. */
  activity: StudyActivity
  /**
   * Stable id for the current focus block. The study_sessions row is written with this
   * id, so a repeated End/Save/completion for the same block overwrites one record
   * instead of creating a duplicate. Null until the first segment starts.
   */
  blockId: string | null
}

export const defaultTimerState: TimerState = {
  mode: 'Pomodoro', durations: { Pomodoro: 25, 'Short Break': 5, 'Long Break': 15, Custom: 40 },
  remainingSeconds: 25 * 60, running: false, endsAt: null, segmentStartedAt: null,
  focusStartedAt: null, elapsedSeconds: 0, subject: null, chapterId: null, taskId: null, finished: false, activity: 'Practice', blockId: null
}

const FOCUS_MODES: FocusMode[] = ['Pomodoro', 'Short Break', 'Long Break', 'Custom']
const FOCUS_ACTIVITIES: StudyActivity[] = ['Lecture', 'Practice', 'Revision', 'Mock/Test', 'PYQ practice']
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
    subject: typeof parsed.subject === 'string' && parsed.subject.trim() && parsed.subject.length <= 60 ? parsed.subject as Subject : null,
    chapterId: typeof parsed.chapterId === 'string' ? parsed.chapterId : null,
    taskId: typeof parsed.taskId === 'string' ? parsed.taskId : null,
    finished: parsed.finished === true,
    activity: FOCUS_ACTIVITIES.includes(parsed.activity as StudyActivity) ? parsed.activity as StudyActivity : defaultTimerState.activity,
    blockId: typeof parsed.blockId === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.blockId) ? parsed.blockId : null
  }
  if (restored.running && restored.endsAt !== null) restored.remainingSeconds = Math.max(0, Math.min(maxRemaining, Math.ceil((restored.endsAt - now) / 1000)))
  return restored
}

/** Only Pomodoro and Custom blocks are study time; breaks are never logged. */
export function isFocusMode(mode: FocusMode): boolean {
  return mode === 'Pomodoro' || mode === 'Custom'
}

/**
 * Real studied seconds for the current block: every finished (paused) segment plus the
 * running segment, measured from wall-clock timestamps and capped at the block deadline.
 * Throttled intervals or a backgrounded tab cannot distort it.
 */
export function liveElapsedSeconds(state: TimerState, now = Date.now()): number {
  if (!isFocusMode(state.mode)) return 0
  const until = state.running && state.endsAt !== null ? Math.min(now, state.endsAt) : now
  const tail = state.running && state.segmentStartedAt !== null ? Math.max(0, (until - state.segmentStartedAt) / 1000) : 0
  return Math.min(MAX_TIMER_MINUTES * 60, Math.max(0, state.elapsedSeconds + tail))
}

/** Whole minutes that a save would record (the integer-minute study_sessions format). */
export function loggableMinutes(seconds: number): number {
  return Math.max(0, Math.min(MAX_TIMER_MINUTES, Math.round(seconds / 60)))
}

/** True when the current focus block holds studied time that has not been saved yet. */
export function hasUnsavedFocus(state: TimerState, now = Date.now()): boolean {
  return isFocusMode(state.mode) && !state.finished && liveElapsedSeconds(state, now) > 0
}

/** "mm:ss" (or "h:mm:ss") for a live counter. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * Builds the study_sessions row for a focus block through the existing session shape.
 * Returns null for breaks and for blocks under the one-minute recording threshold, so
 * no meaningless zero-minute rows are written. `completed` marks a naturally finished
 * block; an ended-early block is stored as 'interrupted' (the schema's partial state),
 * which still counts as study time everywhere sessions are summed.
 */
export function buildFocusSession(state: TimerState, completed: boolean, endedAt: number, fallbackId: string): StudySession | null {
  if (!isFocusMode(state.mode)) return null
  const elapsed = liveElapsedSeconds(state, endedAt)
  const minutes = loggableMinutes(elapsed)
  if (minutes < 1) return null
  const effectiveEnd = state.running && state.endsAt !== null ? Math.min(endedAt, state.endsAt) : endedAt
  const endIso = new Date(effectiveEnd).toISOString()
  return {
    id: state.blockId ?? fallbackId, subject: state.subject, chapter_id: state.chapterId,
    started_at: state.focusStartedAt ?? new Date(effectiveEnd - elapsed * 1000).toISOString(), ended_at: endIso,
    duration_minutes: minutes, completion_state: completed ? 'completed' : 'interrupted',
    mode: state.mode, activity: state.activity ?? 'Practice', created_at: endIso, updated_at: endIso
  }
}
