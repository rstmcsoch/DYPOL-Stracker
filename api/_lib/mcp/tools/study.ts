import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MasterActor } from '../types.js'
import type { ConfirmationStore } from '../confirmations.js'
import { previewOrConfirm, withoutConfirmationToken } from '../confirmation-flow.js'
import { loadOwned } from '../../services/student-records.js'
import { ApiError } from '../../http.js'
import * as study from '../../services/student-study.js'

const studentId = z.uuid()
const confirmationToken = z.string().min(1).optional()
const pageFields = {
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional()
}
const record = z.record(z.string(), z.unknown())

function jsonSchema(properties: Record<string, unknown>, required: string[]) {
  return { type: 'object', properties, required, additionalProperties: false } as const
}

async function confirmDelete(
  confirmations: ConfirmationStore | undefined,
  actor: MasterActor,
  toolName: string,
  args: Record<string, unknown>,
  target: { type: string; id: string; studentId: string },
  effects: string[],
  existing?: unknown
) {
  return previewOrConfirm(
    confirmations, actor, toolName, withoutConfirmationToken(args), target, args.confirmationToken,
    async () => ({
      operation: `${toolName}:${String(args.action ?? 'delete')}`,
      targetType: target.type,
      targetId: target.id,
      targetStudentId: target.studentId,
      existing, proposed: { deleted: true },
      effects, irreversible: true,
      validation: 'A confirmed delete removes this record for the named student only.'
    })
  )
}

const revisionInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), studentId, chapterId: z.uuid().optional(), ...pageFields }).strict(),
  z.object({ action: z.literal('get'), studentId, id: z.uuid() }).strict(),
  z.object({ action: z.literal('create'), studentId, record }).strict(),
  z.object({ action: z.literal('update'), studentId, id: z.uuid(), record }).strict(),
  z.object({ action: z.literal('complete'), studentId, id: z.uuid(), confirmationToken }).strict(),
  z.object({ action: z.literal('snooze'), studentId, id: z.uuid(), days: z.number().int().min(1).max(365).optional() }).strict(),
  z.object({ action: z.literal('delete'), studentId, id: z.uuid(), confirmationToken }).strict()
])

const taskInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), studentId, q: z.string().max(120).optional(), ...pageFields }).strict(),
  z.object({ action: z.literal('search'), studentId, q: z.string().min(1).max(120), ...pageFields }).strict(),
  z.object({ action: z.literal('get'), studentId, id: z.uuid() }).strict(),
  z.object({ action: z.literal('create'), studentId, record }).strict(),
  z.object({ action: z.literal('update'), studentId, id: z.uuid(), record }).strict(),
  z.object({ action: z.literal('reorder'), studentId, items: z.array(z.object({ id: z.uuid(), position: z.number().int().min(0) }).strict()).min(1) }).strict(),
  z.object({ action: z.literal('complete'), studentId, id: z.uuid() }).strict(),
  z.object({ action: z.literal('delete'), studentId, id: z.uuid(), confirmationToken }).strict()
])

const goalInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), studentId, ...pageFields }).strict(),
  z.object({ action: z.literal('get'), studentId, id: z.uuid() }).strict(),
  z.object({ action: z.literal('create'), studentId, record }).strict(),
  z.object({ action: z.literal('update'), studentId, id: z.uuid(), record }).strict(),
  z.object({ action: z.literal('complete'), studentId, id: z.uuid() }).strict(),
  z.object({ action: z.literal('delete'), studentId, id: z.uuid(), confirmationToken }).strict()
])

const sessionInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), studentId, ...pageFields }).strict(),
  z.object({ action: z.literal('get'), studentId, id: z.uuid() }).strict(),
  z.object({ action: z.literal('create'), studentId, record }).strict(),
  z.object({ action: z.literal('update'), studentId, id: z.uuid(), record }).strict(),
  z.object({ action: z.literal('delete'), studentId, id: z.uuid(), confirmationToken }).strict()
])

const practiceInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), studentId, chapterId: z.uuid().optional(), ...pageFields }).strict(),
  z.object({ action: z.literal('get'), studentId, id: z.uuid() }).strict(),
  z.object({ action: z.literal('create'), studentId, record }).strict(),
  z.object({ action: z.literal('update'), studentId, id: z.uuid(), record }).strict(),
  z.object({ action: z.literal('delete'), studentId, id: z.uuid(), confirmationToken }).strict()
])

const pyqInput = practiceInput

const stageInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), studentId }).strict(),
  z.object({ action: z.literal('update'), studentId, chapterId: z.uuid(), stage: z.enum(['theory', 'notes', 'pyqs', 'revised', 'tested']), done: z.boolean() }).strict(),
  z.object({ action: z.literal('delete'), studentId, id: z.uuid(), confirmationToken }).strict()
])

const backlogInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), studentId, q: z.string().max(120).optional(), ...pageFields }).strict(),
  z.object({ action: z.literal('get'), studentId, id: z.uuid() }).strict(),
  z.object({ action: z.literal('create'), studentId, record }).strict(),
  z.object({ action: z.literal('update'), studentId, id: z.uuid(), record }).strict(),
  z.object({ action: z.literal('snooze'), studentId, id: z.uuid(), until: z.iso.date().optional() }).strict(),
  z.object({ action: z.literal('complete'), studentId, id: z.uuid() }).strict(),
  z.object({ action: z.literal('delete'), studentId, id: z.uuid(), confirmationToken }).strict()
])

const cardInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), studentId, chapterId: z.uuid().optional(), ...pageFields }).strict(),
  z.object({ action: z.literal('get'), studentId, id: z.uuid() }).strict(),
  z.object({ action: z.literal('create'), studentId, record }).strict(),
  z.object({ action: z.literal('update'), studentId, id: z.uuid(), record }).strict(),
  z.object({ action: z.literal('reorder'), studentId, items: z.array(z.object({ id: z.uuid(), position: z.number().int().min(0) }).strict()).min(1) }).strict(),
  z.object({ action: z.literal('delete'), studentId, id: z.uuid(), confirmationToken }).strict()
])

const mockInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), studentId, kind: z.enum(['error_log', 'time_entry']), testId: z.uuid().optional(), ...pageFields }).strict(),
  z.object({ action: z.literal('get'), studentId, kind: z.enum(['error_log', 'time_entry']), id: z.uuid() }).strict(),
  z.object({ action: z.literal('create'), studentId, kind: z.enum(['error_log', 'time_entry']), record }).strict(),
  z.object({ action: z.literal('update'), studentId, kind: z.enum(['error_log', 'time_entry']), id: z.uuid(), record }).strict(),
  z.object({ action: z.literal('delete'), studentId, kind: z.enum(['error_log', 'time_entry']), id: z.uuid(), confirmationToken }).strict()
])

const trackInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), studentId, ...pageFields }).strict(),
  z.object({ action: z.literal('get'), studentId, id: z.uuid() }).strict(),
  z.object({ action: z.literal('create'), studentId, record }).strict(),
  z.object({ action: z.literal('update'), studentId, id: z.uuid(), record }).strict(),
  z.object({ action: z.literal('delete'), studentId, id: z.uuid(), confirmationToken }).strict()
])

const exportInput = z.object({ studentId }).strict()

function tool(name: string, description: string, schema: Record<string, unknown>, parse: (args: unknown) => Record<string, unknown>, execute: (actor: MasterActor, args: Record<string, unknown>) => Promise<unknown>) {
  return { name, description, inputSchema: { ...schema }, parse, execute }
}

export function studyTools(admin: SupabaseClient, confirmations?: ConfirmationStore) {
  return [
    tool('manage_student_revisions', 'List, create, update, snooze, complete or delete a student\'s scheduled revisions. Completing a revision uses the same scheduling logic as the student app (next due date from revision gaps; a Done chapter becomes Revised). Completes and deletes require confirmation.', jsonSchema({ action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'complete', 'snooze', 'delete'] }, studentId: { type: 'string', format: 'uuid' }, id: { type: 'string', format: 'uuid' }, chapterId: { type: 'string', format: 'uuid' }, days: { type: 'integer' }, record: { type: 'object' }, confirmationToken: { type: 'string' } }, ['action', 'studentId']), args => revisionInput.parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const sid = String(args.studentId)
      if (args.action === 'list') return study.listRevisions(admin, sid, { chapterId: typeof args.chapterId === 'string' ? args.chapterId : undefined, page: args.page, pageSize: args.pageSize })
      if (args.action === 'get') return loadOwned(admin, 'chapter_revisions', String(args.id), sid, 'That revision was not found.')
      if (args.action === 'create') return study.createRevision(admin, sid, args.record)
      if (args.action === 'update') return study.updateRevision(admin, sid, String(args.id), args.record)
      if (args.action === 'snooze') return study.snoozeRevision(admin, sid, String(args.id), typeof args.days === 'number' ? args.days : 1)
      const existing = await loadOwned(admin, 'chapter_revisions', String(args.id), sid, 'That revision was not found.')
      if (args.action === 'complete') {
        if (existing.completed_at) throw new ApiError(409, 'already_complete', 'That revision is already complete. Choose an open revision instead.')
        const preview = await previewOrConfirm(confirmations, actor, 'manage_student_revisions', withoutConfirmationToken(args), { type: 'revision', id: String(args.id), studentId: sid }, args.confirmationToken, async () => ({
          operation: 'complete_revision', targetType: 'revision', targetId: String(args.id), targetStudentId: sid,
          existing: { dueOn: existing.due_on, revisionNumber: existing.revision_number, completed: Boolean(existing.completed_at) },
          proposed: { completed: true },
          effects: ['The revision is marked complete.', 'The next revision in the gap schedule is created if one is not already present.', 'If the chapter is Done, its status becomes Revised.'],
          irreversible: false,
          validation: 'Uses the shared completeRevision scheduling logic. It does not invent tests or PYQ evidence.'
        }))
        if (preview) return preview
        return study.completeStudentRevision(admin, sid, String(args.id))
      }
      const preview = await confirmDelete(confirmations, actor, 'manage_student_revisions', args, { type: 'revision', id: String(args.id), studentId: sid }, ['This scheduled revision is deleted. Other revisions for the chapter are kept.'], { dueOn: existing.due_on })
      if (preview) return preview
      return study.deleteRevision(admin, sid, String(args.id))
    }),
    tool('manage_student_tasks', 'List, search, create, update, reorder, complete or delete a student\'s daily tasks. Daily tasks have no snooze column; reschedule by updating task_date. Deletes require confirmation. Records must belong to the named student.', jsonSchema({ action: { type: 'string', enum: ['list', 'search', 'get', 'create', 'update', 'reorder', 'complete', 'delete'] }, studentId: { type: 'string', format: 'uuid' }, id: { type: 'string', format: 'uuid' }, q: { type: 'string' }, record: { type: 'object' }, items: { type: 'array' }, confirmationToken: { type: 'string' } }, ['action', 'studentId']), args => taskInput.parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const sid = String(args.studentId)
      if (args.action === 'list' || args.action === 'search') return study.listTasks(admin, sid, args)
      if (args.action === 'get') return loadOwned(admin, 'daily_tasks', String(args.id), sid, 'That task was not found.')
      if (args.action === 'create') return study.createTask(admin, sid, args.record)
      if (args.action === 'update') return study.updateTask(admin, sid, String(args.id), args.record)
      if (args.action === 'reorder') return study.reorderTasks(admin, sid, args.items as Array<{ id: string; position: number }>)
      if (args.action === 'complete') return study.completeTask(admin, sid, String(args.id))
      const existing = await loadOwned(admin, 'daily_tasks', String(args.id), sid, 'That task was not found.')
      const preview = await confirmDelete(confirmations, actor, 'manage_student_tasks', args, { type: 'daily_task', id: String(args.id), studentId: sid }, ['This daily task is deleted.'], { title: existing.title })
      if (preview) return preview
      return study.deleteTask(admin, sid, String(args.id))
    }),
    tool('manage_student_weekly_goals', 'List, create, update, complete or delete a student\'s weekly goals using the shared goal schema (including the 168-hour study-hours cap). week_start is normalized to Monday. Deletes require confirmation.', jsonSchema({ action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'complete', 'delete'] }, studentId: { type: 'string', format: 'uuid' }, id: { type: 'string', format: 'uuid' }, record: { type: 'object' }, confirmationToken: { type: 'string' } }, ['action', 'studentId']), args => goalInput.parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const sid = String(args.studentId)
      if (args.action === 'list') return study.listGoals(admin, sid, args)
      if (args.action === 'get') return loadOwned(admin, 'weekly_goals', String(args.id), sid, 'That weekly goal was not found.')
      if (args.action === 'create') return study.createGoal(admin, sid, args.record)
      if (args.action === 'update') return study.updateGoal(admin, sid, String(args.id), args.record)
      if (args.action === 'complete') return study.completeGoal(admin, sid, String(args.id))
      const existing = await loadOwned(admin, 'weekly_goals', String(args.id), sid, 'That weekly goal was not found.')
      const preview = await confirmDelete(confirmations, actor, 'manage_student_weekly_goals', args, { type: 'weekly_goal', id: String(args.id), studentId: sid }, ['This weekly goal is deleted.'], { title: existing.title })
      if (preview) return preview
      return study.deleteGoal(admin, sid, String(args.id))
    }),
    tool('manage_student_study_sessions', 'List, create, update or delete historical study sessions. Master MCP cannot start, edit or delete an active browser timer (a session with no end time). Deletes require confirmation.', jsonSchema({ action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'delete'] }, studentId: { type: 'string', format: 'uuid' }, id: { type: 'string', format: 'uuid' }, record: { type: 'object' }, confirmationToken: { type: 'string' } }, ['action', 'studentId']), args => sessionInput.parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const sid = String(args.studentId)
      if (args.action === 'list') return study.listSessions(admin, sid, args)
      if (args.action === 'get') return loadOwned(admin, 'study_sessions', String(args.id), sid, 'That study session was not found.')
      if (args.action === 'create') return study.createSession(admin, sid, args.record)
      if (args.action === 'update') return study.updateSession(admin, sid, String(args.id), args.record)
      const existing = await loadOwned(admin, 'study_sessions', String(args.id), sid, 'That study session was not found.')
      const preview = await confirmDelete(confirmations, actor, 'manage_student_study_sessions', args, { type: 'study_session', id: String(args.id), studentId: sid }, ['This historical study session is deleted. An active timer cannot be deleted.'], { startedAt: existing.started_at })
      if (preview) return preview
      return study.deleteSession(admin, sid, String(args.id))
    }),
    tool('manage_student_practice_records', 'List, create, update or delete practice blocks. Correct plus incorrect cannot exceed attempted. The chapter must belong to the named student. Deletes require confirmation.', jsonSchema({ action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'delete'] }, studentId: { type: 'string', format: 'uuid' }, id: { type: 'string', format: 'uuid' }, chapterId: { type: 'string', format: 'uuid' }, record: { type: 'object' }, confirmationToken: { type: 'string' } }, ['action', 'studentId']), args => practiceInput.parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const sid = String(args.studentId)
      if (args.action === 'list') return study.listPractice(admin, sid, { chapterId: typeof args.chapterId === 'string' ? args.chapterId : undefined, page: args.page, pageSize: args.pageSize })
      if (args.action === 'get') return loadOwned(admin, 'practice_sessions', String(args.id), sid, 'That practice record was not found.')
      if (args.action === 'create') return study.createPractice(admin, sid, args.record)
      if (args.action === 'update') return study.updatePractice(admin, sid, String(args.id), args.record)
      const existing = await loadOwned(admin, 'practice_sessions', String(args.id), sid, 'That practice record was not found.')
      const preview = await confirmDelete(confirmations, actor, 'manage_student_practice_records', args, { type: 'practice_session', id: String(args.id), studentId: sid }, ['This practice record is deleted. It is never counted as a formal test.'], { chapterId: existing.chapter_id })
      if (preview) return preview
      return study.deletePractice(admin, sid, String(args.id))
    }),
    tool('manage_student_pyq_records', 'List, create, update or delete PYQ year records. One row per chapter, exam and year. Questions done cannot exceed the total. Deletes require confirmation.', jsonSchema({ action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'delete'] }, studentId: { type: 'string', format: 'uuid' }, id: { type: 'string', format: 'uuid' }, chapterId: { type: 'string', format: 'uuid' }, record: { type: 'object' }, confirmationToken: { type: 'string' } }, ['action', 'studentId']), args => pyqInput.parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const sid = String(args.studentId)
      if (args.action === 'list') return study.listPyq(admin, sid, { chapterId: typeof args.chapterId === 'string' ? args.chapterId : undefined, page: args.page, pageSize: args.pageSize })
      if (args.action === 'get') return loadOwned(admin, 'pyq_records', String(args.id), sid, 'That PYQ record was not found.')
      if (args.action === 'create') return study.createPyq(admin, sid, args.record)
      if (args.action === 'update') return study.updatePyq(admin, sid, String(args.id), args.record)
      const existing = await loadOwned(admin, 'pyq_records', String(args.id), sid, 'That PYQ record was not found.')
      const preview = await confirmDelete(confirmations, actor, 'manage_student_pyq_records', args, { type: 'pyq_record', id: String(args.id), studentId: sid }, ['This PYQ year record is deleted.'], { exam: existing.exam, year: existing.year })
      if (preview) return preview
      return study.deletePyq(admin, sid, String(args.id))
    }),
    tool('manage_student_chapter_stages', 'Read derived chapter-stage progress (manual claims plus real evidence) or toggle a student\'s own claim. This tool never creates tests, revisions or PYQ rows to fabricate evidence. Deleting a claim row requires confirmation.', jsonSchema({ action: { type: 'string', enum: ['list', 'update', 'delete'] }, studentId: { type: 'string', format: 'uuid' }, id: { type: 'string', format: 'uuid' }, chapterId: { type: 'string', format: 'uuid' }, stage: { type: 'string' }, done: { type: 'boolean' }, confirmationToken: { type: 'string' } }, ['action', 'studentId']), args => stageInput.parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const sid = String(args.studentId)
      if (args.action === 'list') return study.listChapterStages(admin, sid)
      if (args.action === 'update') return study.updateChapterStage(admin, sid, { chapterId: String(args.chapterId), stage: String(args.stage), done: args.done === true })
      const existing = await loadOwned(admin, 'chapter_stages', String(args.id), sid, 'That chapter stage claim was not found.')
      const preview = await confirmDelete(confirmations, actor, 'manage_student_chapter_stages', args, { type: 'chapter_stage', id: String(args.id), studentId: sid }, ['This stored stage claim is removed. Evidence such as tests or revisions is not deleted.'], { stage: existing.stage, done: existing.done })
      if (preview) return preview
      return study.deleteChapterStageClaim(admin, sid, String(args.id))
    }),
    tool('manage_student_backlog', 'List, create, update, snooze, complete or delete backlog items. Snooze is a first-class backlog status. The optional chapter must belong to the named student. Deletes require confirmation.', jsonSchema({ action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'snooze', 'complete', 'delete'] }, studentId: { type: 'string', format: 'uuid' }, id: { type: 'string', format: 'uuid' }, q: { type: 'string' }, until: { type: 'string', format: 'date' }, record: { type: 'object' }, confirmationToken: { type: 'string' } }, ['action', 'studentId']), args => backlogInput.parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const sid = String(args.studentId)
      if (args.action === 'list') return study.listBacklog(admin, sid, args)
      if (args.action === 'get') return loadOwned(admin, 'backlog_items', String(args.id), sid, 'That backlog item was not found.')
      if (args.action === 'create') return study.createBacklog(admin, sid, args.record)
      if (args.action === 'update') return study.updateBacklog(admin, sid, String(args.id), args.record)
      if (args.action === 'snooze') return study.snoozeBacklog(admin, sid, String(args.id), typeof args.until === 'string' ? args.until : undefined)
      if (args.action === 'complete') return study.completeBacklog(admin, sid, String(args.id))
      const existing = await loadOwned(admin, 'backlog_items', String(args.id), sid, 'That backlog item was not found.')
      const preview = await confirmDelete(confirmations, actor, 'manage_student_backlog', args, { type: 'backlog_item', id: String(args.id), studentId: sid }, ['This backlog item is deleted.'], { title: existing.title })
      if (preview) return preview
      return study.deleteBacklog(admin, sid, String(args.id))
    }),
    tool('manage_student_study_cards', 'List, create, update, reorder or delete formula and flash cards for one student. The chapter must belong to that student. Deletes require confirmation.', jsonSchema({ action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'reorder', 'delete'] }, studentId: { type: 'string', format: 'uuid' }, id: { type: 'string', format: 'uuid' }, chapterId: { type: 'string', format: 'uuid' }, record: { type: 'object' }, items: { type: 'array' }, confirmationToken: { type: 'string' } }, ['action', 'studentId']), args => cardInput.parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const sid = String(args.studentId)
      if (args.action === 'list') return study.listCards(admin, sid, { chapterId: typeof args.chapterId === 'string' ? args.chapterId : undefined, page: args.page, pageSize: args.pageSize })
      if (args.action === 'get') return loadOwned(admin, 'study_cards', String(args.id), sid, 'That study card was not found.')
      if (args.action === 'create') return study.createCard(admin, sid, args.record)
      if (args.action === 'update') return study.updateCard(admin, sid, String(args.id), args.record)
      if (args.action === 'reorder') return study.reorderCards(admin, sid, args.items as Array<{ id: string; position: number }>)
      const existing = await loadOwned(admin, 'study_cards', String(args.id), sid, 'That study card was not found.')
      const preview = await confirmDelete(confirmations, actor, 'manage_student_study_cards', args, { type: 'study_card', id: String(args.id), studentId: sid }, ['This study card is deleted.'], { kind: existing.kind })
      if (preview) return preview
      return study.deleteCard(admin, sid, String(args.id))
    }),
    tool('manage_student_mock_analysis', 'Manage error logs and time entries that belong to a student\'s tests. The parent test (and optional chapter) must belong to the named student. Deletes require confirmation.', jsonSchema({ action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'delete'] }, studentId: { type: 'string', format: 'uuid' }, kind: { type: 'string', enum: ['error_log', 'time_entry'] }, id: { type: 'string', format: 'uuid' }, testId: { type: 'string', format: 'uuid' }, record: { type: 'object' }, confirmationToken: { type: 'string' } }, ['action', 'studentId']), args => mockInput.parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const sid = String(args.studentId)
      const kind = args.kind as 'error_log' | 'time_entry'
      const table = kind === 'time_entry' ? 'test_time_entries' : 'test_error_logs'
      const missing = kind === 'time_entry' ? 'That time entry was not found.' : 'That error log was not found.'
      if (args.action === 'list') return study.listMockAnalysis(admin, sid, { kind, testId: typeof args.testId === 'string' ? args.testId : undefined, page: args.page, pageSize: args.pageSize })
      if (args.action === 'get') return loadOwned(admin, table, String(args.id), sid, missing)
      if (args.action === 'create') return study.upsertMockAnalysis(admin, sid, kind, args.record)
      if (args.action === 'update') return study.upsertMockAnalysis(admin, sid, kind, args.record, String(args.id))
      const existing = await loadOwned(admin, table, String(args.id), sid, missing)
      const preview = await confirmDelete(confirmations, actor, 'manage_student_mock_analysis', args, { type: kind, id: String(args.id), studentId: sid }, ['This mock-analysis row is deleted. The parent test is kept.'], { testId: existing.test_id })
      if (preview) return preview
      return study.deleteMockAnalysis(admin, sid, kind, String(args.id))
    }),
    tool('manage_student_exam_tracks', 'List, create, update or delete a student\'s exam tracks (main1, main2, advanced, boards). One row per track. Deletes require confirmation.', jsonSchema({ action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'delete'] }, studentId: { type: 'string', format: 'uuid' }, id: { type: 'string', format: 'uuid' }, record: { type: 'object' }, confirmationToken: { type: 'string' } }, ['action', 'studentId']), args => trackInput.parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const sid = String(args.studentId)
      if (args.action === 'list') return study.listTracks(admin, sid, args)
      if (args.action === 'get') return loadOwned(admin, 'user_exam_tracks', String(args.id), sid, 'That exam track was not found.')
      if (args.action === 'create') return study.createTrack(admin, sid, args.record)
      if (args.action === 'update') return study.updateTrack(admin, sid, String(args.id), args.record)
      const existing = await loadOwned(admin, 'user_exam_tracks', String(args.id), sid, 'That exam track was not found.')
      const preview = await confirmDelete(confirmations, actor, 'manage_student_exam_tracks', args, { type: 'exam_track', id: String(args.id), studentId: sid }, ['This exam track is deleted.'], { track: existing.track })
      if (preview) return preview
      return study.deleteTrack(admin, sid, String(args.id))
    }),
    tool('export_student_notebook', 'Export one student\'s notebook in the standard Stracker backup shape. The export is scoped to that student and never includes passwords, tokens, AI keys or other secrets.', jsonSchema({ studentId: { type: 'string', format: 'uuid' } }, ['studentId']), args => exportInput.parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => study.exportStudentNotebook(admin, String(args.studentId)))
  ]
}
