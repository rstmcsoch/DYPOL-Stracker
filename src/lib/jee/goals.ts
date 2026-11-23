import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { indiaDate } from '../date.js'
import type { AppData, DailyTask, WeeklyGoal } from '../../types/index.js'

/**
 * Weekly-goal progress, shared by the Study plan (where goals are set) and Home (where the
 * current week's goal is now visible). It used to live inside PlannerPage, so the one place
 * a student opens every day could not show the target they set for the week.
 */

export const goalWeekStart = (today: string): string =>
  format(startOfWeek(parseISO(`${today}T12:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd')

export const goalWeekEnd = (weekStart: string): string =>
  format(addDays(parseISO(`${weekStart}T12:00:00`), 6), 'yyyy-MM-dd')

/** Live progress for one goal, from the same records every other page reads. */
export function goalProgress(goal: WeeklyGoal, data: Pick<AppData, 'sessions' | 'tests' | 'chapters' | 'revisions' | 'tasks'>): number {
  const end = goalWeekEnd(goal.week_start)
  if (goal.goal_type === 'study_hours') {
    // Completing a planner task does not write a study_sessions row, so the two
    // sources never describe the same minutes and can be added without overlap.
    const sessionMinutes = data.sessions
      .filter(session => indiaDate(session.started_at) >= goal.week_start && indiaDate(session.started_at) <= end)
      .reduce((sum, session) => sum + session.duration_minutes, 0)
    const taskMinutes = (data.tasks ?? []).filter((task: DailyTask) => task.is_completed && task.task_date >= goal.week_start && task.task_date <= end)
      .reduce((sum, task) => sum + task.estimated_minutes, 0)
    return (sessionMinutes + taskMinutes) / 60
  }
  if (goal.goal_type === 'tests') return data.tests.filter(test => test.test_date >= goal.week_start && test.test_date <= end).length
  if (goal.goal_type === 'chapters') return data.chapters.filter(chapter => chapter.completed_on && chapter.completed_on >= goal.week_start && chapter.completed_on <= end).length
  if (goal.goal_type === 'revisions') return data.revisions.filter(revision => revision.completed_at && indiaDate(revision.completed_at) >= goal.week_start && indiaDate(revision.completed_at) <= end).length
  return goal.progress_value
}

/**
 * The goal the student is working toward this week (the first one, if they set several),
 * with live progress. Manual (`custom`) goals count their stored `progress_value`; every
 * other type is counted from records, so the same number shows on Home and Study plan.
 */
export function currentWeekGoal(
  goals: readonly WeeklyGoal[],
  data: Pick<AppData, 'sessions' | 'tests' | 'chapters' | 'revisions' | 'tasks'>,
  today: string
): { goal: WeeklyGoal; current: number; percent: number } | null {
  const weekStart = goalWeekStart(today)
  const goal = goals.filter(item => item.week_start === weekStart).sort((a, b) => a.title.localeCompare(b.title))[0]
  if (!goal) return null
  const current = goalProgress(goal, data)
  return { goal, current, percent: goal.target > 0 ? Math.max(0, (current / goal.target) * 100) : 0 }
}
