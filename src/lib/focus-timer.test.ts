import { describe, expect, it } from 'vitest'
import { buildFocusSession, defaultTimerState, formatClock, hasUnsavedFocus, liveElapsedSeconds, safeCustomMinutes, sanitizeTimerState, type TimerState } from './focus-timer'

describe('custom focus minutes', () => {
  it('rejects non-finite and fractional values without creating invalid timer state', () => {
    expect(safeCustomMinutes(Number.NaN)).toBeNull()
    expect(safeCustomMinutes(Number.POSITIVE_INFINITY)).toBeNull()
    expect(safeCustomMinutes(1.5)).toBeNull()
  })

  it('preserves the existing whole-minute range', () => {
    expect(safeCustomMinutes(25)).toBe(25)
    expect(safeCustomMinutes(0)).toBe(1)
    expect(safeCustomMinutes(200)).toBe(180)
  })
})

describe('restored focus timer state', () => {
  it('falls back to safe defaults for malformed values and unsupported timer settings', () => {
    const timer = sanitizeTimerState({
      ...defaultTimerState, mode: 'other', running: 'true', remainingSeconds: Number.POSITIVE_INFINITY,
      durations: { Pomodoro: 999, 'Short Break': 0, 'Long Break': 15.5, Custom: 40 }, subject: 'x'.repeat(80), elapsedSeconds: -5
    })
    expect(timer.mode).toBe('Pomodoro')
    expect(timer.running).toBe(false)
    expect(timer.remainingSeconds).toBe(25 * 60)
    expect(timer.durations).toEqual({ Pomodoro: 25, 'Short Break': 5, 'Long Break': 15, Custom: 40 })
    expect(timer.subject).toBeNull()
    expect(timer.elapsedSeconds).toBe(0)
  })

  it('bounds a restored running timer and elapsed time to valid focus-block limits', () => {
    const now = 1_800_000_000_000
    const timer = sanitizeTimerState({
      ...defaultTimerState, running: true, segmentStartedAt: now, endsAt: now + 60 * 60 * 1000,
      remainingSeconds: 99_999, elapsedSeconds: 99_999
    }, now)
    expect(timer.running).toBe(true)
    expect(timer.endsAt).toBe(now + 25 * 60 * 1000)
    expect(timer.remainingSeconds).toBe(25 * 60)
    expect(timer.elapsedSeconds).toBe(180 * 60)
  })

  it('does not resume without a real deadline and segment start', () => {
    const timer = sanitizeTimerState({ ...defaultTimerState, running: true, endsAt: 1_800_000_001_000 }, 1_800_000_000_000)
    expect(timer.running).toBe(false)
    expect(timer.endsAt).toBeNull()
    expect(timer.segmentStartedAt).toBeNull()
  })
})

describe('live elapsed time and partial focus sessions', () => {
  const T0 = 1_800_000_000_000
  const running = (overrides: Partial<TimerState> = {}): TimerState => ({
    ...defaultTimerState, running: true, segmentStartedAt: T0, endsAt: T0 + 25 * 60_000, remainingSeconds: 25 * 60,
    focusStartedAt: new Date(T0).toISOString(), blockId: '11111111-1111-4111-8111-111111111111', ...overrides
  })

  it('adds the running segment to previously paused segments, from timestamps', () => {
    const state = running({ elapsedSeconds: 600, segmentStartedAt: T0, endsAt: T0 + 15 * 60_000 })
    expect(liveElapsedSeconds(state, T0 + 8 * 60_000 + 42_000)).toBe(18 * 60 + 42)
    expect(formatClock(liveElapsedSeconds(state, T0 + 8 * 60_000 + 42_000))).toBe('18:42')
  })

  it('never counts past the block deadline even if the tab was throttled', () => {
    expect(liveElapsedSeconds(running(), T0 + 60 * 60_000)).toBe(25 * 60)
  })

  it('keeps a paused block frozen and ignores breaks', () => {
    const paused = { ...defaultTimerState, elapsedSeconds: 300, remainingSeconds: 20 * 60 }
    expect(liveElapsedSeconds(paused, T0)).toBe(300)
    expect(liveElapsedSeconds(paused, T0 + 999_999)).toBe(300)
    expect(liveElapsedSeconds({ ...running(), mode: 'Short Break' }, T0 + 60_000)).toBe(0)
    expect(hasUnsavedFocus(paused)).toBe(true)
    expect(hasUnsavedFocus({ ...paused, finished: true })).toBe(false)
  })

  it('builds an interrupted session with real elapsed minutes and the block metadata', () => {
    const state = running({ elapsedSeconds: 600, subject: 'Physics', chapterId: 'ch-1', activity: 'Revision' })
    const session = buildFocusSession(state, false, T0 + 8 * 60_000, 'fallback')!
    expect(session).toMatchObject({ id: state.blockId, duration_minutes: 18, completion_state: 'interrupted', subject: 'Physics', chapter_id: 'ch-1', activity: 'Revision', mode: 'Pomodoro', started_at: new Date(T0).toISOString(), ended_at: new Date(T0 + 8 * 60_000).toISOString() })
  })

  it('marks a natural completion as completed and refuses sub-minute or break rows', () => {
    expect(buildFocusSession(running(), true, T0 + 25 * 60_000, 'x')?.completion_state).toBe('completed')
    expect(buildFocusSession(running(), false, T0 + 20_000, 'x')).toBeNull()
    expect(buildFocusSession({ ...running(), mode: 'Long Break' }, false, T0 + 10 * 60_000, 'x')).toBeNull()
  })

  it('reuses the block id so repeated saves of one block upsert one row', () => {
    const state = running()
    expect(buildFocusSession(state, false, T0 + 5 * 60_000, 'a')!.id).toBe(buildFocusSession(state, false, T0 + 6 * 60_000, 'b')!.id)
  })

  it('restores a running block with its id and elapsed time after a reload', () => {
    const restored = sanitizeTimerState(JSON.parse(JSON.stringify(running({ elapsedSeconds: 120 }))), T0 + 60_000)
    expect(restored.running).toBe(true)
    expect(restored.blockId).toBe('11111111-1111-4111-8111-111111111111')
    expect(liveElapsedSeconds(restored, T0 + 60_000)).toBe(180)
    expect(sanitizeTimerState({ ...defaultTimerState, blockId: 'not-a-uuid' }).blockId).toBeNull()
  })
})
