import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MasterActor } from '../types.js'
import type { ConfirmationStore } from '../confirmations.js'
import { previewOrConfirm, withoutConfirmationToken } from '../confirmation-flow.js'
import * as exams from '../../services/exam-catalogue.js'
import { examInputSchema, examIdSchema, markingSchemeBody } from '../../services/exam-catalogue.js'

function jsonSchema(properties: Record<string, unknown>, required: string[]) {
  return { type: 'object', properties, required, additionalProperties: false } as const
}

function tool(name: string, description: string, schema: Record<string, unknown>, parse: (args: unknown) => Record<string, unknown>, execute: (actor: MasterActor, args: Record<string, unknown>) => Promise<unknown>) {
  return { name, description, inputSchema: { ...schema }, parse, execute }
}

const empty = z.object({}).strict()
const examIdArgs = z.object({ examId: examIdSchema, confirmationToken: z.string().min(1).optional() }).strict()
const createArgs = examInputSchema
const updateArgs = examInputSchema
const reorderArgs = z.object({ order: z.array(examIdSchema).min(1).max(500) }).strict()
const markingArgs = z.object({ examId: examIdSchema, markingScheme: markingSchemeBody.nullable() }).strict()
const preferencesArgs = z.object({ preferences: z.record(z.string(), z.array(z.string()).min(1).max(12)) }).strict()

export function examTools(admin: SupabaseClient, confirmations?: ConfirmationStore) {
  return [
    tool('list_exam_catalogue', 'List every exam in the catalogue, including hidden exams. Hide is a soft flag only; catalogue rows are never physically deleted.', jsonSchema({}, []), args => empty.parse(args ?? {}) as Record<string, unknown>, async () => exams.listExamCatalogue(admin)),
    tool('get_exam_definition', 'Return one exam definition and how many students currently have it as their selected exam. Hidden exams remain readable.', jsonSchema({ examId: { type: 'string' } }, ['examId']), args => z.object({ examId: examIdSchema }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => exams.getExamDefinition(admin, String(args.examId))),
    tool('create_exam', 'Add a new exam to the catalogue using the same validation as the Control Center exam editor. Fails if the id already exists. updated_by is left empty because Master MCP is not an Owner account.', jsonSchema({ id: { type: 'string' }, name: { type: 'string' }, category: { type: 'string' }, years: { type: 'array', items: { type: 'integer' } }, sessions: { type: 'array', items: { type: 'string' } }, boards: { type: 'array', items: { type: 'string' } }, boards_addon: { type: 'boolean' }, subjects: { type: 'array', items: { type: 'string' } }, marking_scheme: { type: 'object' }, session_label: { type: 'string' }, sort_order: { type: 'integer' }, hidden: { type: 'boolean' } }, ['id', 'name', 'category', 'years', 'sessions', 'boards', 'boards_addon']), args => createArgs.parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => exams.createExam(admin, args)),
    tool('update_exam', 'Replace an existing exam definition using the same validation as the Control Center exam editor. The id cannot be reused for a different exam. updated_by is left empty.', jsonSchema({ id: { type: 'string' }, name: { type: 'string' }, category: { type: 'string' }, years: { type: 'array', items: { type: 'integer' } }, sessions: { type: 'array', items: { type: 'string' } }, boards: { type: 'array', items: { type: 'string' } }, boards_addon: { type: 'boolean' }, subjects: { type: 'array', items: { type: 'string' } }, marking_scheme: { type: 'object' }, session_label: { type: 'string' }, sort_order: { type: 'integer' }, hidden: { type: 'boolean' } }, ['id', 'name', 'category', 'years', 'sessions', 'boards', 'boards_addon']), args => updateArgs.parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => exams.updateExam(admin, args)),
    tool('hide_exam', 'Hide an exam from new student pickers. Students already on the exam keep it. The catalogue row is not physically deleted. Requires confirmation.', jsonSchema({ examId: { type: 'string' }, confirmationToken: { type: 'string' } }, ['examId']), args => examIdArgs.parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const examId = String(args.examId)
      const current = await exams.getExamDefinition(admin, examId)
      const preview = await previewOrConfirm(confirmations, actor, 'hide_exam', withoutConfirmationToken(args), { type: 'exam', id: examId, version: current.exam.hidden ? 'hidden' : 'visible' }, args.confirmationToken, async () => ({
        operation: 'hide_exam',
        targetType: 'exam',
        targetId: examId,
        existing: { hidden: current.exam.hidden, name: current.exam.name },
        proposed: { hidden: true },
        effects: [
          'The exam is hidden from new student pickers.',
          'Students already on this exam keep it.',
          'The catalogue row is not physically deleted and can be restored later.'
        ],
        relatedRecords: { studentsUsingExam: current.inUseCount },
        irreversible: false,
        validation: 'Hide is a soft flag only. There is no Master MCP tool that permanently deletes an exam row.'
      }))
      if (preview) return preview
      return exams.hideExam(admin, examId, true)
    }),
    tool('restore_exam', 'Restore a hidden exam so it appears in new student pickers again. The catalogue row was never deleted.', jsonSchema({ examId: { type: 'string' } }, ['examId']), args => z.object({ examId: examIdSchema }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => exams.hideExam(admin, String(args.examId), false)),
    tool('reorder_exams', 'Rewrite exam sort_order from the given id list (first id is first). Unknown ids are rejected and no rows are deleted.', jsonSchema({ order: { type: 'array', items: { type: 'string' } } }, ['order']), args => reorderArgs.parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => exams.reorderExams(admin, args.order)),
    tool('update_exam_marking_scheme', 'Set or clear the marking defaults for one exam using the shared marking-scheme validator. Null clears the stored scheme so built-in defaults apply.', jsonSchema({ examId: { type: 'string' }, markingScheme: { type: ['object', 'null'] } }, ['examId', 'markingScheme']), args => markingArgs.parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => exams.updateExamMarkingScheme(admin, String(args.examId), args.markingScheme)),
    tool('update_exam_ai_model_preferences', 'Update the global AI model preference lists used when ranking models. Providers are limited to Gemini, OpenAI, Anthropic, DeepSeek and Qwen.', jsonSchema({ preferences: { type: 'object' } }, ['preferences']), args => preferencesArgs.parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => exams.updateExamAiModelPreferences(admin, args.preferences))
  ]
}
