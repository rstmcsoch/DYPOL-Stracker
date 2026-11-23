import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { ApiError } from '../http.js'
import { parsePage, parseSearch } from '../control-policy.js'
import { POSTGRES_INTEGER_MAX, chapterScoreInputSchema, subjectScoreInputSchema, testFormSchema } from '../../../src/lib/test-validation.js'
import { SUBJECTS } from '../../../src/types/index.js'
import { getAuthUser } from './auth-users.js'
import { requireStudentId } from './student-directory.js'

const dateValue = z.iso.date()
const chapterInputSchema = z.object({
  subject: z.enum(SUBJECTS),
  name: z.string().trim().min(1).max(140),
  position: z.number().finite().int().min(0).max(POSTGRES_INTEGER_MAX).optional(),
  status: z.enum(['Not Started', 'Studying', 'Done', 'Revised']).optional(),
  priority: z.enum(['High', 'Medium', 'Low']).optional(),
  importance: z.enum(['high', 'medium', 'low']).optional(),
  weightage: z.string().max(80).nullable().optional(),
  notes: z.string().max(20000).optional(),
  formula_notes: z.string().max(20000).optional(),
  completed_on: dateValue.nullable().optional()
}).strict()

const mistakeInputSchema = z.object({
  chapter_id: z.uuid(),
  test_id: z.uuid().nullable().optional(),
  mistake_type: z.enum(['Concept', 'Silly', 'Calculation', 'Time', 'Guess']),
  cause: z.enum(['Silly mistake', 'Concept gap', 'Calculation error', 'Time pressure', 'Misread question', 'Guess / bad attempt', 'Unattempted']).nullable().optional(),
  question_note: z.string().min(1).max(10000),
  solution_note: z.string().max(10000).optional(),
  image_path: z.string().max(500).nullable().optional(),
  retry_later: z.boolean().optional(),
  retry_status: z.enum(['pending', 'retried']).optional(),
  retry_due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
}).strict()

const testInputSchema = testFormSchema.extend({
  subject: z.enum(SUBJECTS).nullable().optional(),
  chapter_id: z.uuid().nullable().optional()
}).strict()

export async function assertStudent(admin: SupabaseClient, studentId: string): Promise<string> {
  const id = requireStudentId(studentId)
  await getAuthUser(admin, id)
  return id
}

export async function loadOwned(admin: SupabaseClient, table: string, id: string, studentId: string, notFound: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from(table).select('*').eq('id', id).maybeSingle()
  if (error) throw new ApiError(503, 'records_unavailable', `${notFound} could not be loaded. Try again shortly.`)
  if (!data) throw new ApiError(404, 'not_found', notFound)
  if (data.user_id !== studentId) throw new ApiError(403, 'record_mismatch', 'That record does not belong to the requested student. Nothing was changed.')
  return data as Record<string, unknown>
}

export async function assertOwnedChapter(admin: SupabaseClient, chapterId: string, studentId: string) {
  await loadOwned(admin, 'chapters', chapterId, studentId, 'That chapter was not found.')
}

export async function assertOwnedTest(admin: SupabaseClient, testId: string, studentId: string) {
  await loadOwned(admin, 'tests', testId, studentId, 'That test was not found.')
}

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, fallback: string): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new ApiError(400, 'invalid_request', parsed.error.issues[0]?.message ?? fallback)
  return parsed.data
}

export async function insertRow(admin: SupabaseClient, table: string, row: Record<string, unknown>, unavailable: string) {
  const { data, error } = await admin.from(table).insert(row).select('*').maybeSingle()
  if (error || !data) throw new ApiError(503, 'records_unavailable', unavailable)
  return data as Record<string, unknown>
}

export async function updateRow(admin: SupabaseClient, table: string, id: string, studentId: string, patch: Record<string, unknown>, unavailable: string) {
  const { data, error } = await admin.from(table).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', studentId).select('*').maybeSingle()
  if (error || !data) throw new ApiError(503, 'records_unavailable', unavailable)
  return data as Record<string, unknown>
}

export async function deleteOwned(admin: SupabaseClient, table: string, id: string, studentId: string, unavailable: string) {
  const { data, error } = await admin.from(table).delete().eq('id', id).eq('user_id', studentId).select('id').maybeSingle()
  if (error) throw new ApiError(503, 'records_unavailable', unavailable)
  if (!data) throw new ApiError(404, 'not_found', 'That record was not found for this student.')
}

export async function listOwned(admin: SupabaseClient, table: string, studentId: string, options: { q?: string; columns?: string; page?: unknown; pageSize?: unknown; order?: string; extra?: (query: { ilike: (c: string, v: string) => unknown; eq: (c: string, v: unknown) => unknown }) => void; searchColumn?: string; eq?: Record<string, unknown> }) {
  const { limit, offset, page } = parsePage(options.page, options.pageSize)
  let query = admin.from(table).select(options.columns ?? '*', { count: 'exact' }).eq('user_id', studentId).order(options.order ?? 'created_at', { ascending: false }).range(offset, offset + limit - 1)
  if (options.searchColumn && options.q) query = query.ilike(options.searchColumn, `%${options.q}%`)
  if (options.eq) {
    for (const [column, value] of Object.entries(options.eq)) {
      if (value !== undefined && value !== null && value !== '') query = query.eq(column, value)
    }
  }
  const { data, error, count } = await query
  if (error) throw new ApiError(503, 'records_unavailable', 'Study records could not be loaded. Try again shortly.')
  return { records: (data ?? []) as unknown as Record<string, unknown>[], total: count ?? 0, page, pageSize: limit }
}

export async function listAllOwned(admin: SupabaseClient, table: string, studentId: string, cap = 20_000) {
  const { data, error, count } = await admin.from(table).select('*', { count: 'exact' }).eq('user_id', studentId).range(0, cap - 1)
  if (error) throw new ApiError(503, 'records_unavailable', 'Study records could not be loaded. Try again shortly.')
  const records = (data ?? []) as unknown as Record<string, unknown>[]
  return { records, total: count ?? records.length, truncated: (count ?? 0) > records.length }
}

export async function relatedChapterCounts(admin: SupabaseClient, chapterId: string, studentId: string) {
  const tables = ['mistakes', 'chapter_revisions', 'test_chapter_links', 'study_cards', 'daily_tasks'] as const
  const counts: Record<string, number> = {}
  for (const table of tables) {
    const { count, error } = await admin.from(table).select('id', { count: 'exact', head: true }).eq('user_id', studentId).eq('chapter_id', chapterId)
    if (error) counts[table] = 0
    else counts[table] = count ?? 0
  }
  return counts
}

export async function relatedTestCounts(admin: SupabaseClient, testId: string, studentId: string) {
  const subject = await admin.from('test_subject_scores').select('id', { count: 'exact', head: true }).eq('user_id', studentId).eq('test_id', testId)
  const links = await admin.from('test_chapter_links').select('id', { count: 'exact', head: true }).eq('user_id', studentId).eq('test_id', testId)
  const mistakes = await admin.from('mistakes').select('id', { count: 'exact', head: true }).eq('user_id', studentId).eq('test_id', testId)
  if (subject.error || links.error || mistakes.error) throw new ApiError(503, 'records_unavailable', 'Related test records could not be counted.')
  return { test_subject_scores: subject.count ?? 0, test_chapter_links: links.count ?? 0, mistakes: mistakes.count ?? 0 }
}

export async function listChapters(admin: SupabaseClient, studentId: string, query: { q?: unknown; page?: unknown; pageSize?: unknown }) {
  const id = await assertStudent(admin, studentId)
  return listOwned(admin, 'chapters', id, { q: parseSearch(query.q), searchColumn: 'name', page: query.page, pageSize: query.pageSize, order: 'position' })
}

export async function createChapter(admin: SupabaseClient, studentId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const body = parseOrThrow(chapterInputSchema, input, 'Check the chapter details and try again.')
  return insertRow(admin, 'chapters', {
    id: randomUUID(),
    user_id: id,
    subject: body.subject,
    name: body.name,
    position: body.position ?? 0,
    status: body.status ?? 'Not Started',
    priority: body.priority ?? 'Medium',
    importance: body.importance ?? 'medium',
    weightage: body.weightage ?? null,
    notes: body.notes ?? '',
    formula_notes: body.formula_notes ?? '',
    completed_on: body.completed_on ?? null
  }, 'The chapter could not be saved.')
}

export async function updateChapter(admin: SupabaseClient, studentId: string, chapterId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'chapters', chapterId, id, 'That chapter was not found.')
  const body = parseOrThrow(chapterInputSchema.partial().refine(value => Object.keys(value).length > 0, 'Provide at least one chapter field to update.'), input, 'Check the chapter details and try again.')
  return updateRow(admin, 'chapters', chapterId, id, body, 'The chapter could not be updated.')
}

export async function reorderChapters(admin: SupabaseClient, studentId: string, items: Array<{ id: string; position: number }>) {
  const id = await assertStudent(admin, studentId)
  if (!items.length) throw new ApiError(400, 'invalid_request', 'Provide the chapter order.')
  const updated = []
  for (const item of items) {
    await loadOwned(admin, 'chapters', item.id, id, 'That chapter was not found.')
    if (!Number.isInteger(item.position) || item.position < 0 || item.position > POSTGRES_INTEGER_MAX) {
      throw new ApiError(400, 'invalid_request', 'Chapter positions must be whole numbers of 0 or more.')
    }
    updated.push(await updateRow(admin, 'chapters', item.id, id, { position: item.position }, 'The chapter order could not be saved.'))
  }
  return { ok: true, records: updated }
}

export async function deleteChapter(admin: SupabaseClient, studentId: string, chapterId: string) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'chapters', chapterId, id, 'That chapter was not found.')
  await deleteOwned(admin, 'chapters', chapterId, id, 'The chapter could not be deleted.')
  return { ok: true, studentId: id, chapterId }
}

export async function listTests(admin: SupabaseClient, studentId: string, query: { q?: unknown; page?: unknown; pageSize?: unknown }) {
  const id = await assertStudent(admin, studentId)
  return listOwned(admin, 'tests', id, { q: parseSearch(query.q), searchColumn: 'title', page: query.page, pageSize: query.pageSize })
}

export async function createTest(admin: SupabaseClient, studentId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const body = parseOrThrow(testInputSchema, input, 'Check the test details and try again.')
  if (body.chapter_id) await assertOwnedChapter(admin, body.chapter_id, id)
  return insertRow(admin, 'tests', {
    id: randomUUID(),
    user_id: id,
    title: body.title,
    test_date: body.test_date,
    test_type: body.test_type,
    subject: body.subject ?? null,
    chapter_id: body.chapter_id ?? null,
    marks_obtained: body.marks_obtained,
    total_marks: body.total_marks,
    correct: body.correct,
    wrong: body.wrong,
    skipped: body.skipped,
    total_questions: body.total_questions ?? null,
    negative_marks: body.negative_marks,
    time_minutes: body.time_minutes,
    percentile: body.percentile ?? null,
    notes: body.notes ?? ''
  }, 'The test could not be saved.')
}

export async function updateTest(admin: SupabaseClient, studentId: string, testId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const existing = await loadOwned(admin, 'tests', testId, id, 'That test was not found.')
  const merged = { ...existing, ...(input as Record<string, unknown>) }
  const body = parseOrThrow(testInputSchema, {
    title: merged.title,
    test_date: merged.test_date,
    test_type: merged.test_type,
    marks_obtained: merged.marks_obtained,
    total_marks: merged.total_marks,
    correct: merged.correct,
    wrong: merged.wrong,
    skipped: merged.skipped,
    total_questions: merged.total_questions,
    negative_marks: merged.negative_marks,
    time_minutes: merged.time_minutes,
    percentile: merged.percentile,
    notes: merged.notes ?? '',
    subject: merged.subject ?? null,
    chapter_id: merged.chapter_id ?? null
  }, 'Check the test details and try again.')
  if (body.chapter_id) await assertOwnedChapter(admin, body.chapter_id, id)
  return updateRow(admin, 'tests', testId, id, body, 'The test could not be updated.')
}

export async function deleteTest(admin: SupabaseClient, studentId: string, testId: string) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'tests', testId, id, 'That test was not found.')
  await deleteOwned(admin, 'tests', testId, id, 'The test could not be deleted.')
  return { ok: true, studentId: id, testId }
}

export async function listSubjectScores(admin: SupabaseClient, studentId: string, query: { testId?: string; page?: unknown; pageSize?: unknown }) {
  const id = await assertStudent(admin, studentId)
  if (query.testId) await assertOwnedTest(admin, query.testId, id)
  return listOwned(admin, 'test_subject_scores', id, { page: query.page, pageSize: query.pageSize, eq: query.testId ? { test_id: query.testId } : undefined })
}

export async function upsertSubjectScore(admin: SupabaseClient, studentId: string, input: { id?: string; test_id: string; subject: string; marks_obtained: number | null; total_marks: number | null }) {
  const id = await assertStudent(admin, studentId)
  await assertOwnedTest(admin, input.test_id, id)
  parseOrThrow(subjectScoreInputSchema, { marks_obtained: input.marks_obtained, total_marks: input.total_marks }, 'Check the subject score and try again.')
  if (!SUBJECTS.includes(input.subject as (typeof SUBJECTS)[number])) throw new ApiError(400, 'invalid_request', 'Subject must be Physics, Chemistry or Maths.')
  if (input.id) {
    await loadOwned(admin, 'test_subject_scores', input.id, id, 'That subject score was not found.')
    return updateRow(admin, 'test_subject_scores', input.id, id, { test_id: input.test_id, subject: input.subject, marks_obtained: input.marks_obtained, total_marks: input.total_marks }, 'The subject score could not be updated.')
  }
  return insertRow(admin, 'test_subject_scores', {
    id: randomUUID(),
    user_id: id,
    test_id: input.test_id,
    subject: input.subject,
    marks_obtained: input.marks_obtained,
    total_marks: input.total_marks
  }, 'The subject score could not be saved.')
}

export async function deleteSubjectScore(admin: SupabaseClient, studentId: string, scoreId: string) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'test_subject_scores', scoreId, id, 'That subject score was not found.')
  await deleteOwned(admin, 'test_subject_scores', scoreId, id, 'The subject score could not be deleted.')
  return { ok: true, studentId: id, id: scoreId }
}

export async function listTestChapterLinks(admin: SupabaseClient, studentId: string, query: { testId?: string; page?: unknown; pageSize?: unknown }) {
  const id = await assertStudent(admin, studentId)
  if (query.testId) await assertOwnedTest(admin, query.testId, id)
  return listOwned(admin, 'test_chapter_links', id, { page: query.page, pageSize: query.pageSize, eq: query.testId ? { test_id: query.testId } : undefined })
}

export async function upsertTestChapterLink(admin: SupabaseClient, studentId: string, input: { id?: string; test_id: string; chapter_id: string; marks_obtained: number | null; total_marks: number | null }) {
  const id = await assertStudent(admin, studentId)
  await assertOwnedTest(admin, input.test_id, id)
  await assertOwnedChapter(admin, input.chapter_id, id)
  parseOrThrow(chapterScoreInputSchema, { marks_obtained: input.marks_obtained, total_marks: input.total_marks }, 'Check the chapter-linked score and try again.')
  if (input.id) {
    await loadOwned(admin, 'test_chapter_links', input.id, id, 'That chapter link was not found.')
    return updateRow(admin, 'test_chapter_links', input.id, id, { test_id: input.test_id, chapter_id: input.chapter_id, marks_obtained: input.marks_obtained, total_marks: input.total_marks }, 'The chapter link could not be updated.')
  }
  return insertRow(admin, 'test_chapter_links', {
    id: randomUUID(),
    user_id: id,
    test_id: input.test_id,
    chapter_id: input.chapter_id,
    marks_obtained: input.marks_obtained,
    total_marks: input.total_marks
  }, 'The chapter link could not be saved.')
}

export async function deleteTestChapterLink(admin: SupabaseClient, studentId: string, linkId: string) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'test_chapter_links', linkId, id, 'That chapter link was not found.')
  await deleteOwned(admin, 'test_chapter_links', linkId, id, 'The chapter link could not be deleted.')
  return { ok: true, studentId: id, id: linkId }
}

export async function listMistakes(admin: SupabaseClient, studentId: string, query: { chapterId?: string; page?: unknown; pageSize?: unknown }) {
  const id = await assertStudent(admin, studentId)
  if (query.chapterId) await assertOwnedChapter(admin, query.chapterId, id)
  return listOwned(admin, 'mistakes', id, { page: query.page, pageSize: query.pageSize, eq: query.chapterId ? { chapter_id: query.chapterId } : undefined })
}

export async function createMistake(admin: SupabaseClient, studentId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  const body = parseOrThrow(mistakeInputSchema, input, 'Check the mistake details and try again.')
  await assertOwnedChapter(admin, body.chapter_id, id)
  if (body.test_id) await assertOwnedTest(admin, body.test_id, id)
  return insertRow(admin, 'mistakes', {
    id: randomUUID(),
    user_id: id,
    chapter_id: body.chapter_id,
    test_id: body.test_id ?? null,
    mistake_type: body.mistake_type,
    cause: body.cause ?? null,
    question_note: body.question_note,
    solution_note: body.solution_note ?? '',
    image_path: body.image_path ?? null,
    retry_later: body.retry_later ?? false,
    retry_status: body.retry_status ?? 'pending',
    retry_due_on: body.retry_due_on ?? null
  }, 'The mistake could not be saved.')
}

export async function updateMistake(admin: SupabaseClient, studentId: string, mistakeId: string, input: unknown) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'mistakes', mistakeId, id, 'That mistake was not found.')
  const body = parseOrThrow(mistakeInputSchema.partial().refine(value => Object.keys(value).length > 0, 'Provide at least one mistake field to update.'), input, 'Check the mistake details and try again.')
  if (body.chapter_id) await assertOwnedChapter(admin, body.chapter_id, id)
  if (body.test_id) await assertOwnedTest(admin, body.test_id, id)
  return updateRow(admin, 'mistakes', mistakeId, id, body, 'The mistake could not be updated.')
}

export async function deleteMistake(admin: SupabaseClient, studentId: string, mistakeId: string) {
  const id = await assertStudent(admin, studentId)
  await loadOwned(admin, 'mistakes', mistakeId, id, 'That mistake was not found.')
  await deleteOwned(admin, 'mistakes', mistakeId, id, 'The mistake could not be deleted.')
  return { ok: true, studentId: id, mistakeId }
}

