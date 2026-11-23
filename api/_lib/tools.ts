import { z } from 'zod'
import { byMostRecentTest, getChapterPerformance, getOverallTestAverage, getOverallTestPercentage, getStudyStreak, getSubjectPerformance, getTodayStudyMinutes, getWeekStart } from '../../src/lib/analytics.js'
import { completeRevision } from '../../src/lib/revision-actions.js'
import { testFormSchema, subjectScoreInputSchema, POSTGRES_INTEGER_MAX } from '../../src/lib/test-validation.js'
import { validatePersistedRecords } from '../../src/lib/record-validation.js'
import { taskInputSchema } from '../../src/lib/task-validation.js'
import { goalSchema } from '../../src/lib/goal-validation.js'
import { settingsSchema } from '../../src/lib/settings-validation.js'
import { defaultSettings } from '../../src/lib/defaults.js'
import { indiaToday, plusDays } from '../../src/lib/date.js'
import { listBacklogForAI } from '../../src/lib/jee/backlog-ai.js'
import { createId } from '../../src/lib/id.js'
import { redactPotentialSecrets } from '../../src/lib/ai/sanitize.js'
import { SUBJECTS, type AppData, type AppSettings, type Chapter, type DailyTask, type Mistake, type Revision, type StudySession, type TestRecord, type TestSubjectScore, type TestChapterLink, type WeeklyGoal, type Subject, type BacklogItem } from '../../src/types/index.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ModelTool, NormalizedToolCall } from './provider-adapters.js'
import { ApiError } from './http.js'

// Any exam's subject (NEET Biology, CUET Economics, CA Accounting…), matching the widened DB check.
const subjectSchema = z.string().trim().min(1).max(60)

/**
 * Whether a Full Mock's subject scores form a complete aggregate. Mirrors the app and the DB:
 * Physics/Chemistry/Maths mocks need all three; other exams aggregate every saved subject, all complete.
 */
export function fullMockComplete(scores: ReadonlyArray<Record<string, unknown>>): boolean {
  if (!scores.length) return false
  const subjects = scores.map(score => String(score.subject))
  if (new Set(subjects).size !== subjects.length) return false
  if (!scores.every(score => score.marks_obtained != null && score.total_marks != null)) return false
  const legacy = subjects.every(subject => (SUBJECTS as readonly string[]).includes(subject))
  return !legacy || SUBJECTS.every(subject => subjects.includes(subject))
}
const idSchema = z.uuid()
const emptyInput = z.object({}).strict()
const toolSchemas = {
  get_dashboard_summary: emptyInput,
  get_test_history: z.object({ limit: z.number().int().min(1).max(20).default(10) }).strict(),
  get_test_details: z.object({ test_id: idSchema }).strict(),
  get_subject_performance: z.object({ subject: subjectSchema.optional() }).strict(),
  get_chapter_performance: z.object({ subject: subjectSchema.optional(), limit: z.number().int().min(1).max(30).default(15) }).strict(),
  get_weak_areas: z.object({ subject: subjectSchema.optional(), limit: z.number().int().min(1).max(20).default(10) }).strict(),
  get_revision_due: z.object({ days: z.number().int().min(0).max(90).default(14), limit: z.number().int().min(1).max(40).default(20) }).strict(),
  get_backlog: z.object({ include_snoozed: z.boolean().default(true) }).strict(),
  get_mistake_summary: z.object({ subject: subjectSchema.optional(), limit: z.number().int().min(1).max(50).default(20) }).strict(),
  get_daily_tasks: z.object({ date: z.iso.date().optional() }).strict(),
  get_study_time_summary: z.object({ days: z.number().int().min(1).max(90).default(7) }).strict(),
  get_settings: emptyInput,
  find_chapters: z.object({ query: z.string().trim().max(100).optional(), subject: subjectSchema.optional() }).strict(),
  create_test: z.object({
    title: z.string().trim().min(1).max(160), test_date: z.iso.date(),
    test_type: z.enum(['Chapter Test','Subject Test','Full Mock','PYQ Practice']),
    subject: subjectSchema.nullable().default(null), chapter_id: idSchema.nullable().default(null),
    marks_obtained: z.number().finite().min(0).max(9_999_999.5).multipleOf(0.5).nullable().default(null),
    total_marks: z.number().finite().int().min(1).max(9_999_999).nullable().default(null),
    correct: z.number().int().min(0).max(POSTGRES_INTEGER_MAX).nullable().default(null),
    wrong: z.number().int().min(0).max(POSTGRES_INTEGER_MAX).nullable().default(null),
    skipped: z.number().int().min(0).max(POSTGRES_INTEGER_MAX).nullable().default(null),
    negative_marks: z.number().finite().min(0).max(999_999.75).multipleOf(0.25).nullable().default(null),
    time_minutes: z.number().int().min(0).max(POSTGRES_INTEGER_MAX).nullable().default(null),
    notes: z.string().max(10_000).default(''),
    subject_scores: z.array(z.object({ subject: subjectSchema, marks_obtained: z.number().finite().min(0).max(9_999_999.5).multipleOf(0.5).nullable(), total_marks: z.number().finite().int().min(1).max(9_999_999) }).strict()).max(30).default([])
  }).strict(),
  update_test: z.object({
    id: idSchema,
    title: z.string().trim().min(1).max(160).optional(), test_date: z.iso.date().optional(),
    test_type: z.enum(['Chapter Test','Subject Test','Full Mock','PYQ Practice']).optional(),
    subject: subjectSchema.nullable().optional(), chapter_id: idSchema.nullable().optional(),
    marks_obtained: z.number().finite().min(0).max(9_999_999.5).multipleOf(0.5).nullable().optional(),
    total_marks: z.number().finite().int().min(1).max(9_999_999).nullable().optional(),
    correct: z.number().int().min(0).max(POSTGRES_INTEGER_MAX).nullable().optional(),
    wrong: z.number().int().min(0).max(POSTGRES_INTEGER_MAX).nullable().optional(),
    skipped: z.number().int().min(0).max(POSTGRES_INTEGER_MAX).nullable().optional(),
    negative_marks: z.number().finite().min(0).max(999_999.75).multipleOf(0.25).nullable().optional(),
    time_minutes: z.number().int().min(0).max(POSTGRES_INTEGER_MAX).nullable().optional(),
    notes: z.string().max(10_000).optional()
  }).strict().refine(value => Object.keys(value).length > 1, 'Include at least one test field to update.'),
  update_subject_score: z.object({ test_id: idSchema, subject: subjectSchema, marks_obtained: z.number().finite().min(0).max(9_999_999.5).multipleOf(0.5).nullable(), total_marks: z.number().finite().int().min(1).max(9_999_999) }).strict(),
  delete_test: z.object({ id: idSchema }).strict(),
  create_mistake: z.object({
    chapter_id: idSchema, test_id: idSchema.nullable().default(null),
    mistake_type: z.enum(['Concept','Silly','Calculation','Time','Guess']),
    question_note: z.string().trim().min(1).max(10_000), solution_note: z.string().max(10_000).default(''),
    retry_later: z.boolean().default(false)
  }).strict(),
  update_mistake: z.object({
    id: idSchema, chapter_id: idSchema.optional(), test_id: idSchema.nullable().optional(),
    mistake_type: z.enum(['Concept','Silly','Calculation','Time','Guess']).optional(),
    question_note: z.string().trim().min(1).max(10_000).optional(), solution_note: z.string().max(10_000).optional(),
    retry_later: z.boolean().optional(), retry_status: z.enum(['pending','retried']).optional()
  }).strict().refine(value => Object.keys(value).length > 1, 'Include at least one mistake field to update.'),
  delete_mistake: z.object({ id: idSchema }).strict(),
  create_task: z.object({
    title: z.string().trim().min(1).max(200), task_date: z.iso.date(), estimated_minutes: z.number().int().min(0).max(1440).default(30),
    subject: subjectSchema.nullable().default(null), chapter_id: idSchema.nullable().default(null),
    priority: z.enum(['High','Medium','Low']).default('Medium')
  }).strict(),
  update_task: z.object({
    id: idSchema, title: z.string().trim().min(1).max(200).optional(), task_date: z.iso.date().optional(),
    estimated_minutes: z.number().int().min(0).max(1440).optional(), subject: subjectSchema.nullable().optional(),
    chapter_id: idSchema.nullable().optional(), priority: z.enum(['High','Medium','Low']).optional(), is_completed: z.boolean().optional()
  }).strict().refine(value => Object.keys(value).length > 1, 'Include at least one task field to update.'),
  complete_task: z.object({ id: idSchema }).strict(),
  delete_task: z.object({ id: idSchema }).strict(),
  create_weekly_goal: z.object({
    goal_type: z.enum(['study_hours','tests','chapters','revisions','custom']), title: z.string().trim().min(1).max(120),
    target: z.number().finite().positive().max(999_999.99), progress_value: z.number().finite().nonnegative().max(999_999.99).default(0),
    week_start: z.iso.date().optional(), unit: z.string().max(30).default('')
  }).strict(),
  update_weekly_goal: z.object({ id: idSchema, title: z.string().trim().min(1).max(120).optional(), target: z.number().finite().positive().max(999_999.99).optional(), progress_value: z.number().finite().nonnegative().max(999_999.99).optional(), unit: z.string().max(30).optional() }).strict().refine(value => Object.keys(value).length > 1, 'Include at least one goal field to update.'),
  complete_weekly_goal: z.object({ id: idSchema }).strict(),
  mark_revision_complete: z.object({ revision_id: idSchema }).strict(),
  update_revision_schedule: z.object({ revision_id: idSchema, due_on: z.iso.date() }).strict(),
  update_settings: z.object({
    owner_name: z.string().trim().max(100).optional(), main_exam_date: z.union([z.literal(''), z.iso.date()]).optional(),
    advanced_exam_date: z.union([z.literal(''), z.iso.date()]).optional(), target_score: z.number().finite().min(0).max(999_999.99).multipleOf(0.01).optional(),
    theme: z.enum(['light','dark','auto']).optional(), interface_font: z.enum(['default','poppins','sora','open-sans']).optional(),
    weak_threshold: z.number().finite().min(0).max(99.99).multipleOf(0.01).optional(),
    strong_threshold: z.number().finite().min(0.01).max(100).multipleOf(0.01).optional(),
    dropping_threshold: z.number().finite().min(0).max(100).multipleOf(0.01).optional(),
    revision_gaps: z.array(z.number().int().positive().max(POSTGRES_INTEGER_MAX)).min(1).max(12).optional(),
    daily_study_goal_minutes: z.number().int().min(0).max(1440).optional(), sound_enabled: z.boolean().optional()
  }).strict().refine(value => Object.keys(value).length > 0, 'Include at least one setting to update.')
} as const

export type ToolName = keyof typeof toolSchemas
export type ToolKind = 'read' | 'write'
interface ToolDefinition { name: ToolName; description: string; kind: ToolKind; progress: string; schema: z.ZodType }

const descriptions: Record<ToolName, { description: string; kind: ToolKind; progress: string }> = {
  get_dashboard_summary: { description: 'Read a concise dashboard snapshot using Stracker canonical analytics.', kind: 'read', progress: 'Reading your study dashboard…' },
  get_test_history: { description: 'Read recent tests with scores and trends.', kind: 'read', progress: 'Reading your recent test history…' },
  get_test_details: { description: 'Read one test and its subject/chapter scores by its Stracker test ID.', kind: 'read', progress: 'Opening test details…' },
  get_subject_performance: { description: 'Get canonical per-subject test averages and counts.', kind: 'read', progress: 'Analyzing subject performance…' },
  get_chapter_performance: { description: 'Read canonical chapter averages, trend, and weak/strong/dropping classifications.', kind: 'read', progress: 'Analyzing chapter performance…' },
  get_weak_areas: { description: 'Find tested weak or currently dropping chapters using saved thresholds.', kind: 'read', progress: 'Finding your weak areas…' },
  get_revision_due: { description: 'Read due and overdue chapter revisions. Not the leftover-work backlog (use get_backlog for that).', kind: 'read', progress: 'Checking your revision queue…' },
  get_backlog: { description: 'Read the /backlog leftover-work list (open lectures, topics and practice). Mark snoozed items as snoozed. Not the revision schedule.', kind: 'read', progress: 'Reading your backlog…' },
  get_mistake_summary: { description: 'Summarize mistake types, repeated chapters, and a small number of relevant note samples.', kind: 'read', progress: 'Reviewing your mistake patterns…' },
  get_daily_tasks: { description: 'Read tasks for a calendar date (defaults to today in Stracker’s India time zone).', kind: 'read', progress: 'Reading your study plan…' },
  get_study_time_summary: { description: 'Summarize logged study minutes over a bounded number of recent days.', kind: 'read', progress: 'Summarizing your study time…' },
  get_settings: { description: 'Read non-sensitive study preferences, exam dates, goals, and analytics thresholds.', kind: 'read', progress: 'Checking your study settings…' },
  find_chapters: { description: 'Search the signed-in user’s Stracker chapter notebook by subject and name.', kind: 'read', progress: 'Finding the chapter…' },
  create_test: { description: 'Propose a new test entry from what the student said (title, date, type, marks/total, correct/wrong/skipped, time). Leave optional fields out unless given; never ask the student for an ID. Requires user confirmation before saving.', kind: 'write', progress: 'Preparing a test entry…' },
  update_test: { description: 'Propose changes to one owned test. Requires user confirmation before saving.', kind: 'write', progress: 'Preparing a test update…' },
  update_subject_score: { description: 'Propose a subject score update for an existing full-mock test. Requires confirmation.', kind: 'write', progress: 'Preparing a subject score update…' },
  delete_test: { description: 'Propose deletion of one test and its database-related child rows. Requires explicit confirmation.', kind: 'write', progress: 'Preparing a test deletion…' },
  create_mistake: { description: 'Propose a mistake notebook entry for an existing chapter. Requires confirmation.', kind: 'write', progress: 'Preparing a mistake entry…' },
  update_mistake: { description: 'Propose an update to one owned mistake. Requires confirmation.', kind: 'write', progress: 'Preparing a mistake update…' },
  delete_mistake: { description: 'Propose deletion of one mistake. Requires explicit confirmation.', kind: 'write', progress: 'Preparing a mistake deletion…' },
  create_task: { description: 'Propose a dated daily study task. Requires confirmation before saving.', kind: 'write', progress: 'Preparing a study task…' },
  update_task: { description: 'Propose an update to one owned daily task. Requires confirmation.', kind: 'write', progress: 'Preparing a task update…' },
  complete_task: { description: 'Propose marking one owned study task complete. Requires confirmation.', kind: 'write', progress: 'Preparing to complete the task…' },
  delete_task: { description: 'Propose deletion of one daily task. Requires explicit confirmation.', kind: 'write', progress: 'Preparing a task deletion…' },
  create_weekly_goal: { description: 'Propose a weekly goal for the current week unless a start date is supplied. Requires confirmation.', kind: 'write', progress: 'Preparing a weekly goal…' },
  update_weekly_goal: { description: 'Propose an update to one owned weekly goal. Requires confirmation.', kind: 'write', progress: 'Preparing a goal update…' },
  complete_weekly_goal: { description: 'Propose setting one weekly goal’s progress to its target. Requires confirmation.', kind: 'write', progress: 'Preparing to complete the goal…' },
  mark_revision_complete: { description: 'Propose completing a scheduled revision, using Stracker’s normal revision scheduling logic. Requires confirmation.', kind: 'write', progress: 'Preparing a revision update…' },
  update_revision_schedule: { description: 'Propose moving a scheduled revision to a new date. Requires confirmation.', kind: 'write', progress: 'Preparing a revision schedule update…' },
  update_settings: { description: 'Propose validated changes to study settings (never API credentials). Requires confirmation.', kind: 'write', progress: 'Preparing a settings update…' }
}

export const TOOL_DEFINITIONS: ToolDefinition[] = (Object.keys(toolSchemas) as ToolName[]).map(name => ({ name, schema: toolSchemas[name], ...descriptions[name] }))

/** Validation-only keywords: the server re-checks every value, so the model never needs them. */
const SCHEMA_NOISE = new Set(['$schema','pattern','minLength','maxLength','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','default','minItems','maxItems'])

/**
 * Compact JSON Schema for the model. Zod's uuid/date regexes and integer bounds were most of the
 * catalog's size; they are enforced again on the server (schema parse, preflight, RLS, the RPCs),
 * so dropping them keeps every tool, read and write, inside each provider's request budget.
 */
export function compactSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactSchema)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SCHEMA_NOISE.has(key)) continue
    out[key] = key === 'properties'
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([name, prop]) => [name, compactSchema(prop)]))
      : compactSchema(item)
  }
  return out
}

const FIELD_HINTS: Partial<Record<ToolName, Record<string, string>>> = {
  create_test: {
    test_date: 'YYYY-MM-DD; "today" is the current Stracker date.',
    subject: 'One of the student\u2019s subjects, or null for a Full Mock.',
    marks_obtained: 'Overall marks obtained.',
    total_marks: 'Overall maximum marks.',
    subject_scores: 'Optional per-subject split for a Full Mock. Only include it when the student gave each subject\u2019s marks and its total; never ask for it.'
  },
  create_task: { task_date: 'YYYY-MM-DD.', subject: 'One of the student\u2019s subjects, or null.' }
}

function modelSchema(name: ToolName, schema: z.ZodType): Record<string, unknown> {
  // Input shape: fields with a default (chapter_id, negative_marks, notes, …) are optional for the
  // model. The output shape listed every one as required, so models asked students for all of them.
  const generated = compactSchema(z.toJSONSchema(schema, { io: 'input' })) as Record<string, unknown>
  const properties = generated.properties as Record<string, Record<string, unknown>> | undefined
  for (const [field, hint] of Object.entries(FIELD_HINTS[name] ?? {})) {
    if (properties?.[field]) properties[field] = { ...properties[field], description: hint }
  }
  return generated
}

export const MODEL_TOOLS: ModelTool[] = TOOL_DEFINITIONS.map(tool => ({ name: tool.name, description: tool.description, inputSchema: modelSchema(tool.name, tool.schema) }))

/** Fields that name one of the student's subjects, per tool (for the per-student enum). */
const SUBJECT_FIELDS: Partial<Record<ToolName, string[]>> = {
  create_test: ['subject', 'subject_scores.subject'], update_test: ['subject'], update_subject_score: ['subject'],
  create_task: ['subject'], update_task: ['subject'],
  get_subject_performance: ['subject'], get_chapter_performance: ['subject'], get_weak_areas: ['subject'], get_mistake_summary: ['subject'], find_chapters: ['subject']
}

function withSubjectEnum(node: Record<string, unknown>, subjects: string[]): Record<string, unknown> {
  if (Array.isArray(node.anyOf)) return { ...node, anyOf: (node.anyOf as Record<string, unknown>[]).map(branch => branch.type === 'string' ? { ...branch, enum: subjects } : branch) }
  return node.type === 'string' ? { ...node, enum: subjects } : node
}

/**
 * The full catalog (every read and write tool, every turn) with the student's exam subjects as an
 * enum on each subject field, so no model can invent a subject such as "Biology" for a NEET
 * student whose subjects are Botany and Zoology.
 */
export function modelToolsFor(subjects: string[] = []): ModelTool[] {
  const list = [...new Set(subjects.map(subject => subject.trim()).filter(Boolean))].slice(0, 30)
  if (!list.length) return MODEL_TOOLS
  return MODEL_TOOLS.map(tool => {
    const fields = SUBJECT_FIELDS[tool.name as ToolName]
    if (!fields) return tool
    const schema = structuredClone(tool.inputSchema) as Record<string, unknown>
    const properties = schema.properties as Record<string, Record<string, unknown>>
    for (const field of fields) {
      const [head, child] = field.split('.') as [string, string | undefined]
      const prop = properties[head]
      if (!prop) continue
      if (!child) { properties[head] = withSubjectEnum(prop, list); continue }
      const items = prop.items as Record<string, unknown> | undefined
      const itemProps = items?.properties as Record<string, Record<string, unknown>> | undefined
      if (itemProps?.[child]) itemProps[child] = withSubjectEnum(itemProps[child], list)
    }
    return { ...tool, inputSchema: schema }
  })
}

/** Names models reach for instead of the real tool (add_test was the three.dev failure). */
const TOOL_ALIASES: Record<string, ToolName> = {
  add_test: 'create_test', log_test: 'create_test', record_test: 'create_test', save_test: 'create_test', new_test: 'create_test',
  add_test_result: 'create_test', log_test_result: 'create_test', add_test_score: 'create_test', log_test_score: 'create_test',
  create_test_entry: 'create_test', add_test_entry: 'create_test', add_mock: 'create_test', add_mock_test: 'create_test', create_mock_test: 'create_test', log_mock: 'create_test',
  add_task: 'create_task', create_daily_task: 'create_task', add_daily_task: 'create_task', log_task: 'create_task', add_study_task: 'create_task',
  add_mistake: 'create_mistake', log_mistake: 'create_mistake', record_mistake: 'create_mistake',
  add_goal: 'create_weekly_goal', create_goal: 'create_weekly_goal', add_weekly_goal: 'create_weekly_goal', set_weekly_goal: 'create_weekly_goal',
  complete_revision: 'mark_revision_complete', mark_revision_done: 'mark_revision_complete', finish_revision: 'mark_revision_complete',
  edit_test: 'update_test', edit_task: 'update_task', remove_test: 'delete_test', remove_task: 'delete_task', remove_mistake: 'delete_mistake',
  get_dashboard: 'get_dashboard_summary', get_summary: 'get_dashboard_summary', get_tests: 'get_test_history', list_tests: 'get_test_history',
  get_tasks: 'get_daily_tasks', list_tasks: 'get_daily_tasks', search_chapters: 'find_chapters', find_chapter: 'find_chapters', get_chapters: 'find_chapters',
  get_mistakes: 'get_mistake_summary', get_revisions: 'get_revision_due', get_weak_chapters: 'get_weak_areas',
  get_backlogs: 'get_backlog', list_backlog: 'get_backlog', list_backlog_items: 'get_backlog'
}

export function resolveToolName(raw: string): ToolName | null {
  const name = raw.trim().replace(/^(functions|stracker|tools?)[._:]/i, '').replace(/[\s.-]+/g, '_').toLowerCase()
  if (name in toolSchemas) return name as ToolName
  if (TOOL_ALIASES[name]) return TOOL_ALIASES[name]
  const swapped = name.replace(/^(add|log|record|save|new)_/, 'create_').replace(/^(edit|change|modify)_/, 'update_').replace(/^remove_/, 'delete_')
  return swapped in toolSchemas ? swapped as ToolName : null
}

const KEY_ALIASES: Record<string, string> = {
  date: 'test_date', test_date: 'test_date', exam_date: 'test_date', type: 'test_type', test_type: 'test_type',
  marks: 'marks_obtained', score: 'marks_obtained', obtained_marks: 'marks_obtained', marks_scored: 'marks_obtained', scored: 'marks_obtained', obtained: 'marks_obtained',
  total: 'total_marks', max_marks: 'total_marks', maximum_marks: 'total_marks', out_of: 'total_marks', full_marks: 'total_marks',
  correct_count: 'correct', correct_answers: 'correct', correct_questions: 'correct',
  wrong_count: 'wrong', incorrect: 'wrong', incorrect_count: 'wrong', wrong_answers: 'wrong',
  skipped_count: 'skipped', unattempted: 'skipped', not_attempted: 'skipped', skipped_questions: 'skipped',
  time_taken_minutes: 'time_minutes', time_taken: 'time_minutes', duration_minutes: 'time_minutes', duration: 'time_minutes', minutes: 'time_minutes', time: 'time_minutes',
  negative: 'negative_marks', negative_marking: 'negative_marks',
  subject_breakdown: 'subject_scores', subject_wise: 'subject_scores', subject_wise_scores: 'subject_scores', subject_marks: 'subject_scores', subjects: 'subject_scores', scores: 'subject_scores', breakdown: 'subject_scores'
}
const TASK_KEY_ALIASES: Record<string, string> = { date: 'task_date', minutes: 'estimated_minutes', duration: 'estimated_minutes', duration_minutes: 'estimated_minutes', time_minutes: 'estimated_minutes' }
const SCORE_KEY_ALIASES: Record<string, string> = { name: 'subject', marks: 'marks_obtained', score: 'marks_obtained', obtained: 'marks_obtained', scored: 'marks_obtained', total: 'total_marks', max: 'total_marks', max_marks: 'total_marks', out_of: 'total_marks', full_marks: 'total_marks' }
const NUMERIC_KEYS = new Set(['marks_obtained','total_marks','correct','wrong','skipped','negative_marks','time_minutes','estimated_minutes','limit','days','target','progress_value'])

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!/^[[{]/.test(text)) return value
  try { return JSON.parse(text) } catch { return value }
}

function numeric(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim().replace(/,/g, '')
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : value
}

function testType(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.toLowerCase().replace(/[_-]+/g, ' ').trim()
  if (/\b(full|mock|grand|complete|whole|all subjects?)\b/.test(text)) return 'Full Mock'
  if (/\bpyq|previous year/.test(text)) return 'PYQ Practice'
  if (/\bchapter/.test(text)) return 'Chapter Test'
  if (/\bsubject/.test(text)) return 'Subject Test'
  return value
}

/** Canonical spelling of a subject from the student's exam list (case-insensitive), or null. */
export function canonicalSubject(value: string, subjects: readonly string[]): string | null {
  const key = value.trim().toLowerCase()
  if (!key) return null
  const exact = subjects.find(subject => subject.toLowerCase() === key)
  if (exact) return exact
  const short: Record<string, string> = { maths: 'mathematics', math: 'mathematics', mathematics: 'maths', bio: 'biology', phy: 'physics', chem: 'chemistry' }
  const alt = short[key]
  return alt ? subjects.find(subject => subject.toLowerCase() === alt) ?? null : null
}

function checkSubject(value: unknown, subjects: readonly string[]): unknown {
  if (typeof value !== 'string' || !subjects.length) return value
  const canonical = canonicalSubject(value, subjects)
  if (canonical) return canonical
  throw new ApiError(400, 'invalid_tool_input', `"${value.slice(0, 40)}" is not one of the student\u2019s subjects (${subjects.join(', ')}). Use one of those, or leave the subject out.`)
}

/**
 * Accept the shapes models actually send: another tool name for the same action, arguments as a
 * JSON string, numbers as strings, near-miss keys (date, subject_breakdown, time_taken_minutes…),
 * and a lower-case subject. Keys the tool does not have are dropped instead of failing the call.
 * Subjects are checked against the student's exam subjects so none is invented.
 */
export function normalizeToolCall(call: NormalizedToolCall, subjects: readonly string[] = []): NormalizedToolCall {
  const name = resolveToolName(call.name)
  if (!name) {
    throw new ApiError(400, 'unknown_tool', `There is no tool named ${String(call.name).slice(0, 60)}. Use one of: ${(Object.keys(toolSchemas) as ToolName[]).join(', ')}.`)
  }
  const raw = parseMaybeJson(call.arguments)
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const allowed = new Set(Object.keys(((MODEL_TOOLS.find(tool => tool.name === name)?.inputSchema as { properties?: Record<string, unknown> }).properties) ?? {}))
  const aliases = name === 'create_task' || name === 'update_task' ? TASK_KEY_ALIASES : KEY_ALIASES
  const args: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    const lower = key.toLowerCase()
    const target = allowed.has(lower) ? lower : aliases[lower] && allowed.has(aliases[lower]!) ? aliases[lower]! : null
    if (!target || (target in args && !allowed.has(lower))) continue
    args[target] = NUMERIC_KEYS.has(target) ? numeric(value) : value
  }
  if ('test_type' in args) args.test_type = testType(args.test_type)
  if ('subject' in args && args.subject !== null) {
    if (typeof args.subject === 'string' && /^(none|null|all|all subjects|full|-|)$/i.test(args.subject.trim())) args.subject = null
    else args.subject = checkSubject(args.subject, subjects)
  }
  if ('subject_scores' in args) {
    const list = parseMaybeJson(args.subject_scores)
    if (Array.isArray(list)) {
      args.subject_scores = list.map(item => {
        if (!item || typeof item !== 'object') return item
        const score: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
          const lower = key.toLowerCase()
          const target = ['subject','marks_obtained','total_marks'].includes(lower) ? lower : SCORE_KEY_ALIASES[lower]
          if (target && !(target in score)) score[target] = target === 'subject' ? value : numeric(value)
        }
        if ('subject' in score) score.subject = checkSubject(score.subject, subjects)
        return score
      })
    } else if (list && typeof list === 'object') {
      // {"Physics": 40, "Chemistry": 45} without totals: keep the subjects, totals still needed.
      args.subject_scores = Object.entries(list as Record<string, unknown>).map(([subject, marks]) => ({ subject: checkSubject(subject, subjects), marks_obtained: numeric(marks) }))
    } else {
      delete args.subject_scores
    }
  }
  if (name === 'create_test' && Array.isArray(args.subject_scores)) {
    // The split is optional. With the overall score in hand, an incomplete split (a subject without
    // its total) or a split on a non-mock test is dropped rather than turned into a question.
    const scores = args.subject_scores as Array<Record<string, unknown>>
    const overall = typeof args.marks_obtained === 'number' && typeof args.total_marks === 'number'
    const incomplete = scores.some(score => !score || typeof score.marks_obtained !== 'number' || typeof score.total_marks !== 'number')
    if (!scores.length || (overall && (incomplete || args.test_type !== 'Full Mock'))) delete args.subject_scores
  }
  return { ...call, name, arguments: args }
}

function formatZodError(error: z.ZodError): string {
  return error.issues.slice(0, 4).map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ')
}

function dataError(): ApiError {
  return new ApiError(503, 'stracker_data_unavailable', 'Stracker could not read that study data. Please refresh the notebook and try again.')
}

async function queryAll<T>(client: SupabaseClient, table: string, userId: string, columns = '*', limit = 5000): Promise<T[]> {
  const rows: T[] = []
  const pageSize = 500
  for (let from = 0; from < limit; from += pageSize) {
    const { data, error } = await client.from(table).select(columns).eq('user_id', userId).range(from, Math.min(from + pageSize - 1, limit - 1))
    if (error) throw dataError()
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

async function queryOne<T>(client: SupabaseClient, table: string, userId: string, id: string, columns = '*'): Promise<T> {
  const { data, error } = await client.from(table).select(columns).eq('user_id', userId).eq('id', id).maybeSingle()
  if (error) throw dataError()
  if (!data) throw new ApiError(404, 'not_found', 'That item could not be found in your Stracker account.')
  return data as T
}

function expectUnchanged(input:Record<string,unknown>,row:{updated_at?:string|null}):void {
  if (Object.prototype.hasOwnProperty.call(input,'expected_updated_at') && (row.updated_at ?? null) !== input.expected_updated_at) {
    throw new ApiError(409,'action_target_changed','That Stracker item changed after this action was prepared. Ask the assistant to review it again.')
  }
}

async function analyticsData(client: SupabaseClient, userId: string, includeChapters = false): Promise<AppData> {
  const [tests, testSubjectScores, testChapterLinks, chapters, sessions, mistakes, settingsRows, revisions, tasks, goals] = await Promise.all([
    queryAll<TestRecord>(client, 'tests', userId, '*', 5000),
    queryAll<TestSubjectScore>(client, 'test_subject_scores', userId, '*', 10_000),
    queryAll<TestChapterLink>(client, 'test_chapter_links', userId, '*', 10_000),
    includeChapters ? queryAll<Chapter>(client, 'chapters', userId, '*', 1000) : Promise.resolve([] as Chapter[]),
    queryAll<StudySession>(client, 'study_sessions', userId, '*', 10_000),
    queryAll<Mistake>(client, 'mistakes', userId, 'id,user_id,chapter_id,test_id,mistake_type,question_note,solution_note,retry_later,retry_status,created_at,updated_at,image_path', 5000),
    queryAll<AppSettings>(client, 'app_settings', userId, '*', 5),
    includeChapters ? queryAll<Revision>(client, 'chapter_revisions', userId, '*', 5000) : Promise.resolve([] as Revision[]),
    queryAll<DailyTask>(client, 'daily_tasks', userId, '*', 5000),
    queryAll<WeeklyGoal>(client, 'weekly_goals', userId, '*', 5000)
  ])
  return {
    chapters, revisions, tests, testSubjectScores, testChapterLinks, mistakes, tasks, goals, sessions,
    // Practice/PYQ collections are not exposed to the AI analytics tools yet. Backlog is read by get_backlog and the dashboard counts, not through this bundle.
    practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [], studyCards: [],
    testErrorLogs: [], testTimeEntries: [], examTracks: [],
    settings: settingsRows[0] ?? defaultSettings(userId), profile: null
  }
}

function getTool(name: ToolName): ToolDefinition {
  return TOOL_DEFINITIONS.find(tool => tool.name === name)!
}

function chapterName(chapterId: string | null, chapters: Chapter[]): string | null {
  return chapters.find(chapter => chapter.id === chapterId)?.name ?? null
}

function futureDate(date: string, days: number): string {
  return plusDays(date, days)
}

async function readTool(client: SupabaseClient, userId: string, name: ToolName, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_dashboard_summary': {
      const data = await analyticsData(client, userId, true)
      const overall = getOverallTestAverage(data)
      const backlogItems = await queryAll<BacklogItem>(client, 'backlog_items', userId, 'id,user_id,title,type,subject,chapter_id,priority,due_on,status,snoozed_until,completed_at,created_at,updated_at', 2000)
      const backlog = listBacklogForAI(backlogItems, data.chapters, indiaToday())
      return {
        test_count: data.tests.length,
        scored_tests: overall.count,
        overall_average_percent: overall.average === null ? null : Number(overall.average.toFixed(1)),
        subjects: getSubjectPerformance(data).map(item => ({ ...item, average: item.average === null ? null : Number(item.average.toFixed(1)) })),
        total_chapters: data.chapters.length,
        chapters_completed: data.chapters.filter(chapter => ['Done','Revised'].includes(chapter.status)).length,
        revisions_due: data.revisions.filter(item => !item.completed_at && item.due_on <= indiaToday()).length,
        tasks_today: data.tasks.filter(task => task.task_date === indiaToday()).length,
        completed_tasks_today: data.tasks.filter(task => task.task_date === indiaToday() && task.is_completed).length,
        study_minutes_today: getTodayStudyMinutes(data),
        study_streak: getStudyStreak(data),
        backlog_open: backlog.open_count,
        backlog_snoozed: backlog.snoozed_count
      }
    }
    case 'get_test_history': {
      const limit = input.limit as number
      const data = await analyticsData(client, userId)
      const list = [...data.tests].sort(byMostRecentTest).slice(0, limit)
      return list.map(test => ({ id: test.id, title: test.title, date: test.test_date, type: test.test_type, subject: test.subject, marks: test.marks_obtained, total: test.total_marks, percent: getOverallTestPercentage(test, data.testSubjectScores) }))
    }
    case 'get_test_details': {
      const id = input.test_id as string
      const test = await queryOne<TestRecord>(client, 'tests', userId, id)
      const [scores, links, chapters] = await Promise.all([
        queryAll<TestSubjectScore>(client, 'test_subject_scores', userId, '*', 5000),
        queryAll<TestChapterLink>(client, 'test_chapter_links', userId, '*', 5000),
        queryAll<Chapter>(client, 'chapters', userId, 'id,user_id,name,subject', 1000)
      ])
      return {
        id: test.id, title: test.title, date: test.test_date, type: test.test_type, subject: test.subject,
        marks: test.marks_obtained, total: test.total_marks, overall_percent: getOverallTestPercentage(test, scores),
        notes: test.notes,
        subject_scores: scores.filter(score => score.test_id === id).map(score => ({ subject: score.subject, marks: score.marks_obtained, total: score.total_marks })),
        chapters: links.filter(link => link.test_id === id).map(link => ({ chapter: chapterName(link.chapter_id, chapters), marks: link.marks_obtained, total: link.total_marks }))
      }
    }
    case 'get_subject_performance': {
      const data = await analyticsData(client, userId)
      const requested = input.subject as Subject | undefined
      return getSubjectPerformance(data).filter(item => !requested || item.subject === requested).map(item => ({ ...item, average: item.average === null ? null : Number(item.average.toFixed(1)) }))
    }
    case 'get_chapter_performance': {
      const data = await analyticsData(client, userId, true)
      const requested = input.subject as Subject | undefined
      const limit = input.limit as number
      return getChapterPerformance(data).filter(item => !requested || item.chapter.subject === requested)
        .sort((a, b) => (a.average ?? 101) - (b.average ?? 101)).slice(0, limit)
        .map(item => ({ id: item.chapter.id, name: item.chapter.name, subject: item.chapter.subject, status: item.chapter.status, average_percent: item.average === null ? null : Number(item.average.toFixed(1)), recent_percent: item.results.map(result => Number(result.percentage.toFixed(1))), trend: item.trend, dropping: item.dropping, classification: item.classification, scored_test_count: item.results.length }))
    }
    case 'get_weak_areas': {
      const data = await analyticsData(client, userId, true)
      const requested = input.subject as Subject | undefined
      const limit = input.limit as number
      return getChapterPerformance(data).filter(item => (!requested || item.chapter.subject === requested) && (item.classification === 'Weak' || item.dropping))
        .sort((a, b) => (a.average ?? 101) - (b.average ?? 101)).slice(0, limit)
        .map(item => ({ id: item.chapter.id, chapter: item.chapter.name, subject: item.chapter.subject, average_percent: item.average === null ? null : Number(item.average.toFixed(1)), recent_percent: item.results.map(result => Number(result.percentage.toFixed(1))), trend: item.trend, dropping: item.dropping, classification: item.classification }))
    }
    case 'get_revision_due': {
      const [revisions, chapters] = await Promise.all([
        queryAll<Revision>(client, 'chapter_revisions', userId, '*', 5000),
        queryAll<Chapter>(client, 'chapters', userId, 'id,user_id,name,subject,status', 1000)
      ])
      const cutoff = futureDate(indiaToday(), input.days as number)
      return revisions.filter(revision => !revision.completed_at && revision.due_on <= cutoff).sort((a, b) => a.due_on.localeCompare(b.due_on)).slice(0, input.limit as number)
        .map(revision => { const chapter = chapters.find(item => item.id === revision.chapter_id); return { id: revision.id, revision_number: revision.revision_number, due_on: revision.due_on, overdue: revision.due_on < indiaToday(), chapter_id: revision.chapter_id, chapter: chapter?.name ?? 'Unknown chapter', subject: chapter?.subject ?? null } })
    }
    case 'get_backlog': {
      const [items, chapters] = await Promise.all([
        queryAll<BacklogItem>(client, 'backlog_items', userId, 'id,user_id,title,type,subject,chapter_id,priority,due_on,status,snoozed_until,completed_at,created_at,updated_at', 2000),
        queryAll<Chapter>(client, 'chapters', userId, 'id,user_id,name,subject', 1000)
      ])
      const listed = listBacklogForAI(items, chapters, indiaToday())
      if (input.include_snoozed === false) return { ...listed, snoozed: [], snoozed_count: 0 }
      return listed
    }
    case 'get_mistake_summary': {
      const [mistakes, chapters] = await Promise.all([
        queryAll<Mistake>(client, 'mistakes', userId, 'id,user_id,chapter_id,test_id,mistake_type,question_note,solution_note,retry_later,retry_status,created_at,updated_at', 5000),
        queryAll<Chapter>(client, 'chapters', userId, 'id,user_id,name,subject', 1000)
      ])
      const chapterMap = new Map(chapters.map(chapter => [chapter.id, chapter]))
      const scoped = mistakes.filter(item => !input.subject || chapterMap.get(item.chapter_id)?.subject === input.subject)
      const groups = new Map<string, { type: string; chapter: string; subject: string; count: number; examples: string[] }>()
      for (const mistake of scoped) {
        const chapter = chapterMap.get(mistake.chapter_id)
        const key = `${mistake.mistake_type}:${mistake.chapter_id}`
        const current = groups.get(key) ?? { type: mistake.mistake_type, chapter: chapter?.name ?? 'Unknown chapter', subject: chapter?.subject ?? 'Unknown', count: 0, examples: [] }
        current.count += 1
        if (current.examples.length < 2 && mistake.question_note) current.examples.push(mistake.question_note.slice(0, 180))
        groups.set(key, current)
      }
      return { total: scoped.length, by_type: ['Concept','Silly','Calculation','Time','Guess'].map(type => ({ type, count: scoped.filter(item => item.mistake_type === type).length })), repeated_chapter_patterns: [...groups.values()].filter(group => group.count > 1).sort((a, b) => b.count - a.count).slice(0, input.limit as number), recent_samples: scoped.slice(0, 6).map(item => ({ type: item.mistake_type, chapter: chapterMap.get(item.chapter_id)?.name ?? 'Unknown chapter', note: item.question_note.slice(0, 180), retry_status: item.retry_status })) }
    }
    case 'get_daily_tasks': {
      const date = (input.date as string | undefined) ?? indiaToday()
      const [tasks, chapters] = await Promise.all([
        queryAll<DailyTask>(client, 'daily_tasks', userId, '*', 5000),
        queryAll<Chapter>(client, 'chapters', userId, 'id,user_id,name,subject', 1000)
      ])
      return tasks.filter(task => task.task_date === date).sort((a, b) => a.position - b.position).map(task => ({ id: task.id, title: task.title, date: task.task_date, subject: task.subject, chapter: chapterName(task.chapter_id, chapters), estimated_minutes: task.estimated_minutes, priority: task.priority, completed: task.is_completed }))
    }
    case 'get_study_time_summary': {
      const days = input.days as number
      const from = plusDays(indiaToday(), -days + 1)
      const sessions = await queryAll<StudySession>(client, 'study_sessions', userId, 'id,user_id,subject,started_at,duration_minutes,completion_state', 10_000)
      const relevant = sessions.filter(item => item.started_at.slice(0, 10) >= from && item.started_at.slice(0, 10) <= indiaToday())
      const bySubject = [...new Set(relevant.map(item => item.subject).filter((value): value is string => Boolean(value)))].map(subject => ({ subject, minutes: relevant.filter(item => item.subject === subject).reduce((sum, item) => sum + item.duration_minutes, 0) }))
      const byDay = new Map<string, number>()
      for (const session of relevant) { const day = session.started_at.slice(0, 10); byDay.set(day, (byDay.get(day) ?? 0) + session.duration_minutes) }
      return { period_days: days, from, through: indiaToday(), total_minutes: relevant.reduce((sum, item) => sum + item.duration_minutes, 0), total_hours: Number((relevant.reduce((sum, item) => sum + item.duration_minutes, 0) / 60).toFixed(1)), sessions: relevant.length, by_subject: bySubject, by_day: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, minutes]) => ({ date, minutes })) }
    }
    case 'get_settings': {
      const settings = await queryAll<AppSettings>(client, 'app_settings', userId, '*', 1)
      const value = settings[0] ?? defaultSettings(userId)
      return { main_exam_date: value.main_exam_date || null, advanced_exam_date: value.advanced_exam_date || null, target_score: value.target_score, daily_study_goal_minutes: value.daily_study_goal_minutes, weak_threshold_percent: value.weak_threshold, strong_threshold_percent: value.strong_threshold, dropping_threshold_points: value.dropping_threshold, revision_gaps_days: value.revision_gaps }
    }
    case 'find_chapters': {
      const query = (input.query as string | undefined)?.toLowerCase().trim() ?? ''
      const chapters = await queryAll<Chapter>(client, 'chapters', userId, 'id,user_id,name,subject,status,priority', 1000)
      return chapters.filter(chapter => (!input.subject || chapter.subject === input.subject) && (!query || chapter.name.toLowerCase().includes(query))).slice(0, 30).map(chapter => ({ id: chapter.id, name: chapter.name, subject: chapter.subject, status: chapter.status, priority: chapter.priority }))
    }
    default: throw new ApiError(400, 'unknown_tool', 'That Stracker data tool is not available.')
  }
}

function makeDisplay(name: ToolName, input: Record<string, unknown>, data?: Record<string, unknown>): { title: string; fields: Array<{ label: string; value: string }> } {
  const fields: Array<{ label: string; value: string }> = []
  const add = (label:string,value:unknown) => { if (value !== undefined && value !== null && value !== '') fields.push({ label,value:redactPotentialSecrets(String(value)) }) }
  const labels:Record<string,string> = { title:'Title',test_date:'Date',test_type:'Test type',subject:'Subject',chapter_id:'Chapter ID',marks_obtained:'Marks',total_marks:'Total marks',correct:'Correct',wrong:'Wrong',skipped:'Skipped',negative_marks:'Negative marks',time_minutes:'Time',notes:'Notes',mistake_type:'Mistake type',question_note:'Question note',solution_note:'Solution note',retry_later:'Retry later',retry_status:'Retry status',task_date:'Date',estimated_minutes:'Estimated time',priority:'Priority',is_completed:'Completed',goal_type:'Goal type',target:'Target',progress_value:'Progress',unit:'Unit',week_start:'Week of',main_exam_date:'Main exam date',advanced_exam_date:'Advanced exam date',target_score:'Target score',daily_study_goal_minutes:'Daily study goal',weak_threshold:'Weak threshold',strong_threshold:'Strong threshold',dropping_threshold:'Dropping threshold',revision_gaps:'Revision gaps',due_on:'Due date' }
  const addUpdates = (value:Record<string,unknown>,excluded:string[]=['id','expected_updated_at']) => {
    for (const [key,fieldValue] of Object.entries(value)) {
      if (excluded.includes(key) || fieldValue === undefined || fieldValue === null) continue
      const display = Array.isArray(fieldValue) ? fieldValue.join(' → ') : typeof fieldValue === 'boolean' ? (fieldValue ? 'Yes' : 'No') : typeof fieldValue === 'string' && fieldValue.length > 120 ? `${fieldValue.slice(0,117)}…` : String(fieldValue)
      add(labels[key] ?? key.replaceAll('_',' '),display)
    }
  }
  switch (name) {
    case 'create_test': {
      add('Test',input.title); add('Subject',input.subject ?? 'Full mock / all subjects'); add('Date',input.test_date)
      add('Test type',input.test_type)
      if (Array.isArray(input.subject_scores) && input.subject_scores.length) {
        if (input.marks_obtained != null) add('Score',`${input.marks_obtained} / ${input.total_marks}`)
        for (const score of input.subject_scores as Array<Record<string,unknown>>) add(`${String(score.subject)} score`,`${score.marks_obtained ?? '—'} / ${score.total_marks ?? '—'}`)
      } else {
        add('Total marks',input.total_marks)
        if (input.marks_obtained != null) add('Score',`${input.marks_obtained} / ${input.total_marks}`)
      }
      add('Correct',input.correct); add('Wrong',input.wrong); add('Skipped',input.skipped)
      if (input.time_minutes != null) add('Time',`${input.time_minutes} minutes`)
      break
    }
    case 'update_test': add('Test',data?.title ?? input.id); add('Chapter',data?.chapter); addUpdates(input,['id','expected_updated_at','chapter_id']); break
    case 'update_subject_score': add('Test',data?.title ?? input.test_id); add('Subject',input.subject); add('Score',`${input.marks_obtained ?? '—'} / ${input.total_marks}`); break
    case 'delete_test': add('Test',data?.title ?? input.id); add('Date',data?.test_date); add('Test type',data?.test_type); break
    case 'create_mistake': add('Chapter',data?.chapter ?? input.chapter_id); add('Type',input.mistake_type); add('Question note',String(input.question_note).slice(0,90)); break
    case 'update_mistake': add('Chapter',data?.chapter); add('Test',data?.test); addUpdates(input,['id','expected_updated_at','chapter_id','test_id','question_note']); if (input.question_note !== undefined) add('Question note',String(input.question_note).slice(0,120)); break
    case 'delete_mistake': add('Chapter',data?.chapter); add('Question note',data?.question_note); break
    case 'create_task': add('Task',input.title); add('Date',input.task_date); add('Subject',input.subject ?? 'General'); add('Chapter',data?.chapter); add('Estimated time',`${input.estimated_minutes} minutes`); break
    case 'update_task': add('Task',data?.title ?? input.id); add('Chapter',data?.chapter); add('Date',data?.task_date); addUpdates(input,['id','expected_updated_at','chapter_id','task_date']); break
    case 'complete_task': add('Task',data?.title ?? input.id); break
    case 'delete_task': add('Task',data?.title ?? input.id); add('Date',data?.task_date); break
    case 'create_weekly_goal': add('Goal',input.title); add('Target',`${input.target} ${input.unit ?? ''}`.trim()); add('Week of',input.week_start); break
    case 'update_weekly_goal': add('Goal',data?.title ?? input.id); addUpdates(input); break
    case 'complete_weekly_goal': add('Goal',data?.title ?? input.id); break
    case 'mark_revision_complete': add('Chapter',data?.chapter ?? input.revision_id); add('Due',data?.due_on); break
    case 'update_revision_schedule': add('Revision',data?.chapter ?? input.revision_id); add('New date',input.due_on); break
    case 'update_settings': addUpdates(input,['expected_updated_at','id','user_id','created_at','updated_at']); break
    default: add('Action', name)
  }
  return { title: ({
    create_test: 'Add this test?', update_test: 'Save these test changes?', update_subject_score: 'Update this subject score?', delete_test: 'Delete this test?',
    create_mistake: 'Add this mistake?', update_mistake: 'Save these mistake changes?', delete_mistake: 'Delete this mistake?',
    create_task: 'Add this study task?', update_task: 'Save these task changes?', complete_task: 'Mark this task complete?', delete_task: 'Delete this task?',
    create_weekly_goal: 'Create this weekly goal?', update_weekly_goal: 'Save these goal changes?', complete_weekly_goal: 'Complete this weekly goal?',
    mark_revision_complete: 'Mark this revision complete?', update_revision_schedule: 'Move this revision? ', update_settings: 'Save these Stracker settings?'
  } as Partial<Record<ToolName, string>>)[name] ?? 'Confirm Stracker change', fields }
}

async function chapterForId(client: SupabaseClient, userId: string, chapterId: string | null | undefined): Promise<Chapter | null> {
  if (!chapterId) return null
  return queryOne<Chapter>(client, 'chapters', userId, chapterId)
}

async function preflightAction(client: SupabaseClient, userId: string, name: ToolName, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (name === 'delete_test') { const test = await queryOne<TestRecord>(client,'tests',userId,input.id as string); input.expected_updated_at = test.updated_at; return { title:test.title,test_date:test.test_date,test_type:test.test_type } }
  if (name === 'delete_mistake') {
    const mistake = await queryOne<Mistake>(client,'mistakes',userId,input.id as string)
    input.expected_updated_at = mistake.updated_at
    const chapter = await queryOne<Chapter>(client,'chapters',userId,mistake.chapter_id)
    return { chapter:`${chapter.subject} · ${chapter.name}`,question_note:mistake.question_note.slice(0,120) }
  }
  if (name === 'update_mistake') {
    const existing = await queryOne<Mistake>(client,'mistakes',userId,input.id as string)
    input.expected_updated_at = existing.updated_at
    const merged = { ...existing,...input }
    const question = z.string().trim().min(1).max(10_000).safeParse(merged.question_note)
    if (!question.success) throw new ApiError(400,'invalid_tool_input','A mistake needs a question note of 1–10,000 characters.')
    const chapter = await queryOne<Chapter>(client,'chapters',userId,merged.chapter_id as string)
    const test = merged.test_id ? await queryOne<TestRecord>(client,'tests',userId,merged.test_id as string) : null
    return { chapter:`${chapter.subject} · ${chapter.name}`,test:test?.title,question_note:merged.question_note }
  }
  if (name === 'complete_task' || name === 'delete_task') { const task = await queryOne<DailyTask>(client,'daily_tasks',userId,input.id as string); input.expected_updated_at = task.updated_at; return { title:task.title,task_date:task.task_date } }
  if (name === 'update_task') {
    const existing = await queryOne<DailyTask>(client,'daily_tasks',userId,input.id as string)
    input.expected_updated_at = existing.updated_at
    const merged = { ...existing,...input }
    const parsed = taskInputSchema.safeParse({ title:merged.title,estimated_minutes:merged.estimated_minutes,task_date:merged.task_date })
    if (!parsed.success) throw new ApiError(400,'invalid_tool_input',formatZodError(parsed.error))
    const chapter = await chapterForId(client,userId,merged.chapter_id as string | null)
    if (chapter && merged.subject && chapter.subject !== merged.subject) throw new ApiError(400,'invalid_tool_input','The selected chapter does not belong to that subject.')
    return { title:String(merged.title),chapter:chapter?.name,task_date:merged.task_date }
  }
  if (name === 'complete_weekly_goal') { const goal = await queryOne<WeeklyGoal>(client,'weekly_goals',userId,input.id as string); input.expected_updated_at = goal.updated_at; return { title:goal.title } }
  if (name === 'update_weekly_goal') {
    const existing = await queryOne<WeeklyGoal>(client,'weekly_goals',userId,input.id as string)
    input.expected_updated_at = existing.updated_at
    const parsed = goalSchema.safeParse({ ...existing,...input })
    if (!parsed.success) throw new ApiError(400,'invalid_tool_input',formatZodError(parsed.error))
    return { title:String(parsed.data.title) }
  }
  if (name === 'update_subject_score') {
    const testId = input.test_id as string
    const test = await queryOne<TestRecord>(client,'tests',userId,testId)
    input.expected_updated_at = test.updated_at
    if (test.test_type !== 'Full Mock') throw new ApiError(400,'invalid_tool_input','Subject score updates are only available for Full Mock tests.')
    const parsed = subjectScoreInputSchema.safeParse({ marks_obtained:input.marks_obtained,total_marks:input.total_marks })
    if (!parsed.success) throw new ApiError(400,'invalid_tool_input',formatZodError(parsed.error))
    const { data:existingScores,error } = await client.from('test_subject_scores').select('subject,marks_obtained,total_marks').eq('user_id',userId).eq('test_id',testId)
    if (error) throw dataError()
    const scores = [...((existingScores ?? []) as Array<{subject:string;marks_obtained:number|null;total_marks:number|null}>).filter(score => score.subject !== input.subject),{subject:String(input.subject),...parsed.data}]
    const complete = fullMockComplete(scores)
    if (complete) {
      const marks = scores.reduce((sum,score) => sum + (score.marks_obtained ?? 0),0)
      const total = scores.reduce((sum,score) => sum + (score.total_marks ?? 0),0)
      if (marks > total || total > 9_999_999) throw new ApiError(400,'invalid_tool_input','These subject scores exceed Stracker’s supported Full Mock total.')
    }
    return { title:test.title }
  }
  if (name === 'mark_revision_complete' || name === 'update_revision_schedule') {
    const revision = await queryOne<Revision>(client,'chapter_revisions',userId,input.revision_id as string)
    if (revision.completed_at) throw new ApiError(409,'action_target_changed','That revision is already complete. Choose an open revision instead.')
    input.expected_updated_at = revision.updated_at
    const chapter = await queryOne<Chapter>(client,'chapters',userId,revision.chapter_id)
    return { chapter: `${chapter.subject} · ${chapter.name}`, due_on: revision.due_on }
  }
  if (name === 'create_test' || name === 'update_test') {
    const testId = name === 'update_test' ? input.id as string : undefined
    const existing = testId ? await queryOne<TestRecord>(client,'tests',userId,testId) : null
    const chapterId = Object.prototype.hasOwnProperty.call(input,'chapter_id') ? input.chapter_id as string|null : existing?.chapter_id ?? null
    const requestedSubject = Object.prototype.hasOwnProperty.call(input,'subject') ? input.subject as Subject|null : existing?.subject ?? null
    const chapter = await chapterForId(client,userId,chapterId)
    if (chapter && requestedSubject && chapter.subject !== requestedSubject) throw new ApiError(400,'invalid_tool_input','The selected chapter does not belong to that subject.')
    const subject = requestedSubject ?? chapter?.subject ?? null
    let record: Record<string,unknown>
    if (existing) {
      input.expected_updated_at = existing.updated_at
      if (existing.test_type === 'Full Mock' && (Object.prototype.hasOwnProperty.call(input,'marks_obtained') || Object.prototype.hasOwnProperty.call(input,'total_marks'))) {
        throw new ApiError(400,'invalid_tool_input','Update Full Mock subject scores with the subject score action so Stracker can recalculate the aggregate.')
      }
      if (input.test_type && input.test_type !== existing.test_type && (input.test_type === 'Full Mock' || existing.test_type === 'Full Mock')) {
        throw new ApiError(400,'invalid_tool_input','A Full Mock cannot be converted without rebuilding its subject scores. Keep its test type and edit subject scores separately.')
      }
      record = { ...existing,...input,id:existing.id,created_at:existing.created_at,updated_at:new Date().toISOString() }
      delete record.subject_scores
    } else {
      const isFullMock = input.test_type === 'Full Mock'
      if (!isFullMock && (typeof input.total_marks !== 'number' || input.total_marks < 1)) {
        throw new ApiError(400,'invalid_tool_input','A non-mock test needs its positive total marks before it can be added.')
      }
      if (input.marks_obtained != null && (input.total_marks == null || Number(input.marks_obtained) > Number(input.total_marks))) {
        throw new ApiError(400,'invalid_tool_input','Marks obtained cannot be more than the total marks. Ask the student to check the score.')
      }
      let scores = Array.isArray(input.subject_scores) ? input.subject_scores as Record<string,unknown>[] : []
      const hasOverall = input.marks_obtained != null && input.total_marks != null
      // A Full Mock saves with its overall score alone, or with a complete subject split (the
      // overall is then the sum). A partial split next to an overall score is dropped, never asked for.
      if (isFullMock && scores.length && hasOverall && !fullMockComplete(scores)) { scores = []; input.subject_scores = [] }
      const seen = new Set<string>()
      for (const score of scores) {
        const parsedScore = subjectScoreInputSchema.safeParse(score)
        if (!parsedScore.success) throw new ApiError(400,'invalid_tool_input',formatZodError(parsedScore.error))
        const scoreSubject = String(score.subject)
        if (seen.has(scoreSubject)) throw new ApiError(400,'invalid_tool_input','A Full Mock can have at most one score for each subject.')
        seen.add(scoreSubject)
        if (parsedScore.data.marks_obtained != null && parsedScore.data.marks_obtained > (parsedScore.data.total_marks ?? 0)) throw new ApiError(400,'invalid_tool_input','Subject marks cannot exceed that subject’s total.')
      }
      if (scores.length && !isFullMock) throw new ApiError(400,'invalid_tool_input','Per-subject scores can only be added to a Full Mock.')
      const completeMock = isFullMock && fullMockComplete(scores)
      let aggregateMarks = completeMock ? scores.reduce((sum,score) => sum + Number(score.marks_obtained ?? 0),0) : null
      let aggregateTotal = completeMock ? scores.reduce((sum,score) => sum + Number(score.total_marks ?? 0),0) : null
      if (completeMock && (aggregateMarks === null || aggregateTotal === null || aggregateMarks > aggregateTotal || aggregateTotal > 9_999_999)) {
        throw new ApiError(400,'invalid_tool_input','The combined Full Mock score is outside Stracker’s supported marks range.')
      }
      if (completeMock && hasOverall && (Number(input.marks_obtained) !== aggregateMarks || Number(input.total_marks) !== aggregateTotal)) {
        throw new ApiError(400,'invalid_tool_input',`The subject marks add up to ${aggregateMarks}/${aggregateTotal}, but the overall score is ${String(input.marks_obtained)}/${String(input.total_marks)}. Ask the student which one is right.`)
      }
      if (isFullMock && !completeMock && !scores.length) {
        aggregateMarks = (input.marks_obtained as number | null) ?? null
        aggregateTotal = (input.total_marks as number | null) ?? null
      }
      if (isFullMock) { input.marks_obtained = aggregateMarks; input.total_marks = aggregateTotal }
      record = {
        id:createId(),title:input.title,test_date:input.test_date,test_type:input.test_type,
        subject,chapter_id:chapterId,
        marks_obtained:isFullMock ? aggregateMarks : input.marks_obtained ?? null,
        total_marks:isFullMock ? aggregateTotal : input.total_marks ?? null,
        correct:input.correct ?? null,wrong:input.wrong ?? null,skipped:input.skipped ?? null,
        negative_marks:input.negative_marks ?? null,time_minutes:input.time_minutes ?? null,notes:input.notes ?? '',
        created_at:new Date().toISOString(),updated_at:new Date().toISOString()
      }
    }
    const parsed = testFormSchema.safeParse(record)
    if (!parsed.success) throw new ApiError(400,'invalid_tool_input',formatZodError(parsed.error))
    validatePersistedRecords('tests',[{ ...record,user_id:userId }])
    if (name === 'create_test') {
      input.id = record.id
      input.subject_scores = (Array.isArray(input.subject_scores) ? input.subject_scores as Record<string,unknown>[] : []).map(score => ({ ...score,id:createId() }))
    }
    return { title:String(record.title),chapter:chapter?.name,test_date:record.test_date,test_type:record.test_type }
  }
  if (name === 'create_mistake') {
    const chapter = await queryOne<Chapter>(client,'chapters',userId,input.chapter_id as string)
    if (input.test_id) await queryOne<TestRecord>(client,'tests',userId,input.test_id as string)
    input.id = createId()
    return { chapter: `${chapter.subject} · ${chapter.name}` }
  }
  if (name === 'create_task') {
    const chapter = await chapterForId(client,userId,input.chapter_id as string | null)
    if (chapter && input.subject && chapter.subject !== input.subject) throw new ApiError(400,'invalid_tool_input','The selected chapter does not belong to that subject.')
    const parsed = taskInputSchema.safeParse(input)
    if (!parsed.success) throw new ApiError(400,'invalid_tool_input',formatZodError(parsed.error))
    input.id = createId()
    return { chapter: chapter?.name }
  }
  if (name === 'create_weekly_goal') {
    input.week_start = input.week_start ?? getWeekStart(indiaToday())
    const parsed = goalSchema.safeParse({ ...input, progress_value: input.progress_value ?? 0, week_start: input.week_start, unit: input.unit ?? '' })
    if (!parsed.success) throw new ApiError(400,'invalid_tool_input',formatZodError(parsed.error))
    input.id = createId()
    return { title: String(input.title) }
  }
  if (name === 'update_settings') {
    const current = await queryAll<AppSettings>(client,'app_settings',userId,'*',1)
    input.expected_updated_at = current[0]?.updated_at ?? null
    const merged = { ...(current[0] ?? defaultSettings(userId)), ...input }
    const parsed = settingsSchema.safeParse(merged)
    if (!parsed.success) throw new ApiError(400,'invalid_tool_input',formatZodError(parsed.error))
  }
  return {}
}

async function performAction(client: SupabaseClient, userId: string, name: ToolName, input: Record<string, unknown>): Promise<{ message: string; result: Record<string, unknown> }> {
  const now = new Date().toISOString()
  const save = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await client.from(table).upsert({ ...row, user_id: userId, updated_at: now }).select('*').single()
    if (error || !data) throw dataError()
    return data as Record<string, unknown>
  }
  const update = async (table: string, id: string, patch: Record<string, unknown>) => {
    let query = client.from(table).update({ ...patch, updated_at: now }).eq('user_id',userId).eq('id',id)
    if (typeof input.expected_updated_at === 'string') query = query.eq('updated_at',input.expected_updated_at)
    const { data,error } = await query.select('*').maybeSingle()
    if (error) throw dataError()
    if (!data) throw new ApiError(409,'action_target_changed','That Stracker item changed after this action was prepared. Ask the assistant to review it again.')
    return data as Record<string, unknown>
  }
  const remove = async (table: string, id: string) => {
    let query = client.from(table).delete().eq('user_id',userId).eq('id',id)
    if (typeof input.expected_updated_at === 'string') query = query.eq('updated_at',input.expected_updated_at)
    const { data,error } = await query.select('id').maybeSingle()
    if (error) throw dataError()
    if (!data) throw new ApiError(409,'action_target_changed','That Stracker item changed after this action was prepared. No new change was made.')
  }
  switch (name) {
    case 'create_test': {
      const { subject_scores, ...testInput } = input
      const testId = typeof input.id === 'string' ? input.id : createId()
      const testPayload = { ...testInput, id:testId, chapter_id:input.chapter_id ?? null }
      const scoreRows = Array.isArray(subject_scores) ? (subject_scores as Record<string,unknown>[]).map(score => ({
        id:typeof score.id === 'string' ? score.id : createId(),
        subject:score.subject,
        marks_obtained:score.marks_obtained ?? null,
        total_marks:score.total_marks
      })) : []
      const { data, error } = await client.rpc('ai_create_test_with_scores',{ test_payload:testPayload,score_payload:scoreRows })
      if (error || !data || typeof data !== 'object') throw dataError()
      const payload = data as { test?:Record<string,unknown>; subject_scores?:unknown[] }
      const row = payload.test
      if (!row || row.id !== testId) throw dataError()
      return { message:`Added ${row.title} for ${row.test_date}.`,result:{ id:row.id,title:row.title,date:row.test_date,total_marks:row.total_marks,marks_obtained:row.marks_obtained,route:'/tests' } }
    }
    case 'update_test': {
      const id = input.id as string
      const patch = { ...input }
      delete patch.id; delete patch.expected_updated_at
      const existing = await queryOne<TestRecord>(client,'tests',userId,id)
      expectUnchanged(input,existing)
      const merged = { ...existing, ...patch, updated_at: now }
      const parsed = testFormSchema.safeParse(merged)
      if (!parsed.success) throw new ApiError(400,'invalid_tool_input',formatZodError(parsed.error))
      validatePersistedRecords('tests',[{ ...merged, user_id: userId }])
      const { data,error } = await client.rpc('ai_update_test_record',{ test_payload:merged,expected_updated_at:input.expected_updated_at })
      if (error?.code === '40001') throw new ApiError(409,'action_target_changed','That test changed after this update was prepared. Ask the assistant to review it again.')
      if (error || !data || typeof data !== 'object') throw dataError()
      const payload = data as { test?:Record<string,unknown>;chapter_link?:Record<string,unknown>|null }
      const row = payload.test
      const chapterLink = payload.chapter_link
      if (!row || row.id !== id || (row.chapter_id ?? null) !== (merged.chapter_id ?? null)) throw dataError()
      if (row.chapter_id && (!chapterLink || chapterLink.test_id !== id || chapterLink.chapter_id !== row.chapter_id)) throw dataError()
      if (!row.chapter_id && chapterLink) throw dataError()
      return { message: `Updated ${row.title}.`, result: { id: row.id, title: row.title, route: '/tests' } }
    }
    case 'update_subject_score': {
      const inputTestId = input.test_id as string
      const parsed = subjectScoreInputSchema.safeParse(input)
      if (!parsed.success) throw new ApiError(400,'invalid_tool_input',formatZodError(parsed.error))
      const { data,error } = await client.rpc('ai_update_test_subject_score',{
        target_test_id:inputTestId,expected_updated_at:input.expected_updated_at,subject_value:input.subject,marks_value:parsed.data.marks_obtained,total_value:parsed.data.total_marks
      })
      if (error?.code === '40001') throw new ApiError(409,'action_target_changed','That Full Mock changed after this score update was prepared. Ask the assistant to review it again.')
      if (error || !data || typeof data !== 'object') throw dataError()
      const payload = data as {test?:Record<string,unknown>;subject_score?:Record<string,unknown>;chapter_link?:Record<string,unknown>|null}
      const test = payload.test
      const score = payload.subject_score
      const chapterLink = payload.chapter_link
      if (!test || test.id !== inputTestId || !score || score.test_id !== inputTestId || score.subject !== input.subject) throw dataError()
      if (test.chapter_id && (!chapterLink || chapterLink.test_id !== inputTestId || chapterLink.chapter_id !== test.chapter_id)) throw dataError()
      if (!test.chapter_id && chapterLink) throw dataError()
      return { message:`Updated ${input.subject} to ${parsed.data.marks_obtained ?? 'unknown'} / ${parsed.data.total_marks} in ${String(test.title)}.`,result:{ id:score.id,test_id:inputTestId,subject:score.subject,marks_obtained:score.marks_obtained,total_marks:score.total_marks,overall_marks_obtained:test.marks_obtained,overall_total_marks:test.total_marks,route:'/tests' } }
    }
    case 'delete_test': {
      const test = await queryOne<TestRecord>(client,'tests',userId,input.id as string)
      expectUnchanged(input,test)
      await remove('tests',input.id as string)
      return { message: `Deleted ${test.title}.`, result: { id: test.id, title: test.title, route: '/tests' } }
    }
    case 'create_mistake': {
      const row = await save('mistakes',{ ...input, id: input.id ?? createId(), image_path: null, retry_status: 'pending' })
      return { message: `Added a ${row.mistake_type} mistake to the notebook.`, result: { id: row.id, chapter_id: row.chapter_id, mistake_type: row.mistake_type, route: '/mistakes' } }
    }
    case 'update_mistake': {
      const id = input.id as string
      const patch = { ...input }
      delete patch.id; delete patch.expected_updated_at
      const existing = await queryOne<Mistake>(client,'mistakes',userId,id)
      expectUnchanged(input,existing)
      const merged = { ...existing, ...patch }
      if (typeof merged.question_note !== 'string' || !merged.question_note.trim()) throw new ApiError(400,'invalid_tool_input','A mistake needs a question note.')
      const row = await update('mistakes',id as string,patch)
      return { message: 'Updated the mistake notebook entry.', result: { id: row.id, route: '/mistakes' } }
    }
    case 'delete_mistake': {
      const mistake = await queryOne<Mistake>(client,'mistakes',userId,input.id as string)
      expectUnchanged(input,mistake)
      await remove('mistakes',input.id as string)
      let imageCleanupComplete = true
      if (mistake.image_path) {
        if (!mistake.image_path.startsWith(`${userId}/`)) imageCleanupComplete = false
        else {
          const { error } = await client.storage.from('mistake-images').remove([mistake.image_path])
          imageCleanupComplete = !error
        }
      }
      return { message:imageCleanupComplete ? 'Deleted the mistake entry.' : 'Deleted the mistake entry, but its private image could not be removed automatically.',result:{ id:mistake.id,route:'/mistakes',imageCleanupComplete } }
    }
    case 'create_task': {
      const dateTasks = await queryAll<DailyTask>(client,'daily_tasks',userId,'id,user_id,task_date,position',5000)
      const row = await save('daily_tasks',{ ...input, id: input.id ?? createId(), chapter_id: input.chapter_id ?? null, is_completed: false, position: dateTasks.filter(task => task.task_date === input.task_date).length })
      return { message: `Added “${row.title}” to your study plan for ${row.task_date}.`, result: { id: row.id, title: row.title, date: row.task_date, subject: row.subject, estimated_minutes: row.estimated_minutes, route: '/planner' } }
    }
    case 'update_task': {
      const id = input.id as string
      const patch = { ...input }
      delete patch.id; delete patch.expected_updated_at
      const existing = await queryOne<DailyTask>(client,'daily_tasks',userId,id)
      expectUnchanged(input,existing)
      const merged = { ...existing, ...patch }
      const parsed = taskInputSchema.safeParse({ title: merged.title, estimated_minutes: merged.estimated_minutes, task_date: merged.task_date })
      if (!parsed.success) throw new ApiError(400,'invalid_tool_input',formatZodError(parsed.error))
      const row = await update('daily_tasks',id as string,patch)
      return { message: `Updated “${row.title}”.`, result: { id: row.id, title: row.title, route: '/planner' } }
    }
    case 'complete_task': {
      const task = await queryOne<DailyTask>(client,'daily_tasks',userId,input.id as string)
      expectUnchanged(input,task)
      const row = await update('daily_tasks',task.id,{ is_completed: true })
      return { message: `Marked “${row.title}” complete.`, result: { id: row.id, title: row.title, route: '/planner' } }
    }
    case 'delete_task': {
      const task = await queryOne<DailyTask>(client,'daily_tasks',userId,input.id as string)
      expectUnchanged(input,task)
      await remove('daily_tasks',task.id)
      return { message: `Deleted “${task.title}”.`, result: { id: task.id, title: task.title, route: '/planner' } }
    }
    case 'create_weekly_goal': {
      const normalized = { ...input, id: input.id ?? createId(), week_start: input.week_start ?? getWeekStart(indiaToday()), progress_value: input.progress_value ?? 0, unit: input.unit ?? '' }
      const parsed = goalSchema.safeParse(normalized)
      if (!parsed.success) throw new ApiError(400,'invalid_tool_input',formatZodError(parsed.error))
      const row = await save('weekly_goals',normalized)
      return { message: `Created the weekly goal “${row.title}”.`, result: { id: row.id, title: row.title, target: row.target, route: '/planner' } }
    }
    case 'update_weekly_goal': {
      const id = input.id as string
      const patch = { ...input }
      delete patch.id; delete patch.expected_updated_at
      const existing = await queryOne<WeeklyGoal>(client,'weekly_goals',userId,id)
      expectUnchanged(input,existing)
      const normalized = { ...existing, ...patch }
      const parsed = goalSchema.safeParse(normalized)
      if (!parsed.success) throw new ApiError(400,'invalid_tool_input',formatZodError(parsed.error))
      const row = await update('weekly_goals',id as string,patch)
      return { message: `Updated the weekly goal “${row.title}”.`, result: { id: row.id, title: row.title, route: '/planner' } }
    }
    case 'complete_weekly_goal': {
      const goal = await queryOne<WeeklyGoal>(client,'weekly_goals',userId,input.id as string)
      expectUnchanged(input,goal)
      const row = await update('weekly_goals',goal.id,{ progress_value: goal.target })
      return { message: `Completed the weekly goal “${row.title}”.`, result: { id: row.id, title: row.title, route: '/planner' } }
    }
    case 'mark_revision_complete': {
      const revision = await queryOne<Revision>(client,'chapter_revisions',userId,input.revision_id as string)
      expectUnchanged(input,revision)
      const [allRevisions,chapter] = await Promise.all([
        queryAll<Revision>(client,'chapter_revisions',userId,'*',5000),
        queryOne<Chapter>(client,'chapters',userId,revision.chapter_id)
      ])
      const settings = (await queryAll<AppSettings>(client,'app_settings',userId,'*',1))[0] ?? defaultSettings(userId)
      let plannedRevisions:Revision[] = []
      const planned = await completeRevision(revision,chapter,async updates => { plannedRevisions = updates },async () => undefined,{
        revisions:allRevisions,gaps:settings.revision_gaps,today:indiaToday(),now
      })
      if (!planned) throw new ApiError(409,'action_in_progress','That revision is already being updated. Try again in a moment.')
      const completedRevision = plannedRevisions.find(item => item.id === revision.id)
      if (!completedRevision?.completed_at) throw dataError()
      const nextRevision = plannedRevisions.find(item => item.id !== revision.id) ?? null
      const { data,error } = await client.rpc('ai_complete_revision_atomic',{
        target_revision_id:revision.id,expected_updated_at:input.expected_updated_at,completion_time:completedRevision.completed_at,
        next_revision_payload:nextRevision ? { id:nextRevision.id,chapter_id:nextRevision.chapter_id,revision_number:nextRevision.revision_number,due_on:nextRevision.due_on,completed_at:null } : null
      })
      if (error?.code === '40001') throw new ApiError(409,'action_target_changed','That revision changed after this action was prepared. Ask the assistant to review it again.')
      if (error || !data || typeof data !== 'object') throw dataError()
      const payload = data as {completed_revision?:Record<string,unknown>;next_revision?:Record<string,unknown>|null;chapter?:Record<string,unknown>}
      const saved = payload.completed_revision
      const savedChapter = payload.chapter
      const next = payload.next_revision
      if (!saved || saved.id !== revision.id || !saved.completed_at || !savedChapter || savedChapter.id !== chapter.id) throw dataError()
      const scheduled = next && typeof next.id === 'string' ? next : null
      return {
        message:`Marked ${chapter.name} revision ${revision.revision_number} complete.${scheduled ? ` Revision ${revision.revision_number + 1} is now scheduled.` : ''}`,
        result:{ id:saved.id,chapter_id:chapter.id,chapter:chapter.name,route:'/revision',next_revision_id:scheduled?.id ?? null,chapter_status:savedChapter.status }
      }
    }
    case 'update_revision_schedule': {
      const revision = await queryOne<Revision>(client,'chapter_revisions',userId,input.revision_id as string)
      expectUnchanged(input,revision)
      const chapter = await queryOne<Chapter>(client,'chapters',userId,revision.chapter_id)
      const parsed = z.object({ revision_number: z.number().int().positive(), due_on: z.iso.date() }).safeParse({ revision_number: revision.revision_number, due_on: input.due_on })
      if (!parsed.success) throw new ApiError(400,'invalid_tool_input',formatZodError(parsed.error))
      const row = await update('chapter_revisions',revision.id,{ due_on: input.due_on })
      return { message: `Moved ${chapter.name} revision ${revision.revision_number} to ${row.due_on}.`, result: { id: row.id, chapter_id: chapter.id, chapter: chapter.name, due_on: row.due_on, route: '/revision' } }
    }
    case 'update_settings': {
      const currentRows = await queryAll<AppSettings>(client,'app_settings',userId,'*',1)
      const existing = currentRows[0] ?? defaultSettings(userId)
      expectUnchanged(input,{updated_at:currentRows[0]?.updated_at ?? null})
      const parsed = settingsSchema.safeParse({ ...existing, ...input })
      if (!parsed.success) throw new ApiError(400,'invalid_tool_input',formatZodError(parsed.error))
      validatePersistedRecords('app_settings',[{ ...existing, ...parsed.data, id: userId, user_id: userId }])
      const record = { ...existing,...parsed.data,id:userId,user_id:userId,updated_at:now }
      let saved:Record<string,unknown>|null = null
      if (typeof input.expected_updated_at === 'string') {
        const { data,error } = await client.from('app_settings').update(record).eq('id',userId).eq('user_id',userId).eq('updated_at',input.expected_updated_at).select('id,updated_at').maybeSingle()
        if (error) throw dataError()
        saved = data as Record<string,unknown>|null
      } else {
        const { data,error } = await client.from('app_settings').insert(record).select('id,updated_at').maybeSingle()
        if (error?.code === '23505') throw new ApiError(409,'action_target_changed','Your Stracker settings changed after this action was prepared. Ask the assistant to review the update again.')
        if (error) throw dataError()
        saved = data as Record<string,unknown>|null
      }
      if (!saved || saved.id !== userId) throw new ApiError(409,'action_target_changed','Your Stracker settings changed after this action was prepared. Ask the assistant to review the update again.')
      return { message: 'Saved the requested Stracker study settings.', result: { id: userId, updated_fields: Object.keys(input).filter(key => key !== 'expected_updated_at'), route: '/settings' } }
    }
    default: throw new ApiError(400,'unknown_tool','That Stracker action is not available.')
  }
}

export interface ActionPreview {
  title: string
  fields: Array<{ label: string; value: string }>
  toolName: ToolName
  actionId: string
  taskId: string
  expiresAt: string
}

export async function prepareToolCall(
  client: SupabaseClient,
  userId: string,
  call: NormalizedToolCall,
  taskId: string,
  provider: { providerId: string; modelId: string },
  adminClient: SupabaseClient,
  conversationId: string,
  subjects: readonly string[] = []
): Promise<{ kind: 'read'; result: unknown } | { kind: 'confirmation'; action: ActionPreview }> {
  call = normalizeToolCall(call, subjects)
  const name = call.name as ToolName
  const tool = getTool(name)
  const parsed = tool.schema.safeParse(call.arguments)
  if (!parsed.success) throw new ApiError(400,'invalid_tool_input',formatZodError(parsed.error))
  const input = JSON.parse(redactPotentialSecrets(JSON.stringify(parsed.data))) as Record<string, unknown>
  if (tool.kind === 'read') return { kind: 'read', result: await readTool(client,userId,name,input) }

  const extra = await preflightAction(client,userId,name,input)
  // IDs are fixed before confirmation so a retry after a lost network response reuses the
  // exact same record identity rather than creating duplicate tests/tasks/mistakes.
  const preview = makeDisplay(name,input,extra)
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString()
  const { data: existing, error: lookupError } = await adminClient.from('ai_pending_actions').select('id,status,expires_at,summary').eq('user_id',userId).eq('task_id',taskId).eq('tool_call_key',call.id.slice(0,120)).maybeSingle()
  if (lookupError) throw new ApiError(503,'action_confirmation_unavailable','Stracker could not prepare a safe confirmation. No data was changed.')
  let actionId: string
  if (existing) {
    actionId = existing.id as string
    if (existing.status !== 'pending') throw new ApiError(409,'action_already_handled','This proposed Stracker change has already been handled.')
  } else {
    const { data, error } = await adminClient.from('ai_pending_actions').insert({
      user_id: userId, task_id: taskId, conversation_id: conversationId, tool_name: name,
      tool_call_key: call.id.slice(0,120), input, summary: { title: preview.title, fields: preview.fields }, expires_at: expiresAt
    }).select('id').single()
    if (error || !data) throw new ApiError(503,'action_confirmation_unavailable','Stracker could not prepare a safe confirmation. No data was changed.')
    actionId = data.id as string
  }
  await adminClient.from('ai_tasks').update({ status:'waiting', provider_id:provider.providerId, model_id:provider.modelId, progress:'Waiting for your confirmation.' }).eq('user_id',userId).eq('id',taskId)
  return { kind:'confirmation', action:{ title:preview.title, fields:preview.fields, toolName:name, actionId, taskId, expiresAt } }
}

export async function confirmPendingAction(adminClient: SupabaseClient, userClient: SupabaseClient, userId: string, actionId: string, approved: boolean, provider: { providerId: string | null; modelId: string | null }): Promise<{ message: string; result?: Record<string, unknown>; taskId: string; conversationId: string }> {
  const { data, error } = await adminClient.from('ai_pending_actions').select('*').eq('user_id',userId).eq('id',actionId).maybeSingle()
  if (error) throw new ApiError(503,'action_confirmation_unavailable','The pending change could not be loaded. Try again.')
  if (!data) throw new ApiError(404,'action_not_found','This proposed change is no longer available.')
  const pending = data as { id: string; user_id: string; task_id: string; conversation_id: string; tool_name: string; input: Record<string,unknown>; summary: Record<string,unknown>; status: string; result: unknown; expires_at: string }
  const completedResult = () => ({ ...(pending.result as { message: string; result?: Record<string,unknown> }), taskId:pending.task_id, conversationId:pending.conversation_id })
  if (pending.status === 'completed' && pending.result && typeof pending.result === 'object') return completedResult()
  if (pending.status === 'cancelled') return { message:'Cancelled. No Stracker data was changed.', taskId:pending.task_id, conversationId:pending.conversation_id }
  if (pending.status === 'executing') throw new ApiError(409,'action_in_progress','This Stracker change is already being saved. Wait for that save to finish before retrying.')
  if (pending.status !== 'pending') throw new ApiError(409,'action_already_handled','This proposed change has already been handled.')

  const respondToLostClaim = async ():Promise<{message:string;result?:Record<string,unknown>;taskId:string;conversationId:string}> => {
    const { data:latest,error:reloadError } = await adminClient.from('ai_pending_actions').select('*').eq('user_id',userId).eq('id',actionId).maybeSingle()
    if (reloadError || !latest) throw new ApiError(503,'action_confirmation_unavailable','The pending change could not be checked after a concurrent update.')
    const current = latest as typeof pending
    if (current.status === 'completed' && current.result && typeof current.result === 'object') return { ...(current.result as {message:string;result?:Record<string,unknown>}),taskId:current.task_id,conversationId:current.conversation_id }
    if (current.status === 'cancelled') return { message:'Cancelled. No Stracker data was changed.',taskId:current.task_id,conversationId:current.conversation_id }
    if (current.status === 'executing') throw new ApiError(409,'action_in_progress','This Stracker change is already being saved. Wait for that save to finish before retrying.')
    if (current.status === 'expired') throw new ApiError(410,'action_expired','This confirmation expired. Ask Stracker AI to prepare the change again.')
    throw new ApiError(409,'action_already_handled','This proposed change has already been handled.')
  }
  const returnReplay = async (operation:()=>PromiseLike<{ data:unknown; error:unknown }>):Promise<{message:string;result?:Record<string,unknown>;taskId:string;conversationId:string}|null> => {
    const { data:claimed,error:claimError } = await operation()
    if (claimError) throw new ApiError(503,'action_confirmation_unavailable','The confirmation decision could not be saved. Try again.')
    if (claimed) return null
    return respondToLostClaim()
  }

  if (new Date(pending.expires_at).getTime() < Date.now()) {
    const replay = await returnReplay(() => adminClient.from('ai_pending_actions').update({ status:'expired',updated_at:new Date().toISOString() }).eq('user_id',userId).eq('id',actionId).eq('status','pending').select('id').maybeSingle())
    if (replay) return replay
    throw new ApiError(410,'action_expired','This confirmation expired. Ask Stracker AI to prepare the change again.')
  }

  if (!approved) {
    const replay = await returnReplay(() => adminClient.from('ai_pending_actions').update({ status:'cancelled',updated_at:new Date().toISOString() }).eq('user_id',userId).eq('id',actionId).eq('status','pending').select('id').maybeSingle())
    if (replay) return replay
    const message = 'Cancelled. No Stracker data was changed.'
    await adminClient.from('ai_tasks').update({ status:'cancelled',progress:'Cancelled by you.',completed_at:new Date().toISOString() }).eq('user_id',userId).eq('id',pending.task_id)
    await adminClient.from('ai_messages').insert({ user_id:userId,conversation_id:pending.conversation_id,role:'assistant',content:message,provider_id:provider.providerId,model_id:provider.modelId,status:'completed',metadata:{ action_cancelled:true } })
    await adminClient.from('ai_conversations').update({ updated_at:new Date().toISOString() }).eq('user_id',userId).eq('id',pending.conversation_id)
    return { message,taskId:pending.task_id,conversationId:pending.conversation_id }
  }

  const replay = await returnReplay(() => adminClient.from('ai_pending_actions').update({ status:'executing',updated_at:new Date().toISOString() }).eq('user_id',userId).eq('id',actionId).eq('status','pending').select('id').maybeSingle())
  if (replay) return replay
  let result:Awaited<ReturnType<typeof performAction>>
  try {
    result = await performAction(userClient,userId,pending.tool_name as ToolName,pending.input)
  } catch (error) {
    const safe = error instanceof ApiError ? redactPotentialSecrets(error.message) : 'The save request ended before Stracker could confirm its result.'
    const confirmedNoChange = error instanceof ApiError && error.status < 500
    const failureMessage = confirmedNoChange
      ? `I couldn’t save that change. ${safe} No Stracker data was changed.`
      : `I couldn’t verify whether that change finished. ${safe} Refresh Stracker and check the item before trying again; I did not retry it automatically.`
    await Promise.allSettled([
      adminClient.from('ai_pending_actions').update({ status:'failed',result:{ message:failureMessage },updated_at:new Date().toISOString() }).eq('user_id',userId).eq('id',actionId).eq('status','executing'),
      adminClient.from('ai_tasks').update({ status:'failed',progress:'The save result could not be confirmed.',completed_at:new Date().toISOString() }).eq('user_id',userId).eq('id',pending.task_id),
      adminClient.from('ai_action_audit').insert({ user_id:userId,task_id:pending.task_id,provider_id:provider.providerId,model_id:provider.modelId,tool_name:pending.tool_name,action:pending.tool_name,success:false,details:{reason:confirmedNoChange ? 'validated_action_failed' : 'action_result_unverified'} }),
      adminClient.from('ai_messages').insert({ user_id:userId,conversation_id:pending.conversation_id,role:'assistant',content:failureMessage,provider_id:provider.providerId,model_id:provider.modelId,status:'failed',metadata:{action_failed:true,result_unverified:!confirmedNoChange} }),
      adminClient.from('ai_conversations').update({ updated_at:new Date().toISOString() }).eq('user_id',userId).eq('id',pending.conversation_id)
    ])
    throw new ApiError(422,'action_save_failed',failureMessage)
  }

  const audit = { user_id:userId,task_id:pending.task_id,provider_id:provider.providerId,model_id:provider.modelId,tool_name:pending.tool_name,action:pending.tool_name,success:true,details:{record_id:result.result.id ?? result.result.test_id ?? null} }
  await Promise.allSettled([
    adminClient.from('ai_action_audit').insert(audit),
    adminClient.from('ai_pending_actions').update({ status:'completed',result,updated_at:new Date().toISOString() }).eq('user_id',userId).eq('id',actionId).eq('status','executing'),
    adminClient.from('ai_tasks').update({ status:'completed',progress:'Completed.',completed_at:new Date().toISOString(),provider_id:provider.providerId,model_id:provider.modelId }).eq('user_id',userId).eq('id',pending.task_id),
    adminClient.from('ai_messages').insert({ user_id:userId,conversation_id:pending.conversation_id,role:'assistant',content:result.message,provider_id:provider.providerId,model_id:provider.modelId,status:'completed',metadata:{ action_result:result.result } }),
    adminClient.from('ai_conversations').update({ updated_at:new Date().toISOString() }).eq('user_id',userId).eq('id',pending.conversation_id)
  ])
  return { ...result,taskId:pending.task_id,conversationId:pending.conversation_id }
}

export function toolProgress(name: string): string {
  return (descriptions as Record<string,{ progress:string }>)[name]?.progress ?? 'Working with your Stracker data…'
}

export function toolKind(name: string): ToolKind | null {
  return name in descriptions ? descriptions[name as ToolName].kind : null
}
