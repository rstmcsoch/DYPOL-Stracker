import { describe, expect, it } from 'vitest'
import { defaultTimerState, safeCustomMinutes, sanitizeTimerState } from './focus-timer'

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
      durations: { Pomodoro: 999, 'Short Break': 0, 'Long Break': 15.5, Custom: 40 }, subject: 'Biology', elapsedSeconds: -5
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
