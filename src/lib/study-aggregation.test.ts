import { describe, expect, it } from 'vitest'
import { makeStudyBars, makeStudyHeatmap } from './study-aggregation'
import type { StudySession } from '../types'

function session(id: string, started_at: string, duration_minutes: number): StudySession {
  return {
    id, created_at: started_at, updated_at: started_at, subject: 'Physics', chapter_id: null,
    started_at, ended_at: null, duration_minutes, completion_state: 'completed', mode: 'Pomodoro', activity: 'Practice'
  }
}

describe('study-time calendar aggregation', () => {
  it('uses full Monday-to-Sunday totals for past weeks and only through today for the current week', () => {
    const sessions = [
      session('1', '2026-09-27T19:00:00.000Z', 60), // Monday 28 September in India
      session('2', '2026-10-04T17:00:00.000Z', 30), // Sunday 4 October in India
      session('3', '2026-10-05T01:00:00.000Z', 30), // Monday 5 October in India
      session('4', '2026-10-09T01:00:00.000Z', 90) // Future relative to the selected current date
    ]
    const bars = makeStudyBars(sessions, 'week', '2026-10-08')
    expect(bars).toHaveLength(8)
    expect(bars.find(bar => bar.date === '2026-09-28')?.hours).toBe(1.5)
    expect(bars.find(bar => bar.date === '2026-10-05')?.hours).toBe(0.5)
  })

  it('bins by actual calendar months across 30- and 31-day transitions', () => {
    const sessions = [
      session('1', '2026-04-30T10:00:00.000Z', 30),
      session('2', '2026-05-01T10:00:00.000Z', 60),
      session('3', '2026-05-31T10:00:00.000Z', 90),
      session('4', '2026-06-01T10:00:00.000Z', 120)
    ]
    const bars = makeStudyBars(sessions, 'month', '2026-05-31')
    expect(bars).toHaveLength(6)
    expect(bars.find(bar => bar.date === '2026-04-01')?.hours).toBe(0.5)
    expect(bars.find(bar => bar.date === '2026-05-01')?.hours).toBe(2.5)
  })

  it('aligns the 16-week heatmap to Monday and distinguishes future days', () => {
    const heatmap = makeStudyHeatmap([session('1', '2026-10-07T20:00:00.000Z', 90)], 60, '2026-10-08')
    expect(heatmap.cells).toHaveLength(112)
    expect(heatmap.cells[0]).toMatchObject({ date: '2026-06-22', future: false })
    expect(heatmap.cells[108]).toMatchObject({ date: '2026-10-08', minutes: 90, level: 'goal', future: false })
    expect(heatmap.cells.slice(-3).every(cell => cell.future && cell.minutes === 0)).toBe(true)
    expect(heatmap.daysLogged).toBe(1)
  })
})
