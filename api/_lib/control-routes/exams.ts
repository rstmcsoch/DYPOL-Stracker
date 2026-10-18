import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError, readJson, sendJson } from '../http.js'
import { controlHandler, recordAuditEvent } from '../control.js'
import { EXAM_ID_PATTERN, normalizeExam } from '../../../src/lib/exams/catalog.js'
import { normalizeMarkingScheme, validateMarkingScheme } from '../../../src/lib/exams/marking.js'
import { AI_MODEL_PROVIDERS, effectiveModelPreferences, normalizeModelPreferenceOverrides } from '../../../src/lib/ai/model-preferences.js'

/**
 * Owner-only exam catalogue management (aal2), audited.
 *   GET  /api/control/exams                 every exam, including hidden ones
 *   PUT  /api/control/exams  { exam }       add or edit one exam (hidden = soft delete)
 *   POST /api/control/exams  { order }      set display order from a list of ids
 * Students only ever read visible rows (RLS). Hiding never touches student settings, so
 * a student already on a hidden exam keeps it.
 */
const label = (max: number) => z.string().trim().min(1).max(max)
const positiveMark = z.number().finite().positive().max(100_000)
const markingPatternBody = z.object({
  total: positiveMark.nullable(),
  perSubject: z.record(z.string(), positiveMark),
  defaultPerSubject: positiveMark.optional(),
  papers: z.array(z.object({ id: z.string().regex(EXAM_ID_PATTERN), label: label(60), total: positiveMark, perSubject: z.record(z.string(), positiveMark) }).strict()).max(6).optional()
}).strict()
const markingSchemeBody = z.object({
  full: markingPatternBody, other: markingPatternBody,
  combine: z.enum(['sum_subjects', 'sum_papers', 'per_subject']),
  source: label(200), notes: z.string().trim().min(1).max(500).optional()
}).strict()
const aiPreferencesBody = z.object({ aiModelPreferences: z.record(z.string(), z.array(z.string().trim().min(1).max(200)).min(1).max(12)) }).strict()
const examBody = z.object({
  exam: z.object({
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
    hidden: z.boolean()
  }).strict()
}).strict()
const orderBody = z.object({ order: z.array(z.string().regex(EXAM_ID_PATTERN)).min(1).max(500) }).strict()
const TARGET = 'exam_catalog'

export async function examsHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET', 'PUT', 'POST'], { requireAal2: true }, async context => {
    const audit = (action: string, targetId: string, outcome: 'success' | 'failed', summary?: Record<string, string | number | boolean>) =>
      recordAuditEvent(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action, targetType: TARGET, targetId, outcome, severity: outcome === 'success' ? 'notice' : 'warning', summary })

    if (req.method === 'GET') {
      const { data, error } = await context.admin.from('exam_catalog').select('*').order('sort_order').order('name')
      if (error) throw new ApiError(503, 'exams_unavailable', 'The exam list could not be loaded. Try again.')
      // Owner AI model defaults are server-side only. A missing table/row uses built-in lists.
      const { data: preferenceRow } = await context.admin.from('ai_model_preferences').select('preferences').eq('id', 1).maybeSingle()
      sendJson(res, 200, { ok: true, exams: (data ?? []).map(normalizeExam).filter(Boolean), aiModelPreferences: effectiveModelPreferences(preferenceRow?.preferences), aiModelPreferencesStored: Boolean(preferenceRow) })
      return
    }

    if (req.method === 'PUT') {
      const rawBody: unknown = await readJson(req, 24_000)
      if (rawBody && typeof rawBody === 'object' && 'aiModelPreferences' in rawBody) {
        const parsedPreferences = aiPreferencesBody.safeParse(rawBody)
        if (!parsedPreferences.success) throw new ApiError(400, 'invalid_request', 'Check the AI model preference lists.')
        const providers = Object.keys(parsedPreferences.data.aiModelPreferences)
        if (providers.some(provider => !(AI_MODEL_PROVIDERS as string[]).includes(provider))) throw new ApiError(400, 'invalid_request', 'AI model preferences can only be set for Gemini, OpenAI, Anthropic, DeepSeek and Qwen.')
        const overrides = normalizeModelPreferenceOverrides(parsedPreferences.data.aiModelPreferences)
        if (providers.some(provider => !(overrides as Record<string, string[] | undefined>)[provider]?.length)) throw new ApiError(400, 'invalid_request', 'Each AI model list needs 1–12 model IDs or patterns using only letters, numbers, dots, dashes, underscores, slashes or *.')
        const { error: preferenceError } = await context.admin.from('ai_model_preferences').upsert({ id: 1, preferences: overrides, updated_by: context.userId, updated_at: new Date().toISOString() }, { onConflict: 'id' })
        if (preferenceError) {
          await recordAuditEvent(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action: 'ai.model_preferences.update', targetType: 'ai_model_preferences', targetId: 'providers', outcome: 'failed', severity: 'warning', summary: { providers: providers.length } })
          throw new ApiError(503, 'ai_preferences_save_failed', 'The AI model lists were not saved. Nothing changed.')
        }
        const auditRecorded = await recordAuditEvent(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action: 'ai.model_preferences.update', targetType: 'ai_model_preferences', targetId: 'providers', outcome: 'success', severity: 'notice', summary: { providers: providers.length } })
        sendJson(res, 200, { ok: true, auditRecorded, aiModelPreferences: effectiveModelPreferences(overrides) })
        return
      }
      const parsed = examBody.safeParse(rawBody)
      if (!parsed.success) throw new ApiError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Check the exam details.')
      const input = parsed.data.exam
      if (input.marking_scheme) {
        const markingIssues = validateMarkingScheme(input.marking_scheme)
        if (markingIssues.length) throw new ApiError(400, 'invalid_marking_scheme', markingIssues[0] ?? 'Check the marking defaults.')
      }
      const { data: existing } = await context.admin.from('exam_catalog').select('id, hidden, sort_order, marking_scheme').eq('id', input.id).maybeSingle()
      let sortOrder = input.sort_order ?? (existing?.sort_order as number | undefined)
      if (sortOrder === undefined) {
        const { data: last } = await context.admin.from('exam_catalog').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle()
        sortOrder = ((last?.sort_order as number | undefined) ?? 0) + 10
      }
      const row = {
        ...input,
        years: [...new Set(input.years)].sort((a, b) => a - b),
        sessions: [...new Set(input.sessions)],
        boards: [...new Set(input.boards)],
        ...(input.subjects ? { subjects: [...new Set(input.subjects)] } : {}),
        ...(input.marking_scheme !== undefined ? { marking_scheme: input.marking_scheme ? normalizeMarkingScheme(input.marking_scheme) : null } : {}),
        sort_order: sortOrder,
        updated_at: new Date().toISOString(),
        updated_by: context.userId
      }
      const { error } = await context.admin.from('exam_catalog').upsert(row, { onConflict: 'id' })
      const action = !existing ? 'exam.create' : existing.hidden !== input.hidden ? (input.hidden ? 'exam.hide' : 'exam.show') : 'exam.update'
      if (error) {
        await audit(action, input.id, 'failed')
        throw new ApiError(503, 'exam_save_failed', 'The exam was not saved. Nothing changed.')
      }
      const auditRecorded = await audit(action, input.id, 'success', { name: input.name, hidden: input.hidden, marking: input.marking_scheme === undefined ? 'unchanged' : input.marking_scheme === null ? 'built-in fallback' : input.marking_scheme.combine, fullTotal: input.marking_scheme?.full.total ?? 0 })
      sendJson(res, 200, { ok: true, auditRecorded })
      return
    }

    const parsed = orderBody.safeParse(await readJson(req, 20_000))
    if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Send the exam ids in their new order.')
    const ids = [...new Set(parsed.data.order)]
    const { data: rows, error: readError } = await context.admin.from('exam_catalog').select('id')
    if (readError) throw new ApiError(503, 'exams_unavailable', 'The exam list could not be loaded. Nothing changed.')
    const known = new Set((rows ?? []).map(row => String(row.id)))
    if (ids.some(id => !known.has(id))) throw new ApiError(400, 'unknown_exam', 'The order includes an exam that does not exist. Reload and try again.')
    const now = new Date().toISOString()
    for (const [index, id] of ids.entries()) {
      const { error } = await context.admin.from('exam_catalog').update({ sort_order: (index + 1) * 10, updated_at: now, updated_by: context.userId }).eq('id', id)
      if (error) {
        await audit('exam.reorder', 'catalog', 'failed')
        throw new ApiError(503, 'exam_order_failed', 'The order was only partly saved. Reload and try again.')
      }
    }
    const auditRecorded = await audit('exam.reorder', 'catalog', 'success', { count: ids.length })
    sendJson(res, 200, { ok: true, auditRecorded })
  })
}
