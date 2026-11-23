import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { AppData, AppSettings, Chapter, ChapterStage, PyqRecord, Revision, TestChapterLink, TestRecord } from '../../../src/types/index.js'
import { CHAPTER_STAGE_KEYS, PRACTICE_SOURCES, STUDY_ACTIVITIES, SUBJECTS } from '../../../src/types/index.js'
import { completeRevision } from '../../../src/lib/revision-actions.js'
import { indiaToday, plusDays } from '../../../src/lib/date.js'
import { taskInputSchema } from '../../../src/lib/task-validation.js'
import { goalSchema } from '../../../src/lib/goal-validation.js'
import { getWeekStart } from '../../../src/lib/analytics.js'
import { chapterStages } from '../../../src/lib/jee/progress.js'
import { pyqRecordSchema, backlogItemSchema, studyCardSchema, testErrorLogSchema, testTimeEntrySchema, userExamTrackSchema } from '../../../src/lib/jee-record-schemas.js'
import { POSTGRES_INTEGER_MAX } from '../../../src/lib/test-validation.js'
import { ApiError } from '../http.js'
import { loadStudentSettings } from './student-insights.js'
import {
  assertStudent, deleteOwned, insertRow, listAllOwned, listOwned, loadOwned, parseOrThrow, updateRow
} from './student-records.js'

const DEFAULT_GAPS = [1, 7, 30]
const EXPORT_CAP = 20_000
const SENSITIVE_EXPORT_KEYS = /password|token|secret|api[_-]?key|otp|credential|authorization/i

async function assertOwnedChapter(admin: SupabaseClient, chapterId: string, studentId: string) {
  await loadOwned(admin, 'chapters', chapterId, studentId, 'That chapter was not found.')
}

async function assertOwnedTest(admin: SupabaseClient, testId: string, studentId: string) {
  await loadOwned(admin, 'tests', testId, studentId, 'That test was not found.')
}

async function revisionGaps(admin: SupabaseClient, studentId: string): Promise<number[]> {
  const loaded = await loadStudentSettings(admin, studentId)
  const gaps = loaded.settings?.revision_gaps
  return Array.isArray(gaps) && gaps.length ? gaps : DEFAULT_GAPS
}

const revisionInputSchema = z.object({
  chapter_id: z.uuid(),
  revision_number: z.number().finite().int().positive().max(POSTGRES_INTEGER_MAX),
  due_on: z.iso.date()
}).strict()

export async function listRevisions(admin: SupabaseClient, studentId: string, query: { chapterId?: string; page?: unknown; pageSize?: unknown }) {
  const id = await assertStudent(admin, studentId)
  if (query.chapterId) await assertOwnedChapter(admin, query.chapterId, id)
  return listOwned(admin, 'chapter_revisions', id, { page: query.page, pageSize: query.pageSize, eq: query.chapterId ? { chapter_id: query.chapterId } : undefined })
}

export async function createRevision(admin: SupabaseClient, studentId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const body = parseOrThrow(revisionInputSchema, input, 'Check the revision details and try again.')
  await assertOwnedChapter(admin, body.chapter_id, id)
  return insertRow(admin, 'chapter_revisions', { id: randomUUID(), user_id: id, ...body, completed_at: null }, 'The revision could not be saved.')
}

export async function updateRevision(admin: SupabaseClient, studentId: string, revisionId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'chapter_revisions', revisionId, id, 'That revision was not found.')
  const body = parseOrThrow(revisionInputSchema.partial().refine(value => Object.keys(value).length > 0, 'Provide at least one revision field to update.'), input, 'Check the revision details and try again.')
  if (body.chapter_id) await assertOwnedChapter(admin, body.chapter_id, id)
  return updateRow(admin, 'chapter_revisions', revisionId, id, body, 'The revision could not be updated.')
}

export async function snoozeRevision(admin: SupabaseClient, studentId: string, revisionId: string, days = 1) {
  const id = await assertStudent(admin, studentId)
  const existing = await loadOwned(admin, 'chapter_revisions', revisionId, id, 'That revision was not found.')
  if (existing.completed_at) throw new ApiError(409, 'already_complete', 'That revision is already complete. Choose an open revision instead.')
  const offset = Number.isInteger(days) && days > 0 && days <= 365 ? days : 1
  return updateRow(admin, 'chapter_revisions', revisionId, id, { due_on: plusDays(indiaToday(), offset) }, 'The revision could not be rescheduled.')
}

export async function completeStudentRevision(admin: SupabaseClient, studentId: string, revisionId: string) {
  const id = await assertStudent(admin, studentId)
  const existing = await loadOwned(admin, 'chapter_revisions', revisionId, id, 'That revision was not found.')
  if (existing.completed_at) throw new ApiError(409, 'already_complete', 'That revision is already complete. Choose an open revision instead.')
  const chapter = await loadOwned(admin, 'chapters', String(existing.chapter_id), id, 'That chapter was not found.')
  const listed = await listAllOwned(admin, 'chapter_revisions', id)
  const chapterRevisions = listed.records.filter(row => row.chapter_id === existing.chapter_id) as unknown as Revision[]
  const gaps = await revisionGaps(admin, id)
  const created: string[] = []
  const ok = await completeRevision(
    existing as unknown as Revision,
    chapter as unknown as Chapter,
    async revisions => {
      for (const item of revisions) {
        const current = listed.records.find(row => row.id === item.id)
        if (current) {
          await updateRow(admin, 'chapter_revisions', item.id, id, { completed_at: item.completed_at, due_on: item.due_on, revision_number: item.revision_number }, 'The revision could not be updated.')
        } else {
          await insertRow(admin, 'chapter_revisions', {
            id: item.id, user_id: id, chapter_id: item.chapter_id, revision_number: item.revision_number,
            due_on: item.due_on, completed_at: item.completed_at ?? null, created_at: item.created_at, updated_at: item.updated_at
          }, 'The next revision could not be scheduled.')
          created.push(item.id)
        }
      }
    },
    async updated => {
      await updateRow(admin, 'chapters', updated.id, id, { status: updated.status }, 'The chapter status could not be updated.')
    },
    { revisions: chapterRevisions, gaps, today: indiaToday() }
  )
  if (!ok) throw new ApiError(409, 'already_complete', 'That revision is already being completed.')
  const next = await loadOwned(admin, 'chapter_revisions', revisionId, id, 'That revision was not found.')
  return { ok: true, studentId: id, revision: next, nextRevisionIds: created, chapterStatus: (chapter.status === 'Done' ? 'Revised' : chapter.status) }
}

export async function deleteRevision(admin: SupabaseClient, studentId: string, revisionId: string) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'chapter_revisions', revisionId, id, 'That revision was not found.')
  await deleteOwned(admin, 'chapter_revisions', revisionId, id, 'The revision could not be deleted.')
  return { ok: true, studentId: id, revisionId }
}

const taskWriteSchema = taskInputSchema.extend({
  subject: z.enum(SUBJECTS).nullable().optional(),
  chapter_id: z.uuid().nullable().optional(),
  priority: z.enum(['High', 'Medium', 'Low']).optional(),
  is_completed: z.boolean().optional(),
  position: z.number().finite().int().min(0).max(POSTGRES_INTEGER_MAX).optional()
}).strict()

export async function listTasks(admin: SupabaseClient, studentId: string, query: { q?: unknown; page?: unknown; pageSize?: unknown }) {
  const id = await assertStudent(admin, studentId)
  return listOwned(admin, 'daily_tasks', id, { q: typeof query.q === 'string' ? query.q : undefined, searchColumn: 'title', page: query.page, pageSize: query.pageSize, order: 'position' })
}

export async function createTask(admin: SupabaseClient, studentId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const body = parseOrThrow(taskWriteSchema, input, 'Check the task details and try again.')
  if (body.chapter_id) await assertOwnedChapter(admin, body.chapter_id, id)
  return insertRow(admin, 'daily_tasks', {
    id: randomUUID(), user_id: id, title: body.title, topic: body.topic ?? null, estimated_minutes: body.estimated_minutes,
    task_date: body.task_date, subject: body.subject ?? null, chapter_id: body.chapter_id ?? null,
    priority: body.priority ?? 'Medium', is_completed: body.is_completed ?? false, position: body.position ?? 0
  }, 'The task could not be saved.')
}

export async function updateTask(admin: SupabaseClient, studentId: string, taskId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'daily_tasks', taskId, id, 'That task was not found.')
  const body = parseOrThrow(taskWriteSchema.partial().refine(value => Object.keys(value).length > 0, 'Provide at least one task field to update.'), input, 'Check the task details and try again.')
  if (body.chapter_id) await assertOwnedChapter(admin, body.chapter_id, id)
  return updateRow(admin, 'daily_tasks', taskId, id, body, 'The task could not be updated.')
}

export async function reorderTasks(admin: SupabaseClient, studentId: string, items: Array<{ id: string; position: number }>) {
  const id = await assertStudent(admin, studentId)
  if (!items.length) throw new ApiError(400, 'invalid_request', 'Provide the task order.')
  const updated = []
  for (const item of items) {
    await loadOwned(admin, 'daily_tasks', item.id, id, 'That task was not found.')
    if (!Number.isInteger(item.position) || item.position < 0 || item.position > POSTGRES_INTEGER_MAX) {
      throw new ApiError(400, 'invalid_request', 'Task positions must be whole numbers of 0 or more.')
    }
    updated.push(await updateRow(admin, 'daily_tasks', item.id, id, { position: item.position }, 'The task order could not be saved.'))
  }
  return { ok: true, records: updated }
}

export async function completeTask(admin: SupabaseClient, studentId: string, taskId: string) {
  return updateTask(admin, studentId, taskId, { is_completed: true })
}

export async function deleteTask(admin: SupabaseClient, studentId: string, taskId: string) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'daily_tasks', taskId, id, 'That task was not found.')
  await deleteOwned(admin, 'daily_tasks', taskId, id, 'The task could not be deleted.')
  return { ok: true, studentId: id, taskId }
}

export async function listGoals(admin: SupabaseClient, studentId: string, query: { page?: unknown; pageSize?: unknown }) {
  const id = await assertStudent(admin, studentId)
  return listOwned(admin, 'weekly_goals', id, { page: query.page, pageSize: query.pageSize, order: 'week_start' })
}

export async function createGoal(admin: SupabaseClient, studentId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const body = parseOrThrow(goalSchema, input, 'Check the weekly goal and try again.')
  return insertRow(admin, 'weekly_goals', { id: randomUUID(), user_id: id, ...body, week_start: getWeekStart(body.week_start) }, 'The weekly goal could not be saved.')
}

export async function updateGoal(admin: SupabaseClient, studentId: string, goalId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const existing = await loadOwned(admin, 'weekly_goals', goalId, id, 'That weekly goal was not found.')
  const merged = {
    goal_type: existing.goal_type, title: existing.title, target: Number(existing.target),
    progress_value: Number(existing.progress_value), week_start: existing.week_start, unit: existing.unit,
    ...(input as Record<string, unknown>)
  }
  const body = parseOrThrow(goalSchema, merged, 'Check the weekly goal and try again.')
  return updateRow(admin, 'weekly_goals', goalId, id, { ...body, week_start: getWeekStart(body.week_start) }, 'The weekly goal could not be updated.')
}

export async function completeGoal(admin: SupabaseClient, studentId: string, goalId: string) {
  const id = await assertStudent(admin, studentId)
  const existing = await loadOwned(admin, 'weekly_goals', goalId, id, 'That weekly goal was not found.')
  return updateGoal(admin, studentId, goalId, { progress_value: Number(existing.target) })
}

export async function deleteGoal(admin: SupabaseClient, studentId: string, goalId: string) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'weekly_goals', goalId, id, 'That weekly goal was not found.')
  await deleteOwned(admin, 'weekly_goals', goalId, id, 'The weekly goal could not be deleted.')
  return { ok: true, studentId: id, goalId }
}

const sessionInputSchema = z.object({
  subject: z.enum(SUBJECTS).nullable().optional(),
  chapter_id: z.uuid().nullable().optional(),
  started_at: z.iso.datetime({ offset: true }),
  ended_at: z.iso.datetime({ offset: true }),
  duration_minutes: z.number().finite().int().min(0).max(1440),
  completion_state: z.enum(['completed', 'interrupted']).optional(),
  mode: z.enum(['Pomodoro', 'Short Break', 'Long Break', 'Custom']).optional(),
  activity: z.enum(STUDY_ACTIVITIES).optional(),
  notes: z.string().max(2000).optional()
}).strict()

function assertHistoricalSession(row: Record<string, unknown>, action: string) {
  if (row.ended_at == null) throw new ApiError(409, 'active_session', `Master MCP cannot ${action} an active study timer. Wait until the student ends the block, or create a historical session with an end time.`)
}

export async function listSessions(admin: SupabaseClient, studentId: string, query: { page?: unknown; pageSize?: unknown }) {
  const id = await assertStudent(admin, studentId)
  return listOwned(admin, 'study_sessions', id, { page: query.page, pageSize: query.pageSize, order: 'started_at' })
}

export async function createSession(admin: SupabaseClient, studentId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const body = parseOrThrow(sessionInputSchema, input, 'Check the study session and try again.')
  if (body.chapter_id) await assertOwnedChapter(admin, body.chapter_id, id)
  return insertRow(admin, 'study_sessions', {
    id: randomUUID(), user_id: id, subject: body.subject ?? null, chapter_id: body.chapter_id ?? null,
    started_at: body.started_at, ended_at: body.ended_at, duration_minutes: body.duration_minutes,
    completion_state: body.completion_state ?? 'completed', mode: body.mode ?? 'Pomodoro',
    activity: body.activity ?? 'Practice', notes: body.notes ?? ''
  }, 'The study session could not be saved.')
}

export async function updateSession(admin: SupabaseClient, studentId: string, sessionId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const existing = await loadOwned(admin, 'study_sessions', sessionId, id, 'That study session was not found.')
  assertHistoricalSession(existing, 'edit')
  const body = parseOrThrow(sessionInputSchema.partial().refine(value => Object.keys(value).length > 0, 'Provide at least one session field to update.'), input, 'Check the study session and try again.')
  if (body.ended_at === undefined && 'ended_at' in (input as object) && (input as { ended_at?: unknown }).ended_at == null) {
    throw new ApiError(400, 'invalid_request', 'A historical study session must keep an end time. Master MCP cannot reopen an active timer.')
  }
  if (body.chapter_id) await assertOwnedChapter(admin, body.chapter_id, id)
  return updateRow(admin, 'study_sessions', sessionId, id, body, 'The study session could not be updated.')
}

export async function deleteSession(admin: SupabaseClient, studentId: string, sessionId: string) {
  const id = await assertStudent(admin, studentId)
  const existing = await loadOwned(admin, 'study_sessions', sessionId, id, 'That study session was not found.')
  assertHistoricalSession(existing, 'delete')
  await deleteOwned(admin, 'study_sessions', sessionId, id, 'The study session could not be deleted.')
  return { ok: true, studentId: id, sessionId }
}

const practiceWriteSchema = z.object({
  chapter_id: z.uuid(),
  practice_date: z.iso.date(),
  attempted: z.number().finite().int().min(0).max(100000),
  correct: z.number().finite().int().min(0).max(100000),
  incorrect: z.number().finite().int().min(0).max(100000),
  skipped: z.number().finite().int().min(0).max(100000).optional(),
  source: z.enum(PRACTICE_SOURCES),
  time_minutes: z.number().finite().int().min(0).max(1440).nullable(),
  notes: z.string().max(5000)
}).strict().refine(value => value.correct + value.incorrect <= value.attempted, {
  path: ['attempted'], message: 'Correct plus incorrect cannot exceed attempted.'
})

export async function listPractice(admin: SupabaseClient, studentId: string, query: { chapterId?: string; page?: unknown; pageSize?: unknown }) {
  const id = await assertStudent(admin, studentId)
  if (query.chapterId) await assertOwnedChapter(admin, query.chapterId, id)
  return listOwned(admin, 'practice_sessions', id, { page: query.page, pageSize: query.pageSize, eq: query.chapterId ? { chapter_id: query.chapterId } : undefined })
}

export async function createPractice(admin: SupabaseClient, studentId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const body = parseOrThrow(practiceWriteSchema, input, 'Check the practice record and try again.')
  await assertOwnedChapter(admin, body.chapter_id, id)
  return insertRow(admin, 'practice_sessions', { id: randomUUID(), user_id: id, ...body, skipped: body.skipped ?? 0, notes: body.notes ?? '' }, 'The practice record could not be saved.')
}

export async function updatePractice(admin: SupabaseClient, studentId: string, practiceId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const existing = await loadOwned(admin, 'practice_sessions', practiceId, id, 'That practice record was not found.')
  const body = parseOrThrow(practiceWriteSchema, { ...existing, ...(input as object), user_id: undefined, id: undefined, created_at: undefined, updated_at: undefined }, 'Check the practice record and try again.')
  await assertOwnedChapter(admin, body.chapter_id, id)
  return updateRow(admin, 'practice_sessions', practiceId, id, body, 'The practice record could not be updated.')
}

export async function deletePractice(admin: SupabaseClient, studentId: string, practiceId: string) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'practice_sessions', practiceId, id, 'That practice record was not found.')
  await deleteOwned(admin, 'practice_sessions', practiceId, id, 'The practice record could not be deleted.')
  return { ok: true, studentId: id, practiceId }
}

const pyqWriteSchema = pyqRecordSchema.omit({ id: true, created_at: true, updated_at: true, user_id: true }).refine(
  value => value.questions_total == null || value.questions_done == null || value.questions_done <= value.questions_total,
  { path: ['questions_done'], message: 'Questions done cannot exceed the total.' }
)

async function assertPyqUnique(admin: SupabaseClient, studentId: string, chapterId: string, exam: string, year: number, exceptId?: string) {
  const { data, error } = await admin.from('pyq_records').select('id').eq('user_id', studentId).eq('chapter_id', chapterId).eq('exam', exam).eq('year', year).maybeSingle()
  if (error) throw new ApiError(503, 'records_unavailable', 'PYQ records could not be checked. Try again shortly.')
  if (data && data.id !== exceptId) throw new ApiError(409, 'conflict', 'A PYQ record already exists for that chapter, exam and year.')
}

export async function listPyq(admin: SupabaseClient, studentId: string, query: { chapterId?: string; page?: unknown; pageSize?: unknown }) {
  const id = await assertStudent(admin, studentId)
  if (query.chapterId) await assertOwnedChapter(admin, query.chapterId, id)
  return listOwned(admin, 'pyq_records', id, { page: query.page, pageSize: query.pageSize, eq: query.chapterId ? { chapter_id: query.chapterId } : undefined })
}

export async function createPyq(admin: SupabaseClient, studentId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const body = parseOrThrow(pyqWriteSchema, input, 'Check the PYQ record and try again.')
  await assertOwnedChapter(admin, body.chapter_id, id)
  await assertPyqUnique(admin, id, body.chapter_id, body.exam, body.year)
  const completed_at = body.status === 'done' ? (body.completed_at ?? new Date().toISOString()) : null
  return insertRow(admin, 'pyq_records', { id: randomUUID(), user_id: id, ...body, completed_at }, 'The PYQ record could not be saved.')
}

export async function updatePyq(admin: SupabaseClient, studentId: string, pyqId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const existing = await loadOwned(admin, 'pyq_records', pyqId, id, 'That PYQ record was not found.')
  const body = parseOrThrow(pyqWriteSchema, { ...existing, ...(input as object), user_id: undefined, id: undefined, created_at: undefined, updated_at: undefined }, 'Check the PYQ record and try again.')
  await assertOwnedChapter(admin, body.chapter_id, id)
  await assertPyqUnique(admin, id, body.chapter_id, body.exam, body.year, pyqId)
  const completed_at = body.status === 'done' ? (body.completed_at ?? existing.completed_at ?? new Date().toISOString()) : null
  return updateRow(admin, 'pyq_records', pyqId, id, { ...body, completed_at }, 'The PYQ record could not be updated.')
}

export async function deletePyq(admin: SupabaseClient, studentId: string, pyqId: string) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'pyq_records', pyqId, id, 'That PYQ record was not found.')
  await deleteOwned(admin, 'pyq_records', pyqId, id, 'The PYQ record could not be deleted.')
  return { ok: true, studentId: id, pyqId }
}

async function loadStageContext(admin: SupabaseClient, studentId: string) {
  const [chapters, stages, pyqs, tests, links, revisions, settings] = await Promise.all([
    listAllOwned(admin, 'chapters', studentId),
    listAllOwned(admin, 'chapter_stages', studentId),
    listAllOwned(admin, 'pyq_records', studentId),
    listAllOwned(admin, 'tests', studentId),
    listAllOwned(admin, 'test_chapter_links', studentId),
    listAllOwned(admin, 'chapter_revisions', studentId),
    loadStudentSettings(admin, studentId)
  ])
  const data = {
    chapters: chapters.records as unknown as Chapter[],
    chapterStages: stages.records as unknown as ChapterStage[],
    pyqRecords: pyqs.records as unknown as PyqRecord[],
    tests: tests.records as unknown as TestRecord[],
    testChapterLinks: links.records as unknown as TestChapterLink[],
    revisions: revisions.records as unknown as Revision[],
    settings: (settings.settings ?? { pyq_from_year: 2019, pyq_to_year: 2026, exam_id: null }) as AppSettings
  } as AppData
  return { data, claims: stages.records }
}

export async function listChapterStages(admin: SupabaseClient, studentId: string) {
  const id = await assertStudent(admin, studentId)
  const { data } = await loadStageContext(admin, id)
  return {
    studentId: id,
    chapters: data.chapters.map(chapter => ({
      chapterId: chapter.id, name: chapter.name, subject: chapter.subject, stages: chapterStages(data, chapter)
    }))
  }
}

export async function updateChapterStage(admin: SupabaseClient, studentId: string, input: { chapterId: string; stage: string; done: boolean }) {
  const id = await assertStudent(admin, studentId)
  const stage = parseOrThrow(z.enum(CHAPTER_STAGE_KEYS), input.stage, 'Choose a valid chapter stage.')
  await assertOwnedChapter(admin, input.chapterId, id)
  const { data: existing, error } = await admin.from('chapter_stages').select('*').eq('user_id', id).eq('chapter_id', input.chapterId).eq('stage', stage).maybeSingle()
  if (error) throw new ApiError(503, 'records_unavailable', 'Chapter stages could not be loaded. Try again shortly.')
  const completed_at = input.done ? new Date().toISOString() : null
  if (existing) {
    return updateRow(admin, 'chapter_stages', String(existing.id), id, { done: input.done, completed_at }, 'The chapter stage could not be updated.')
  }
  return insertRow(admin, 'chapter_stages', {
    id: randomUUID(), user_id: id, chapter_id: input.chapterId, stage, done: input.done, completed_at
  }, 'The chapter stage could not be saved.')
}

export async function deleteChapterStageClaim(admin: SupabaseClient, studentId: string, stageId: string) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'chapter_stages', stageId, id, 'That chapter stage claim was not found.')
  await deleteOwned(admin, 'chapter_stages', stageId, id, 'The chapter stage claim could not be deleted.')
  return { ok: true, studentId: id, stageId }
}

const backlogWriteSchema = backlogItemSchema.omit({ id: true, created_at: true, updated_at: true, user_id: true })

export async function listBacklog(admin: SupabaseClient, studentId: string, query: { q?: unknown; page?: unknown; pageSize?: unknown }) {
  const id = await assertStudent(admin, studentId)
  return listOwned(admin, 'backlog_items', id, { q: typeof query.q === 'string' ? query.q : undefined, searchColumn: 'title', page: query.page, pageSize: query.pageSize })
}

export async function createBacklog(admin: SupabaseClient, studentId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const body = parseOrThrow(backlogWriteSchema, input, 'Check the backlog item and try again.')
  if (body.chapter_id) await assertOwnedChapter(admin, body.chapter_id, id)
  return insertRow(admin, 'backlog_items', { id: randomUUID(), user_id: id, ...body, notes: body.notes ?? '' }, 'The backlog item could not be saved.')
}

export async function updateBacklog(admin: SupabaseClient, studentId: string, itemId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const existing = await loadOwned(admin, 'backlog_items', itemId, id, 'That backlog item was not found.')
  const body = parseOrThrow(backlogWriteSchema, { ...existing, ...(input as object), user_id: undefined, id: undefined, created_at: undefined, updated_at: undefined }, 'Check the backlog item and try again.')
  if (body.chapter_id) await assertOwnedChapter(admin, body.chapter_id, id)
  return updateRow(admin, 'backlog_items', itemId, id, body, 'The backlog item could not be updated.')
}

export async function snoozeBacklog(admin: SupabaseClient, studentId: string, itemId: string, until?: string) {
  const snoozed_until = until ?? plusDays(indiaToday(), 1)
  parseOrThrow(z.iso.date(), snoozed_until, 'Choose a valid snooze date.')
  return updateBacklog(admin, studentId, itemId, { status: 'snoozed', snoozed_until })
}

export async function completeBacklog(admin: SupabaseClient, studentId: string, itemId: string) {
  return updateBacklog(admin, studentId, itemId, { status: 'done', completed_at: new Date().toISOString(), snoozed_until: null })
}

export async function deleteBacklog(admin: SupabaseClient, studentId: string, itemId: string) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'backlog_items', itemId, id, 'That backlog item was not found.')
  await deleteOwned(admin, 'backlog_items', itemId, id, 'The backlog item could not be deleted.')
  return { ok: true, studentId: id, itemId }
}

const cardWriteSchema = studyCardSchema.omit({ id: true, created_at: true, updated_at: true, user_id: true })

export async function listCards(admin: SupabaseClient, studentId: string, query: { chapterId?: string; page?: unknown; pageSize?: unknown }) {
  const id = await assertStudent(admin, studentId)
  if (query.chapterId) await assertOwnedChapter(admin, query.chapterId, id)
  return listOwned(admin, 'study_cards', id, { page: query.page, pageSize: query.pageSize, order: 'position', eq: query.chapterId ? { chapter_id: query.chapterId } : undefined })
}

export async function createCard(admin: SupabaseClient, studentId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const body = parseOrThrow(cardWriteSchema, input, 'Check the study card and try again.')
  await assertOwnedChapter(admin, body.chapter_id, id)
  return insertRow(admin, 'study_cards', { id: randomUUID(), user_id: id, ...body, hint: body.hint ?? '', reviews: body.reviews ?? 0, last_rating: body.last_rating ?? null }, 'The study card could not be saved.')
}

export async function updateCard(admin: SupabaseClient, studentId: string, cardId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const existing = await loadOwned(admin, 'study_cards', cardId, id, 'That study card was not found.')
  const body = parseOrThrow(cardWriteSchema, { ...existing, ...(input as object), user_id: undefined, id: undefined, created_at: undefined, updated_at: undefined }, 'Check the study card and try again.')
  await assertOwnedChapter(admin, body.chapter_id, id)
  return updateRow(admin, 'study_cards', cardId, id, body, 'The study card could not be updated.')
}

export async function reorderCards(admin: SupabaseClient, studentId: string, items: Array<{ id: string; position: number }>) {
  const id = await assertStudent(admin, studentId)
  if (!items.length) throw new ApiError(400, 'invalid_request', 'Provide the card order.')
  const updated = []
  for (const item of items) {
    await loadOwned(admin, 'study_cards', item.id, id, 'That study card was not found.')
    updated.push(await updateRow(admin, 'study_cards', item.id, id, { position: item.position }, 'The card order could not be saved.'))
  }
  return { ok: true, records: updated }
}

export async function deleteCard(admin: SupabaseClient, studentId: string, cardId: string) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'study_cards', cardId, id, 'That study card was not found.')
  await deleteOwned(admin, 'study_cards', cardId, id, 'The study card could not be deleted.')
  return { ok: true, studentId: id, cardId }
}

const errorLogWrite = testErrorLogSchema.omit({ id: true, created_at: true, updated_at: true, user_id: true })
const timeEntryWrite = testTimeEntrySchema.omit({ id: true, created_at: true, updated_at: true, user_id: true })

export async function listMockAnalysis(admin: SupabaseClient, studentId: string, query: { kind: 'error_log' | 'time_entry'; testId?: string; page?: unknown; pageSize?: unknown }) {
  const id = await assertStudent(admin, studentId)
  const table = query.kind === 'time_entry' ? 'test_time_entries' : 'test_error_logs'
  if (query.testId) await assertOwnedTest(admin, query.testId, id)
  return listOwned(admin, table, id, { page: query.page, pageSize: query.pageSize, eq: query.testId ? { test_id: query.testId } : undefined })
}

export async function upsertMockAnalysis(admin: SupabaseClient, studentId: string, kind: 'error_log' | 'time_entry', input: unknown, existingId?: string) {
  const id = await assertStudent(admin, studentId)
  if (kind === 'error_log') {
    const body = parseOrThrow(errorLogWrite, input, 'Check the mock error log and try again.')
    await assertOwnedTest(admin, body.test_id, id)
    if (body.chapter_id) await assertOwnedChapter(admin, body.chapter_id, id)
    if (existingId) {
      await loadOwned(admin, 'test_error_logs', existingId, id, 'That error log was not found.')
      return updateRow(admin, 'test_error_logs', existingId, id, body, 'The error log could not be updated.')
    }
    return insertRow(admin, 'test_error_logs', { id: randomUUID(), user_id: id, ...body, note: body.note ?? '' }, 'The error log could not be saved.')
  }
  const body = parseOrThrow(timeEntryWrite, input, 'Check the mock time entry and try again.')
  await assertOwnedTest(admin, body.test_id, id)
  if (existingId) {
    await loadOwned(admin, 'test_time_entries', existingId, id, 'That time entry was not found.')
    return updateRow(admin, 'test_time_entries', existingId, id, body, 'The time entry could not be updated.')
  }
  return insertRow(admin, 'test_time_entries', { id: randomUUID(), user_id: id, ...body, label: body.label ?? '' }, 'The time entry could not be saved.')
}

export async function deleteMockAnalysis(admin: SupabaseClient, studentId: string, kind: 'error_log' | 'time_entry', rowId: string) {
  const id = await assertStudent(admin, studentId)
  const table = kind === 'time_entry' ? 'test_time_entries' : 'test_error_logs'
  const label = kind === 'time_entry' ? 'That time entry was not found.' : 'That error log was not found.'
  await loadOwned(admin, table, rowId, id, label)
  await deleteOwned(admin, table, rowId, id, 'The mock-analysis row could not be deleted.')
  return { ok: true, studentId: id, id: rowId, kind }
}

const trackWrite = userExamTrackSchema.omit({ id: true, created_at: true, updated_at: true, user_id: true })

async function assertTrackUnique(admin: SupabaseClient, studentId: string, track: string, exceptId?: string) {
  const { data, error } = await admin.from('user_exam_tracks').select('id').eq('user_id', studentId).eq('track', track).maybeSingle()
  if (error) throw new ApiError(503, 'records_unavailable', 'Exam tracks could not be checked. Try again shortly.')
  if (data && data.id !== exceptId) throw new ApiError(409, 'conflict', 'That exam track already exists for this student.')
}

export async function listTracks(admin: SupabaseClient, studentId: string, query: { page?: unknown; pageSize?: unknown }) {
  const id = await assertStudent(admin, studentId)
  return listOwned(admin, 'user_exam_tracks', id, { page: query.page, pageSize: query.pageSize })
}

export async function createTrack(admin: SupabaseClient, studentId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const body = parseOrThrow(trackWrite, input, 'Check the exam track and try again.')
  await assertTrackUnique(admin, id, body.track)
  return insertRow(admin, 'user_exam_tracks', { id: randomUUID(), user_id: id, ...body, notes: body.notes ?? '' }, 'The exam track could not be saved.')
}

export async function updateTrack(admin: SupabaseClient, studentId: string, trackId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const existing = await loadOwned(admin, 'user_exam_tracks', trackId, id, 'That exam track was not found.')
  const body = parseOrThrow(trackWrite, { ...existing, ...(input as object), user_id: undefined, id: undefined, created_at: undefined, updated_at: undefined }, 'Check the exam track and try again.')
  await assertTrackUnique(admin, id, body.track, trackId)
  return updateRow(admin, 'user_exam_tracks', trackId, id, body, 'The exam track could not be updated.')
}

export async function deleteTrack(admin: SupabaseClient, studentId: string, trackId: string) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'user_exam_tracks', trackId, id, 'That exam track was not found.')
  await deleteOwned(admin, 'user_exam_tracks', trackId, id, 'The exam track could not be deleted.')
  return { ok: true, studentId: id, trackId }
}

function stripSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitive)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_EXPORT_KEYS.test(key) || key === 'image_preview' || key === 'image_pending' || key === 'image_data') continue
      out[key] = stripSensitive(item)
    }
    return out
  }
  return value
}

const EXPORT_TABLES = [
  'chapters', 'chapter_revisions', 'tests', 'test_subject_scores', 'test_chapter_links', 'mistakes',
  'daily_tasks', 'weekly_goals', 'study_sessions', 'practice_sessions', 'pyq_records', 'chapter_stages',
  'backlog_items', 'study_cards', 'test_error_logs', 'test_time_entries', 'user_exam_tracks'
] as const

const TABLE_TO_BACKUP: Record<string, keyof AppData> = {
  chapters: 'chapters', chapter_revisions: 'revisions', tests: 'tests', test_subject_scores: 'testSubjectScores',
  test_chapter_links: 'testChapterLinks', mistakes: 'mistakes', daily_tasks: 'tasks', weekly_goals: 'goals',
  study_sessions: 'sessions', practice_sessions: 'practiceSessions', pyq_records: 'pyqRecords',
  chapter_stages: 'chapterStages', backlog_items: 'backlogItems', study_cards: 'studyCards',
  test_error_logs: 'testErrorLogs', test_time_entries: 'testTimeEntries', user_exam_tracks: 'examTracks'
}

export async function exportStudentNotebook(admin: SupabaseClient, studentId: string) {
  const id = await assertStudent(admin, studentId)
  const [profileRow, settings, ...tables] = await Promise.all([
    admin.from('profiles').select('id, user_id, display_name, email, created_at, updated_at').eq('user_id', id).maybeSingle(),
    loadStudentSettings(admin, id),
    ...EXPORT_TABLES.map(table => listAllOwned(admin, table, id, EXPORT_CAP))
  ])
  if (profileRow.error) throw new ApiError(503, 'records_unavailable', 'The student notebook could not be exported. Try again shortly.')
  const truncated: Record<string, number> = {}
  const data: AppData = {
    chapters: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [],
    tasks: [], goals: [], sessions: [], practiceSessions: [], pyqRecords: [], chapterStages: [],
    backlogItems: [], studyCards: [], testErrorLogs: [], testTimeEntries: [], examTracks: [],
    settings: (settings.settings ?? {
      owner_name: '', main_exam_date: '', advanced_exam_date: '', target_score: 240, theme: 'light',
      weak_threshold: 60, strong_threshold: 80, dropping_threshold: 10, revision_gaps: DEFAULT_GAPS,
      daily_study_goal_minutes: 360, sound_enabled: false
    }) as AppSettings,
    profile: profileRow.data ? {
      id: String(profileRow.data.id ?? profileRow.data.user_id),
      user_id: id,
      display_name: String(profileRow.data.display_name ?? ''),
      email: String(profileRow.data.email ?? ''),
      created_at: String(profileRow.data.created_at ?? new Date().toISOString()),
      updated_at: String(profileRow.data.updated_at ?? new Date().toISOString())
    } : null
  }
  EXPORT_TABLES.forEach((table, index) => {
    const result = tables[index] as { records: Record<string, unknown>[]; total: number; truncated: boolean }
    const key = TABLE_TO_BACKUP[table]
    if (key) (data[key] as unknown) = result.records
    if (result.truncated) truncated[table] = result.total
  })
  return {
    studentId: id,
    scopedToStudent: true,
    includesSecrets: false,
    truncated: Object.keys(truncated).length ? truncated : null,
    backup: stripSensitive({
      app: 'Stracker',
      version: 1,
      exported_at: new Date().toISOString(),
      settings: data.settings,
      profile: data.profile,
      chapters: data.chapters,
      revisions: data.revisions,
      tests: data.tests,
      testSubjectScores: data.testSubjectScores,
      testChapterLinks: data.testChapterLinks,
      mistakes: data.mistakes,
      tasks: data.tasks,
      goals: data.goals,
      sessions: data.sessions,
      practiceSessions: data.practiceSessions,
      pyqRecords: data.pyqRecords,
      chapterStages: data.chapterStages,
      backlogItems: data.backlogItems,
      studyCards: data.studyCards,
      testErrorLogs: data.testErrorLogs,
      testTimeEntries: data.testTimeEntries,
      examTracks: data.examTracks
    })
  }
}

export { loadOwned }
