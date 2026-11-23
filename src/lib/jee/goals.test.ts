import { describe, expect, it } from 'vitest'
import type { AppData, DailyTask, StudySession, WeeklyGoal } from '../../types/index.js'
import { goalProgress } from './goals.js'

const USER = '00000000-0000-4000-8000-000000000001'
const NOW = '2026-11-23T06:00:00.000Z'
const WEEK_START = '2026-11-17' // Monday
const TODAY = '2026-11-23'

const goal = (overrides: Partial<WeeklyGoal> = {}): WeeklyGoal => ({
  id: 'g1', user_id: USER, goal_type: 'study_hours', title: 'Study hours', target: 10,
  progress_value: 0, week_start: WEEK_START, unit: 'hours', created_at: NOW, updated_at: NOW, ...overrides
})

const session = (id: string, startedAt: string, minutes: number): StudySession => ({
  id, user_id: USER, subject: 'Maths', chapter_id: null, started_at: startedAt, ended_at: startedAt,
  duration_minutes: minutes, completion_state: 'completed', mode: 'Custom', activity: 'Practice',
  created_at: NOW, updated_at: NOW
})

const task = (id: string, date: string, minutes: number, done: boolean): DailyTask => ({
  id, user_id: USER, title: `Task ${id}`, subject: 'Maths', chapter_id: null, estimated_minutes: minutes,
  priority: 'Medium', is_completed: done, task_date: date, position: 0, created_at: NOW, updated_at: NOW
})

const data = (overrides: Partial<AppData> = {}): Pick<AppData, 'sessions' | 'tests' | 'chapters' | 'revisions' | 'tasks'> => ({
  sessions: [], tests: [], chapters: [], revisions: [], tasks: [], ...overrides
})

describe('study-hours goal progress', () => {
  it('counts completed planner minutes in the week when there are no study sessions', () => {
    const current = goalProgress(goal(), data({
      tasks: [task('t1', TODAY, 90, true), task('t2', TODAY, 30, false), task('old', '2026-11-10', 120, true)]
    }))
    expect(current).toBe(1.5)
  })

  it('adds planner minutes to study-session hours without counting the same minutes twice', () => {
    // A completed task never writes a study_sessions row, so the two sources are distinct.
    // Sessions: 60m, completed task: 30m → 1.5 hours, not 60 or 90 counted twice as 3.
    const current = goalProgress(goal(), data({
      sessions: [session('s1', '2026-11-23T04:00:00.000Z', 60)],
      tasks: [task('t1', TODAY, 30, true)]
    }))
    expect(current).toBe(1.5)
  })

  it('ignores incomplete tasks and tasks outside the goal week', () => {
    const current = goalProgress(goal(), data({
      sessions: [session('s1', '2026-11-23T04:00:00.000Z', 120)],
      tasks: [task('open', TODAY, 45, false), task('next', '2026-11-24', 60, true)]
    }))
    expect(current).toBe(2)
  })
})
