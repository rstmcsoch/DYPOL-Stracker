import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MasterActor } from '../types.js'
import type { ConfirmationStore } from '../confirmations.js'
import { previewOrConfirm, withoutConfirmationToken } from '../confirmation-flow.js'
import {
  createChapter,
  createMistake,
  createTest,
  deleteChapter,
  deleteMistake,
  deleteSubjectScore,
  deleteTest,
  deleteTestChapterLink,
  listChapters,
  listMistakes,
  listSubjectScores,
  listTestChapterLinks,
  listTests,
  assertStudent,
  loadOwned,
  relatedChapterCounts,
  relatedTestCounts,
  reorderChapters,
  updateChapter,
  updateMistake,
  updateTest,
  upsertSubjectScore,
  upsertTestChapterLink
} from '../../services/student-records.js'

const studentId = z.uuid()
const confirmationToken = z.string().min(1).optional()
const pageFields = {
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional()
}

function jsonSchema(properties: Record<string, unknown>, required: string[]) {
  return { type: 'object', properties, required, additionalProperties: false } as const
}

export const manageStudentChaptersInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), studentId, q: z.string().max(120).optional(), ...pageFields }).strict(),
  z.object({ action: z.literal('search'), studentId, q: z.string().min(1).max(120), ...pageFields }).strict(),
  z.object({ action: z.literal('get'), studentId, id: z.uuid() }).strict(),
  z.object({ action: z.literal('create'), studentId, record: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ action: z.literal('update'), studentId, id: z.uuid(), record: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ action: z.literal('reorder'), studentId, items: z.array(z.object({ id: z.uuid(), position: z.number().int().min(0) }).strict()).min(1) }).strict(),
  z.object({ action: z.literal('delete'), studentId, id: z.uuid(), confirmationToken }).strict()
])
export const MANAGE_STUDENT_CHAPTERS_SCHEMA = jsonSchema({
  action: { type: 'string', enum: ['list', 'search', 'get', 'create', 'update', 'reorder', 'delete'] },
  studentId: { type: 'string', format: 'uuid' },
  id: { type: 'string', format: 'uuid' },
  q: { type: 'string', maxLength: 120 },
  page: { type: 'integer' },
  pageSize: { type: 'integer' },
  record: { type: 'object' },
  items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, position: { type: 'integer' } } } },
  confirmationToken: { type: 'string' }
}, ['action', 'studentId'])
export const MANAGE_STUDENT_CHAPTERS_DESCRIPTION = "List, search, create, update, reorder or delete one student's chapters. Deletes require a confirmation preview because linked mistakes, revisions and chapter links are affected. Records must belong to the named student."

export const manageStudentTestsInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), studentId, q: z.string().max(120).optional(), ...pageFields }).strict(),
  z.object({ action: z.literal('search'), studentId, q: z.string().min(1).max(120), ...pageFields }).strict(),
  z.object({ action: z.literal('get'), studentId, id: z.uuid() }).strict(),
  z.object({ action: z.literal('create'), studentId, record: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ action: z.literal('update'), studentId, id: z.uuid(), record: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ action: z.literal('delete'), studentId, id: z.uuid(), confirmationToken }).strict()
])
export const MANAGE_STUDENT_TESTS_SCHEMA = jsonSchema({
  action: { type: 'string', enum: ['list', 'search', 'get', 'create', 'update', 'delete'] },
  studentId: { type: 'string', format: 'uuid' },
  id: { type: 'string', format: 'uuid' },
  q: { type: 'string', maxLength: 120 },
  page: { type: 'integer' },
  pageSize: { type: 'integer' },
  record: { type: 'object' },
  confirmationToken: { type: 'string' }
}, ['action', 'studentId'])
export const MANAGE_STUDENT_TESTS_DESCRIPTION = "List, search, create, update or delete one student's tests using the shared test validation rules. Deletes require confirmation because subject scores and chapter links cascade, and linked mistakes lose their test_id. Records must belong to the named student."

export const manageStudentSubjectScoresInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), studentId, testId: z.uuid().optional(), ...pageFields }).strict(),
  z.object({ action: z.literal('get'), studentId, id: z.uuid() }).strict(),
  z.object({ action: z.literal('create'), studentId, testId: z.uuid(), subject: z.string(), marks_obtained: z.number().nullable(), total_marks: z.number().nullable() }).strict(),
  z.object({ action: z.literal('update'), studentId, id: z.uuid(), testId: z.uuid(), subject: z.string(), marks_obtained: z.number().nullable(), total_marks: z.number().nullable() }).strict(),
  z.object({ action: z.literal('delete'), studentId, id: z.uuid(), confirmationToken }).strict()
])
export const MANAGE_STUDENT_SUBJECT_SCORES_SCHEMA = jsonSchema({
  action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'delete'] },
  studentId: { type: 'string', format: 'uuid' },
  id: { type: 'string', format: 'uuid' },
  testId: { type: 'string', format: 'uuid' },
  subject: { type: 'string' },
  marks_obtained: { type: ['number', 'null'] },
  total_marks: { type: ['number', 'null'] },
  confirmationToken: { type: 'string' }
}, ['action', 'studentId'])
export const MANAGE_STUDENT_SUBJECT_SCORES_DESCRIPTION = "Manage subject scores that belong to a student's tests. The named test must belong to the same student. Numeric integrity follows the shared subject-score schema."

export const manageStudentTestChapterLinksInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), studentId, testId: z.uuid().optional(), ...pageFields }).strict(),
  z.object({ action: z.literal('get'), studentId, id: z.uuid() }).strict(),
  z.object({ action: z.literal('create'), studentId, testId: z.uuid(), chapterId: z.uuid(), marks_obtained: z.number().nullable(), total_marks: z.number().nullable() }).strict(),
  z.object({ action: z.literal('update'), studentId, id: z.uuid(), testId: z.uuid(), chapterId: z.uuid(), marks_obtained: z.number().nullable(), total_marks: z.number().nullable() }).strict(),
  z.object({ action: z.literal('delete'), studentId, id: z.uuid(), confirmationToken }).strict()
])
export const MANAGE_STUDENT_TEST_CHAPTER_LINKS_SCHEMA = jsonSchema({
  action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'delete'] },
  studentId: { type: 'string', format: 'uuid' },
  id: { type: 'string', format: 'uuid' },
  testId: { type: 'string', format: 'uuid' },
  chapterId: { type: 'string', format: 'uuid' },
  marks_obtained: { type: ['number', 'null'] },
  total_marks: { type: ['number', 'null'] },
  confirmationToken: { type: 'string' }
}, ['action', 'studentId'])
export const MANAGE_STUDENT_TEST_CHAPTER_LINKS_DESCRIPTION = "Manage chapter links on a student's tests. Both the test and the chapter must belong to the same student. Numeric integrity follows the shared chapter-score schema."

export const manageStudentMistakesInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), studentId, chapterId: z.uuid().optional(), ...pageFields }).strict(),
  z.object({ action: z.literal('search'), studentId, chapterId: z.uuid().optional(), ...pageFields }).strict(),
  z.object({ action: z.literal('get'), studentId, id: z.uuid() }).strict(),
  z.object({ action: z.literal('create'), studentId, record: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ action: z.literal('update'), studentId, id: z.uuid(), record: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ action: z.literal('delete'), studentId, id: z.uuid(), confirmationToken }).strict()
])
export const MANAGE_STUDENT_MISTAKES_SCHEMA = jsonSchema({
  action: { type: 'string', enum: ['list', 'search', 'get', 'create', 'update', 'delete'] },
  studentId: { type: 'string', format: 'uuid' },
  id: { type: 'string', format: 'uuid' },
  chapterId: { type: 'string', format: 'uuid' },
  record: { type: 'object' },
  confirmationToken: { type: 'string' }
}, ['action', 'studentId'])
export const MANAGE_STUDENT_MISTAKES_DESCRIPTION = "List, create, update or delete one student's mistakes. Deletes require a confirmation preview. The chapter and optional test must belong to the same student."

export function recordTools(admin: SupabaseClient, confirmations?: ConfirmationStore) {
  return [
    {
      name: 'manage_student_chapters',
      description: MANAGE_STUDENT_CHAPTERS_DESCRIPTION,
      inputSchema: { ...MANAGE_STUDENT_CHAPTERS_SCHEMA },
      parse: (args: unknown) => manageStudentChaptersInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (actor: MasterActor, args: Record<string, unknown>) => {
        const sid = String(args.studentId)
        if (args.action === 'list' || args.action === 'search') return listChapters(admin, sid, args)
        if (args.action === 'get') {
          await assertStudent(admin, sid)
          return loadOwned(admin, 'chapters', String(args.id), sid, 'That chapter was not found.')
        }
        if (args.action === 'create') return createChapter(admin, sid, args.record)
        if (args.action === 'update') return updateChapter(admin, sid, String(args.id), args.record)
        if (args.action === 'reorder') return reorderChapters(admin, sid, args.items as Array<{ id: string; position: number }>)
        const existing = await loadOwned(admin, 'chapters', String(args.id), sid, 'That chapter was not found.')
        const related = await relatedChapterCounts(admin, String(args.id), sid)
        const preview = await previewOrConfirm(confirmations, actor, 'manage_student_chapters', withoutConfirmationToken(args), { type: 'chapter', id: String(args.id), studentId: sid }, args.confirmationToken, async () => ({
          operation: 'delete_chapter',
          targetType: 'chapter',
          targetId: String(args.id),
          targetStudentId: sid,
          existing: { name: existing.name, subject: existing.subject },
          proposed: { deleted: true },
          effects: ['The chapter is deleted.', 'Linked mistakes, revisions and chapter links are removed.', 'Tests that pointed at this chapter keep their row and lose the chapter_id.'],
          relatedRecords: related,
          irreversible: true,
          validation: 'A confirmed delete removes this chapter for the named student only.'
        }))
        if (preview) return preview
        return deleteChapter(admin, sid, String(args.id))
      }
    },
    {
      name: 'manage_student_tests',
      description: MANAGE_STUDENT_TESTS_DESCRIPTION,
      inputSchema: { ...MANAGE_STUDENT_TESTS_SCHEMA },
      parse: (args: unknown) => manageStudentTestsInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (actor: MasterActor, args: Record<string, unknown>) => {
        const sid = String(args.studentId)
        if (args.action === 'list' || args.action === 'search') return listTests(admin, sid, args)
        if (args.action === 'get') {
          await assertStudent(admin, sid)
          return loadOwned(admin, 'tests', String(args.id), sid, 'That test was not found.')
        }
        if (args.action === 'create') return createTest(admin, sid, args.record)
        if (args.action === 'update') return updateTest(admin, sid, String(args.id), args.record)
        const existing = await loadOwned(admin, 'tests', String(args.id), sid, 'That test was not found.')
        const related = await relatedTestCounts(admin, String(args.id), sid)
        const preview = await previewOrConfirm(confirmations, actor, 'manage_student_tests', withoutConfirmationToken(args), { type: 'test', id: String(args.id), studentId: sid }, args.confirmationToken, async () => ({
          operation: 'delete_test',
          targetType: 'test',
          targetId: String(args.id),
          targetStudentId: sid,
          existing: { title: existing.title, testDate: existing.test_date, testType: existing.test_type },
          proposed: { deleted: true },
          effects: ['The test is deleted.', 'Subject scores and chapter links for this test are removed.', 'Mistakes keep their row and lose the test_id.'],
          relatedRecords: related,
          irreversible: true,
          validation: 'A confirmed delete removes this test for the named student only.'
        }))
        if (preview) return preview
        return deleteTest(admin, sid, String(args.id))
      }
    },
    {
      name: 'manage_student_subject_scores',
      description: MANAGE_STUDENT_SUBJECT_SCORES_DESCRIPTION,
      inputSchema: { ...MANAGE_STUDENT_SUBJECT_SCORES_SCHEMA },
      parse: (args: unknown) => manageStudentSubjectScoresInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (actor: MasterActor, args: Record<string, unknown>) => {
        const sid = String(args.studentId)
        if (args.action === 'list') return listSubjectScores(admin, sid, { testId: typeof args.testId === 'string' ? args.testId : undefined, page: args.page, pageSize: args.pageSize })
        if (args.action === 'get') {
          await assertStudent(admin, sid)
          return loadOwned(admin, 'test_subject_scores', String(args.id), sid, 'That subject score was not found.')
        }
        if (args.action === 'create' || args.action === 'update') {
          return upsertSubjectScore(admin, sid, {
            id: args.action === 'update' ? String(args.id) : undefined,
            test_id: String(args.testId),
            subject: String(args.subject),
            marks_obtained: (args.marks_obtained as number | null) ?? null,
            total_marks: (args.total_marks as number | null) ?? null
          })
        }
        const existing = await loadOwned(admin, 'test_subject_scores', String(args.id), sid, 'That subject score was not found.')
        const preview = await previewOrConfirm(confirmations, actor, 'manage_student_subject_scores', withoutConfirmationToken(args), { type: 'test_subject_score', id: String(args.id), studentId: sid }, args.confirmationToken, async () => ({
          operation: 'delete_subject_score',
          targetType: 'test_subject_score',
          targetId: String(args.id),
          targetStudentId: sid,
          existing: { testId: existing.test_id, subject: existing.subject },
          proposed: { deleted: true },
          effects: ['This subject score row is deleted. The parent test is kept.'],
          irreversible: true,
          validation: 'A confirmed delete removes this subject score for the named student only.'
        }))
        if (preview) return preview
        return deleteSubjectScore(admin, sid, String(args.id))
      }
    },
    {
      name: 'manage_student_test_chapter_links',
      description: MANAGE_STUDENT_TEST_CHAPTER_LINKS_DESCRIPTION,
      inputSchema: { ...MANAGE_STUDENT_TEST_CHAPTER_LINKS_SCHEMA },
      parse: (args: unknown) => manageStudentTestChapterLinksInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (actor: MasterActor, args: Record<string, unknown>) => {
        const sid = String(args.studentId)
        if (args.action === 'list') return listTestChapterLinks(admin, sid, { testId: typeof args.testId === 'string' ? args.testId : undefined, page: args.page, pageSize: args.pageSize })
        if (args.action === 'get') {
          await assertStudent(admin, sid)
          return loadOwned(admin, 'test_chapter_links', String(args.id), sid, 'That chapter link was not found.')
        }
        if (args.action === 'create' || args.action === 'update') {
          return upsertTestChapterLink(admin, sid, {
            id: args.action === 'update' ? String(args.id) : undefined,
            test_id: String(args.testId),
            chapter_id: String(args.chapterId),
            marks_obtained: (args.marks_obtained as number | null) ?? null,
            total_marks: (args.total_marks as number | null) ?? null
          })
        }
        const existing = await loadOwned(admin, 'test_chapter_links', String(args.id), sid, 'That chapter link was not found.')
        const preview = await previewOrConfirm(confirmations, actor, 'manage_student_test_chapter_links', withoutConfirmationToken(args), { type: 'test_chapter_link', id: String(args.id), studentId: sid }, args.confirmationToken, async () => ({
          operation: 'delete_test_chapter_link',
          targetType: 'test_chapter_link',
          targetId: String(args.id),
          targetStudentId: sid,
          existing: { testId: existing.test_id, chapterId: existing.chapter_id },
          proposed: { deleted: true },
          effects: ['This chapter link is deleted. The parent test and chapter are kept.'],
          irreversible: true,
          validation: 'A confirmed delete removes this chapter link for the named student only.'
        }))
        if (preview) return preview
        return deleteTestChapterLink(admin, sid, String(args.id))
      }
    },
    {
      name: 'manage_student_mistakes',
      description: MANAGE_STUDENT_MISTAKES_DESCRIPTION,
      inputSchema: { ...MANAGE_STUDENT_MISTAKES_SCHEMA },
      parse: (args: unknown) => manageStudentMistakesInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (actor: MasterActor, args: Record<string, unknown>) => {
        const sid = String(args.studentId)
        if (args.action === 'list' || args.action === 'search') return listMistakes(admin, sid, { chapterId: typeof args.chapterId === 'string' ? args.chapterId : undefined, page: args.page, pageSize: args.pageSize })
        if (args.action === 'get') {
          await assertStudent(admin, sid)
          return loadOwned(admin, 'mistakes', String(args.id), sid, 'That mistake was not found.')
        }
        if (args.action === 'create') return createMistake(admin, sid, args.record)
        if (args.action === 'update') return updateMistake(admin, sid, String(args.id), args.record)
        const existing = await loadOwned(admin, 'mistakes', String(args.id), sid, 'That mistake was not found.')
        const preview = await previewOrConfirm(confirmations, actor, 'manage_student_mistakes', withoutConfirmationToken(args), { type: 'mistake', id: String(args.id), studentId: sid }, args.confirmationToken, async () => ({
          operation: 'delete_mistake',
          targetType: 'mistake',
          targetId: String(args.id),
          targetStudentId: sid,
          existing: { chapterId: existing.chapter_id, mistakeType: existing.mistake_type },
          proposed: { deleted: true },
          effects: ['This mistake is deleted. The parent chapter is kept.'],
          irreversible: true,
          validation: 'A confirmed delete removes this mistake for the named student only.'
        }))
        if (preview) return preview
        return deleteMistake(admin, sid, String(args.id))
      }
    }
  ]
}
