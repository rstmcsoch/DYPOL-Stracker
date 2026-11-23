import type { SupabaseClient } from '@supabase/supabase-js'
import type { TestRecord, TestSubjectScore } from '../../../src/types/index.js'
import { getMeanTestPercentage, getOverallTestPercentage } from '../../../src/lib/analytics.js'
import { settingsSchema } from '../../../src/lib/settings-validation.js'
import { ApiError } from '../http.js'
import { assertStudent } from './student-records.js'

const CHAPTER_STATUSES = ['Not Started', 'Studying', 'Done', 'Revised'] as const

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function loadStudentDashboard(admin: SupabaseClient, studentId: string) {
  const id = await assertStudent(admin, studentId)
  const today = todayUtc()
  const [chapterRows, tests, scores, mistakes, tasksDue, tasksOverdue, sessions] = await Promise.all([
    admin.from('chapters').select('status').eq('user_id', id),
    admin.from('tests').select('id, title, test_date, test_type, marks_obtained, total_marks').eq('user_id', id).order('test_date', { ascending: false }).limit(200),
    admin.from('test_subject_scores').select('id, test_id, subject, marks_obtained, total_marks').eq('user_id', id).limit(2000),
    admin.from('mistakes').select('id', { count: 'exact', head: true }).eq('user_id', id),
    admin.from('daily_tasks').select('id', { count: 'exact', head: true }).eq('user_id', id).eq('is_completed', false).eq('task_date', today),
    admin.from('daily_tasks').select('id', { count: 'exact', head: true }).eq('user_id', id).eq('is_completed', false).lt('task_date', today),
    admin.from('study_sessions').select('id', { count: 'exact', head: true }).eq('user_id', id)
  ])
  if (chapterRows.error || tests.error || scores.error || mistakes.error || tasksDue.error || tasksOverdue.error || sessions.error) {
    throw new ApiError(503, 'records_unavailable', 'The student dashboard could not be loaded. Try again shortly.')
  }
  const statusCounts = Object.fromEntries(CHAPTER_STATUSES.map(status => [status, 0])) as Record<(typeof CHAPTER_STATUSES)[number], number>
  for (const row of (chapterRows.data ?? []) as Array<{ status: string }>) {
    if (row.status in statusCounts) statusCounts[row.status as (typeof CHAPTER_STATUSES)[number]] += 1
  }
  const testRecords = ((tests.data ?? []) as TestRecord[])
  const scoreRecords = ((scores.data ?? []) as TestSubjectScore[])
  const overall = getMeanTestPercentage(testRecords, scoreRecords)
  const recent = testRecords.slice(0, 10).map(test => ({
    id: test.id,
    title: test.title,
    testDate: test.test_date,
    testType: test.test_type,
    percentage: getOverallTestPercentage(test, scoreRecords)
  }))
  return {
    studentId: id,
    chapters: { total: (chapterRows.data ?? []).length, byStatus: statusCounts },
    tests: { count: testRecords.length, meanPercentage: overall.average, scoredCount: overall.count },
    mistakes: mistakes.count ?? 0,
    studySessions: sessions.count ?? 0,
    tasks: { dueToday: tasksDue.count ?? 0, overdue: tasksOverdue.count ?? 0 },
    recentTests: recent
  }
}

export async function loadStudentSettings(admin: SupabaseClient, studentId: string) {
  const id = await assertStudent(admin, studentId)
  const { data, error } = await admin.from('app_settings').select('*').eq('user_id', id).maybeSingle()
  if (error) throw new ApiError(503, 'records_unavailable', 'Student settings could not be loaded. Try again shortly.')
  if (!data) return { studentId: id, available: false, settings: null }
  const row = data as Record<string, unknown>
  const candidate = {
    ...row,
    target_score: asNumber(row.target_score) ?? row.target_score,
    weak_threshold: asNumber(row.weak_threshold) ?? row.weak_threshold,
    strong_threshold: asNumber(row.strong_threshold) ?? row.strong_threshold,
    dropping_threshold: asNumber(row.dropping_threshold) ?? row.dropping_threshold,
    weight_high: asNumber(row.weight_high) ?? row.weight_high,
    weight_medium: asNumber(row.weight_medium) ?? row.weight_medium,
    weight_low: asNumber(row.weight_low) ?? row.weight_low,
    main_exam_date: row.main_exam_date ?? '',
    advanced_exam_date: row.advanced_exam_date ?? ''
  }
  const parsed = settingsSchema.safeParse(candidate)
  if (!parsed.success) throw new ApiError(503, 'records_unavailable', 'Student settings could not be read because the stored row is incomplete.')
  return { studentId: id, available: true, settings: parsed.data, lastBackupAt: row.last_backup_at ?? null }
}

export async function loadStudentAnalytics(admin: SupabaseClient, studentId: string) {
  const id = await assertStudent(admin, studentId)
  const [tests, scores] = await Promise.all([
    admin.from('tests').select('id, title, test_date, test_type, marks_obtained, total_marks, subject').eq('user_id', id).order('test_date', { ascending: false }).limit(500),
    admin.from('test_subject_scores').select('id, test_id, subject, marks_obtained, total_marks').eq('user_id', id).limit(4000)
  ])
  if (tests.error || scores.error) throw new ApiError(503, 'records_unavailable', 'Student analytics could not be loaded. Try again shortly.')
  const testRecords = ((tests.data ?? []) as TestRecord[])
  const scoreRecords = ((scores.data ?? []) as TestSubjectScore[])
  const overall = getMeanTestPercentage(testRecords, scoreRecords)
  const byType: Record<string, { count: number; meanPercentage: number | null; scoredCount: number }> = {}
  for (const type of ['Chapter Test', 'Subject Test', 'Full Mock', 'PYQ Practice']) {
    const group = testRecords.filter(test => test.test_type === type)
    const stats = getMeanTestPercentage(group, scoreRecords)
    byType[type] = { count: group.length, meanPercentage: stats.average, scoredCount: stats.count }
  }
  const bySubject: Record<string, { count: number; meanPercentage: number | null }> = {}
  for (const subject of ['Physics', 'Chemistry', 'Maths']) {
    const rows = scoreRecords.filter(score => score.subject === subject && score.marks_obtained != null && score.total_marks)
    const values = rows.map(row => getOverallTestPercentage({
      id: row.id,
      title: subject,
      test_date: '2000-01-01',
      test_type: 'Subject Test',
      marks_obtained: row.marks_obtained,
      total_marks: row.total_marks
    } as TestRecord, [])).filter((value): value is number => value !== null)
    bySubject[subject] = { count: values.length, meanPercentage: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null }
  }
  return {
    studentId: id,
    tests: { count: testRecords.length, meanPercentage: overall.average, scoredCount: overall.count },
    byType,
    bySubject,
    recent: testRecords.slice(0, 15).map(test => ({
      id: test.id,
      title: test.title,
      testDate: test.test_date,
      testType: test.test_type,
      percentage: getOverallTestPercentage(test, scoreRecords)
    }))
  }
}
