import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError, readJson, sendJson } from '../http.js'
import { controlHandler, recordAuditEvent } from '../control.js'
import { EXAM_ID_PATTERN, normalizeExam } from '../../../src/lib/exams/catalog.js'

/**
 * Owner-only exam catalogue management (aal2), audited.
 *   GET  /api/control/exams                 every exam, including hidden ones
 *   PUT  /api/control/exams  { exam }       add or edit one exam (hidden = soft delete)
 *   POST /api/control/exams  { order }      set display order from a list of ids
 * Students only ever read visible rows (RLS). Hiding never touches student settings, so
 * a student already on a hidden exam keeps it.
 */
const label = (max: number) => z.string().trim().min(1).max(max)
const examBody = z.object({
  exam: z.object({
    id: z.string().regex(EXAM_ID_PATTERN, 'Use 2–40 lowercase letters, numbers or dashes for the id.'),
    name: label(80),
    category: label(40),
    years: z.array(z.number().int().min(2020).max(2100)).max(12),
    sessions: z.array(label(40)).max(24),
    boards: z.array(label(40)).max(24),
    boards_addon: z.boolean(),
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
      sendJson(res, 200, { ok: true, exams: (data ?? []).map(normalizeExam).filter(Boolean) })
      return
    }

    if (req.method === 'PUT') {
      const parsed = examBody.safeParse(await readJson(req, 8_000))
      if (!parsed.success) throw new ApiError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Check the exam details.')
      const input = parsed.data.exam
      const { data: existing } = await context.admin.from('exam_catalog').select('id, hidden, sort_order').eq('id', input.id).maybeSingle()
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
      const auditRecorded = await audit(action, input.id, 'success', { name: input.name, hidden: input.hidden })
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
