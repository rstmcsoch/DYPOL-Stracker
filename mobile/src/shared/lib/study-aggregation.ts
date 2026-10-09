import { addDays, endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfWeek, subMonths, subWeeks } from 'date-fns'
import { indiaDate, indiaToday } from './date'
import type { StudySession } from '../types'

export type StudyTimeView = 'day' | 'week' | 'month'
export interface StudyBar { date: string; label: string; hours: number }
export interface HeatmapCell { date: string; minutes: number; level: 'none' | 'low' | 'medium' | 'high' | 'goal'; future: boolean }

function minutesBetween(sessions: StudySession[], start: string, end: string): number {
  return sessions.reduce((sum, session) => {
    const date = indiaDate(session.started_at)
    return date >= start && date <= end ? sum + session.duration_minutes : sum
  }, 0)
}

function roundedHours(minutes: number): number {
  return Math.round(minutes / 60 * 10) / 10
}

export function makeStudyBars(sessions: StudySession[], view: StudyTimeView, asOf = indiaToday()): StudyBar[] {
  const today = parseISO(`${asOf}T12:00:00`)
  const bars: StudyBar[] = []

  if (view === 'day') {
    for (let index = 13; index >= 0; index -= 1) {
      const date = format(addDays(today, -index), 'yyyy-MM-dd')
      bars.push({ date, label: format(parseISO(`${date}T12:00:00`), 'd MMM'), hours: roundedHours(minutesBetween(sessions, date, date)) })
    }
    return bars
  }

  if (view === 'week') {
    const currentWeek = startOfWeek(today, { weekStartsOn: 1 })
    for (let index = 7; index >= 0; index -= 1) {
      const start = format(subWeeks(currentWeek, index), 'yyyy-MM-dd')
      const startDate = parseISO(`${start}T12:00:00`)
      const fullWeekEnd = format(endOfWeek(startDate, { weekStartsOn: 1 }), 'yyyy-MM-dd')
      const end = fullWeekEnd < asOf ? fullWeekEnd : asOf
      bars.push({ date: start, label: format(startDate, 'd MMM'), hours: roundedHours(minutesBetween(sessions, start, end)) })
    }
    return bars
  }

  const currentMonth = startOfMonth(today)
  for (let index = 5; index >= 0; index -= 1) {
    const monthStart = subMonths(currentMonth, index)
    const start = format(monthStart, 'yyyy-MM-dd')
    const fullMonthEnd = format(endOfMonth(monthStart), 'yyyy-MM-dd')
    const end = fullMonthEnd < asOf ? fullMonthEnd : asOf
    bars.push({ date: start, label: format(monthStart, 'MMM yy'), hours: roundedHours(minutesBetween(sessions, start, end)) })
  }
  return bars
}

export function makeStudyHeatmap(sessions: StudySession[], dailyGoalMinutes: number, asOf = indiaToday()) {
  const today = parseISO(`${asOf}T12:00:00`)
  const currentWeek = startOfWeek(today, { weekStartsOn: 1 })
  const start = subWeeks(currentWeek, 15)
  const goal = Math.max(1, dailyGoalMinutes)
  const cells: HeatmapCell[] = Array.from({ length: 16 * 7 }, (_, index) => {
    const date = format(addDays(start, index), 'yyyy-MM-dd')
    const minutes = date > asOf ? 0 : minutesBetween(sessions, date, date)
    const ratio = minutes / goal
    const level: HeatmapCell['level'] = minutes === 0 ? 'none' : ratio < 0.3 ? 'low' : ratio < 0.7 ? 'medium' : ratio < 1 ? 'high' : 'goal'
    return { date, minutes, level, future: date > asOf }
  })
  const months: { key: string; label: string; column: number }[] = []
  cells.forEach((cell, index) => {
    const day = parseISO(`${cell.date}T12:00:00`)
    if (day.getDate() <= 7 && !months.some(item => item.key === cell.date.slice(0, 7))) {
      months.push({ key: cell.date.slice(0, 7), label: format(day, 'MMM'), column: Math.floor(index / 7) + 1 })
    }
  })
  return { cells, months, daysLogged: cells.filter(cell => !cell.future && cell.minutes > 0).length }
}
