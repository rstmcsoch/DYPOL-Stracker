import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { EXAM_ID_PATTERN, normalizeExam, type ExamDefinition } from '../../../src/lib/exams/catalog.js'
import { normalizeMarkingScheme, validateMarkingScheme } from '../../../src/lib/exams/marking.js'
import { AI_MODEL_PROVIDERS, effectiveModelPreferences, normalizeModelPreferenceOverrides } from '../../../src/lib/ai/model-preferences.js'
import { ApiError } from '../http.js'

const label = (max: number) => z.string().trim().min(1).max(max)
const positiveMark = z.number().finite().positive().max(100_000)
const markingPatternBody = z.object({
  total: positiveMark.nullable(),
  perSubject: z.record(z.string(), positiveMark),
  defaultPerSubject: positiveMark.optional(),
  papers: z.array(z.object({ id: z.string().regex(EXAM_ID_PATTERN), label: label(60), total: positiveMark, perSubject: z.record(z.string(), positiveMark) }).strict()).max(6).optional()
}).strict()
export const markingSchemeBody = z.object({
  full: markingPatternBody, other: markingPatternBody,
  combine: z.enum(['sum_subjects', 'sum_papers', 'per_subject']),
  source: label(200), notes: z.string().trim().min(1).max(500).optional()
}).strict()
export const examInputSchema = z.object({
  id: z.string().regex(EXAM_ID_PATTERN, 'Use 2–40 lowercase letters, numbers or dashes for the id.'),
  name: label(80),
  category: label(40),
  years: z.array(z.number().int().min(2020).max(2100)).max(12),
  sessions: z.array(label(40)).max(24),
  boards: z.array(label(40)).max(24),
  boards_addon: z.boolean(),
  subjects: z.array(label(60)).max(30).optional(),
  marking_scheme: markingSchemeBody.nullable().optional(),
  session_label: z.string().trim().max(30).optional(),
  sort_order: z.number().int().min(0).max(100_000).optional(),
  hidden: z.boolean().optional()
}).strict()
const examIdSchema = z.string().regex(EXAM_ID_PATTERN)
const aiPreferencesSchema = z.record(z.string(), z.array(z.string().trim().min(1).max(200)).min(1).max(12))

function parseExam(input: unknown) {
  const parsed = examInputSchema.safeParse(input)
  if (!parsed.success) throw new ApiError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Check the exam details.')
  if (parsed.data.marking_scheme) {
    const issues = validateMarkingScheme(parsed.data.marking_scheme)
    if (issues.length) throw new ApiError(400, 'invalid_marking_scheme', issues[0] ?? 'Check the marking defaults.')
  }
  return parsed.data
}

async function loadExamRow(admin: SupabaseClient, examId: string) {
  const id = examIdSchema.parse(examId)
  const { data, error } = await admin.from('exam_catalog').select('*').eq('id', id).maybeSingle()
  if (error) throw new ApiError(503, 'exams_unavailable', 'The exam catalogue could not be loaded. Try again shortly.')
  if (!data) throw new ApiError(404, 'not_found', 'That exam was not found in the catalogue.')
  return data as Record<string, unknown>
}

export async function countExamUse(admin: SupabaseClient, examId: string): Promise<number> {
  const { count, error } = await admin.from('app_settings').select('user_id', { count: 'exact', head: true }).eq('exam_id', examId)
  if (error) return 0
  return count ?? 0
}

export async function listExamCatalogue(admin: SupabaseClient) {
  const { data, error } = await admin.from('exam_catalog').select('*').order('sort_order').order('name')
  if (error) throw new ApiError(503, 'exams_unavailable', 'The exam catalogue could not be loaded. Try again shortly.')
  const exams = (data ?? []).map(normalizeExam).filter(Boolean) as ExamDefinition[]
  return { exams, total: exams.length, includesHidden: true }
}

export async function getExamDefinition(admin: SupabaseClient, examId: string) {
  const row = await loadExamRow(admin, examId)
  const exam = normalizeExam(row)
  if (!exam) throw new ApiError(503, 'exams_unavailable', 'That exam could not be read because the stored row is incomplete.')
  const inUseCount = await countExamUse(admin, exam.id)
  return { exam, inUseCount }
}

function examRow(input: z.infer<typeof examInputSchema>, sortOrder: number, existingMarking: unknown) {
  return {
    id: input.id,
    name: input.name,
    category: input.category,
    years: [...new Set(input.years)].sort((a, b) => a - b),
    sessions: [...new Set(input.sessions)],
    boards: [...new Set(input.boards)],
    boards_addon: input.boards_addon,
    hidden: input.hidden ?? false,
    ...(input.subjects ? { subjects: [...new Set(input.subjects)] } : {}),
    ...(input.marking_scheme !== undefined ? { marking_scheme: input.marking_scheme ? normalizeMarkingScheme(input.marking_scheme) : null } : existingMarking !== undefined ? { marking_scheme: existingMarking } : {}),
    ...(input.session_label !== undefined ? { session_label: input.session_label } : {}),
    sort_order: sortOrder,
    updated_at: new Date().toISOString(),
    updated_by: null
  }
}

async function nextSortOrder(admin: SupabaseClient) {
  const { data: last } = await admin.from('exam_catalog').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle()
  return ((last?.sort_order as number | undefined) ?? 0) + 10
}

export async function createExam(admin: SupabaseClient, input: unknown) {
  const body = parseExam(input)
  const { data: existing } = await admin.from('exam_catalog').select('id').eq('id', body.id).maybeSingle()
  if (existing) throw new ApiError(409, 'conflict', 'An exam with that id already exists. Use update_exam to change it.')
  const row = examRow(body, body.sort_order ?? await nextSortOrder(admin), undefined)
  const { data, error } = await admin.from('exam_catalog').insert(row).select('*').maybeSingle()
  if (error || !data) throw new ApiError(503, 'exam_save_failed', 'The exam was not saved. Nothing changed.')
  return { ok: true, exam: normalizeExam(data) }
}

export async function updateExam(admin: SupabaseClient, input: unknown) {
  const body = parseExam(input)
  const existing = await loadExamRow(admin, body.id)
  const row = examRow(body, body.sort_order ?? (existing.sort_order as number), existing.marking_scheme)
  const { data, error } = await admin.from('exam_catalog').update(row).eq('id', body.id).select('*').maybeSingle()
  if (error || !data) throw new ApiError(503, 'exam_save_failed', 'The exam was not saved. Nothing changed.')
  return { ok: true, exam: normalizeExam(data) }
}

export async function hideExam(admin: SupabaseClient, examId: string, hidden: boolean) {
  const existing = await loadExamRow(admin, examId)
  const inUseCount = await countExamUse(admin, String(existing.id))
  const { data, error } = await admin.from('exam_catalog').update({ hidden, updated_at: new Date().toISOString(), updated_by: null }).eq('id', existing.id).select('*').maybeSingle()
  if (error || !data) throw new ApiError(503, 'exam_save_failed', hidden ? 'The exam could not be hidden. Nothing changed.' : 'The exam could not be restored. Nothing changed.')
  return { ok: true, exam: normalizeExam(data), hidden, inUseCount, physicallyDeleted: false }
}

export async function reorderExams(admin: SupabaseClient, order: unknown) {
  const parsed = z.array(z.string().regex(EXAM_ID_PATTERN)).min(1).max(500).safeParse(order)
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Send the exam ids in their new order.')
  const ids = [...new Set(parsed.data)]
  const { data: rows, error: readError } = await admin.from('exam_catalog').select('id')
  if (readError) throw new ApiError(503, 'exams_unavailable', 'The exam list could not be loaded. Nothing changed.')
  const known = new Set((rows ?? []).map(row => String(row.id)))
  if (ids.some(id => !known.has(id))) throw new ApiError(400, 'unknown_exam', 'The order includes an exam that does not exist. Reload and try again.')
  const now = new Date().toISOString()
  const results = await Promise.all(ids.map((id, index) =>
    admin.from('exam_catalog').update({ sort_order: (index + 1) * 10, updated_at: now, updated_by: null }).eq('id', id)))
  if (results.some(result => result.error)) throw new ApiError(503, 'exam_order_failed', 'The order was only partly saved. Reload and try again.')
  return { ok: true, count: ids.length, order: ids }
}

export async function updateExamMarkingScheme(admin: SupabaseClient, examId: string, markingScheme: unknown) {
  const existing = await loadExamRow(admin, examId)
  let normalized = null
  if (markingScheme !== null) {
    const parsed = markingSchemeBody.safeParse(markingScheme)
    if (!parsed.success) throw new ApiError(400, 'invalid_marking_scheme', parsed.error.issues[0]?.message ?? 'Check the marking defaults.')
    const issues = validateMarkingScheme(parsed.data)
    if (issues.length) throw new ApiError(400, 'invalid_marking_scheme', issues[0] ?? 'Check the marking defaults.')
    normalized = normalizeMarkingScheme(parsed.data)
  }
  const { data, error } = await admin.from('exam_catalog').update({
    marking_scheme: normalized, updated_at: new Date().toISOString(), updated_by: null
  }).eq('id', existing.id).select('*').maybeSingle()
  if (error || !data) throw new ApiError(503, 'exam_save_failed', 'The marking scheme was not saved. Nothing changed.')
  return { ok: true, exam: normalizeExam(data), marking: normalized ? 'custom' : 'built-in fallback' }
}

export async function getExamAiModelPreferences(admin: SupabaseClient) {
  const { data, error } = await admin.from('ai_model_preferences').select('preferences').eq('id', 1).maybeSingle()
  if (error) throw new ApiError(503, 'ai_preferences_unavailable', 'AI model preferences could not be loaded. Try again shortly.')
  return { aiModelPreferences: effectiveModelPreferences(data?.preferences), stored: Boolean(data) }
}

export async function updateExamAiModelPreferences(admin: SupabaseClient, preferences: unknown) {
  const parsed = aiPreferencesSchema.safeParse(preferences)
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Check the AI model preference lists.')
  const providers = Object.keys(parsed.data)
  if (providers.some(provider => !(AI_MODEL_PROVIDERS as string[]).includes(provider))) {
    throw new ApiError(400, 'invalid_request', 'AI model preferences can only be set for Gemini, OpenAI, Anthropic, DeepSeek and Qwen.')
  }
  const overrides = normalizeModelPreferenceOverrides(parsed.data)
  if (providers.some(provider => !(overrides as Record<string, string[] | undefined>)[provider]?.length)) {
    throw new ApiError(400, 'invalid_request', 'Each AI model list needs 1–12 model IDs or patterns using only letters, numbers, dots, dashes, underscores, slashes or *.')
  }
  const { error } = await admin.from('ai_model_preferences').upsert({
    id: 1, preferences: overrides, updated_by: null, updated_at: new Date().toISOString()
  }, { onConflict: 'id' })
  if (error) throw new ApiError(503, 'ai_preferences_save_failed', 'The AI model lists were not saved. Nothing changed.')
  return { ok: true, aiModelPreferences: effectiveModelPreferences(overrides) }
}

export { examIdSchema }
