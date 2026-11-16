import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError, readJson, sendJson } from '../http.js'
import { controlHandler, recordAuditEvent, requireRecentMfa, type ControlContext } from '../control.js'
import { STUDENT_LAYOUT_SCHEMA_VERSION } from '../../../src/lib/student-layout/registry.js'
import { changedAreas } from '../../../src/lib/student-layout/diff.js'
import { checkStudentLayout, layoutProblemsToErrors, MAX_LAYOUT_BYTES, type StudentLayoutDocument } from '../../../src/lib/student-layout/validate.js'

/**
 * Student Dashboard Editor configuration (separate from the public site's appearance-*).
 *
 * Routes (api/control/operations.ts; rewritten from /api/control/student-layout-*):
 *   GET  sl-state    draft, published layout and recent versions          (appearance.edit, aal2)
 *   PUT  sl-draft    replace the draft with a strictly validated layout   (appearance.edit, aal2, revision check)
 *   POST sl-discard  delete the draft                                     (appearance.edit, aal2)
 *   POST sl-publish  publish the validated draft atomically               (appearance.publish, aal2 + fresh MFA)
 *   POST sl-restore  publish an earlier version as a new version          (appearance.publish, aal2 + fresh MFA)
 *
 * Only presentation is stored. The validator refuses unknown components, unknown keys and
 * anything that names student data (`data_locked`), so a layout can never carry or override
 * dates, marks, scores, names, streaks, counts, timers or other per-student values. Nothing
 * here reads or writes any student table, and no student data is logged.
 */

const VERSION_LIST_LIMIT = 20
const TARGET = { targetType: 'student_layout', targetId: 'workspace' } as const

const draftBody = z.object({
  document: z.unknown(),
  expectedUpdatedAt: z.string().max(40).nullable().optional()
}).strict()
const publishBody = z.object({ note: z.string().trim().max(280, 'Keep the note to 280 characters or fewer.').optional() }).strict()
const restoreBody = z.object({
  version: z.number().int().min(1).max(1_000_000),
  note: z.string().trim().max(280, 'Keep the note to 280 characters or fewer.').optional()
}).strict()

type Row = Record<string, unknown>

export function checkLayoutForWrite(raw: unknown): { ok: true; document: StudentLayoutDocument } | { ok: false; errors: Record<string, string>; dataLocked: boolean } {
  const { document, problems } = checkStudentLayout(raw ?? {})
  if (problems.length || !document) return { ok: false, errors: layoutProblemsToErrors(problems.length ? problems : [{ path: 'layout', code: 'invalid', message: 'The layout is not valid.' }]), dataLocked: problems.some(item => item.code === 'data_locked') }
  return { ok: true, document }
}

export { changedAreas }

async function readDraft(context: ControlContext): Promise<Row | null> {
  const { data, error } = await context.admin.from('student_layout_draft').select('document, schema_version, updated_at, updated_by').eq('id', 1).maybeSingle()
  if (error) throw new ApiError(503, 'layout_unavailable', 'The draft could not be read. Nothing was changed.')
  return (data as Row | null) ?? null
}

async function readPublished(context: ControlContext): Promise<Row | null> {
  const { data, error } = await context.admin.from('student_layout_published').select('document, schema_version, version, published_at, published_by').eq('id', 1).maybeSingle()
  if (error) throw new ApiError(503, 'layout_unavailable', 'The published layout could not be read. Nothing was changed.')
  return (data as Row | null) ?? null
}

const mine = (context: ControlContext, id: unknown) => typeof id === 'string' && id === context.userId
const asLayout = (value: unknown): StudentLayoutDocument | null => (value && typeof value === 'object' ? value as StudentLayoutDocument : null)

export async function studentLayoutStateHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET'], { requireAal2: true, permission: 'appearance.edit' }, async context => {
    const [draft, published] = await Promise.all([readDraft(context), readPublished(context)])
    const { data: versions, error } = await context.admin.from('student_layout_versions')
      .select('version, document, action, restored_from, note, created_at, created_by')
      .order('version', { ascending: false }).limit(VERSION_LIST_LIMIT)
    if (error) throw new ApiError(503, 'layout_unavailable', 'The version history could not be read.')
    sendJson(res, 200, {
      schemaVersion: STUDENT_LAYOUT_SCHEMA_VERSION,
      draft: { exists: Boolean(draft), document: draft ? draft.document : (published?.document ?? null), updatedAt: (draft?.updated_at as string | undefined) ?? null, updatedByYou: mine(context, draft?.updated_by) },
      published: { version: typeof published?.version === 'number' ? published.version : 0, document: published?.document ?? null, publishedAt: (published?.published_at as string | undefined) ?? null, publishedByYou: mine(context, published?.published_by) },
      versions: ((versions ?? []) as Row[]).map(row => ({
        version: row.version, action: row.action, restoredFrom: row.restored_from ?? null, note: typeof row.note === 'string' ? row.note : null,
        createdAt: row.created_at, createdByYou: mine(context, row.created_by), document: row.document
      }))
    })
  })
}

export async function studentLayoutDraftHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['PUT'], { requireAal2: true, permission: 'appearance.edit' }, async context => {
    const parsed = draftBody.safeParse(await readJson(req, MAX_LAYOUT_BYTES + 4_000))
    if (!parsed.success) throw new ApiError(400, 'invalid_request', 'The layout payload has an unexpected shape.')
    const checked = checkLayoutForWrite(parsed.data.document)
    if (!checked.ok) {
      sendJson(res, 422, {
        error: checked.dataLocked ? 'data_locked' : 'invalid_layout',
        message: checked.dataLocked ? 'Live student data (dates, marks, scores, names, streaks, counts…) cannot be set in the layout. Nothing was saved.' : 'Some parts of the layout need attention. Nothing was saved.',
        errors: checked.errors
      })
      return
    }
    const current = await readDraft(context)
    if (parsed.data.expectedUpdatedAt !== undefined) {
      const currentAt = (current?.updated_at as string | undefined) ?? null
      const expected = parsed.data.expectedUpdatedAt
      const same = currentAt === expected || (currentAt !== null && expected !== null && Date.parse(currentAt) === Date.parse(expected))
      if (!same) {
        sendJson(res, 409, { error: 'draft_conflict', message: 'The draft was changed in another tab or by another administrator. Reload to see it; nothing was saved.', currentUpdatedAt: currentAt })
        return
      }
    }
    const updatedAt = new Date().toISOString()
    const { error } = await context.admin.from('student_layout_draft').upsert({ id: 1, document: checked.document, schema_version: STUDENT_LAYOUT_SCHEMA_VERSION, updated_at: updatedAt, updated_by: context.userId }, { onConflict: 'id' })
    if (error) throw new ApiError(503, 'layout_unavailable', 'The draft could not be saved. Nothing was changed; try again.')
    sendJson(res, 200, { ok: true, updatedAt })
  })
}

export async function studentLayoutDiscardHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['POST'], { requireAal2: true, permission: 'appearance.edit' }, async context => {
    const { error } = await context.admin.from('student_layout_draft').delete().eq('id', 1)
    if (error) throw new ApiError(503, 'layout_unavailable', 'The draft could not be discarded. Nothing was changed; try again.')
    sendJson(res, 200, { ok: true })
  })
}

async function commit(context: ControlContext, action: 'publish' | 'restore', document: StudentLayoutDocument, restoredFrom: number | null, note: string): Promise<number> {
  const { data, error } = await context.admin.rpc('student_layout_commit', {
    p_actor: context.userId, p_action: action, p_document: document, p_schema_version: STUDENT_LAYOUT_SCHEMA_VERSION, p_restored_from: restoredFrom, p_note: note
  })
  if (error) {
    const unchanged = error.message?.includes('no_changes')
    await recordAuditEvent(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action: `student_layout.${action}`, ...TARGET, outcome: 'failed', severity: 'warning', errorCode: unchanged ? 'no_changes' : `${action}_failed` })
    if (unchanged) throw new ApiError(409, 'no_changes', 'Student workspaces already show this layout. Nothing was changed.')
    throw new ApiError(503, `${action}_failed`, 'The layout was not published. Student workspaces are unchanged; try again.')
  }
  return typeof data === 'number' ? data : Number(data)
}

export async function studentLayoutPublishHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['POST'], { requireAal2: true, permission: 'appearance.publish' }, async context => {
    const parsed = publishBody.safeParse(await readJson(req, 4_000))
    if (!parsed.success) throw new ApiError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Check the publish note and try again.')
    await requireRecentMfa(context, { action: 'student_layout.publish', ...TARGET })
    const draft = await readDraft(context)
    if (!draft) throw new ApiError(409, 'no_draft', 'There are no unpublished layout changes.')
    const checked = checkLayoutForWrite(draft.document)
    if (!checked.ok) {
      await recordAuditEvent(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action: 'student_layout.publish', ...TARGET, outcome: 'failed', severity: 'warning', errorCode: 'draft_invalid', summary: { fields: Object.keys(checked.errors).length } })
      sendJson(res, 422, { error: checked.dataLocked ? 'data_locked' : 'invalid_layout', message: 'The draft no longer validates. Fix it and save again; nothing was published.', errors: checked.errors })
      return
    }
    const published = await readPublished(context)
    const areas = changedAreas(asLayout(published?.document), checked.document)
    if (published && areas.length === 0) throw new ApiError(409, 'no_changes', 'The draft matches the published layout. Nothing was published.')
    const version = await commit(context, 'publish', checked.document, null, parsed.data.note ?? '')
    const auditRecorded = await recordAuditEvent(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action: 'student_layout.publish', ...TARGET, outcome: 'success', severity: 'notice', summary: { before: published?.version ?? 0, after: version, areas: areas.slice(0, 25) } })
    sendJson(res, 200, { ok: true, version, areas, auditRecorded })
  })
}

export async function studentLayoutRestoreHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['POST'], { requireAal2: true, permission: 'appearance.publish' }, async context => {
    const parsed = restoreBody.safeParse(await readJson(req, 4_000))
    if (!parsed.success) throw new ApiError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Choose a version to restore.')
    await requireRecentMfa(context, { action: 'student_layout.restore', ...TARGET })
    const { data: source, error } = await context.admin.from('student_layout_versions').select('version, document').eq('version', parsed.data.version).maybeSingle()
    if (error) throw new ApiError(503, 'layout_unavailable', 'The version could not be read. Nothing was changed.')
    if (!source) throw new ApiError(404, 'version_not_found', 'That version does not exist.')
    const checked = checkLayoutForWrite((source as Row).document)
    if (!checked.ok) throw new ApiError(422, 'invalid_layout', 'That version no longer validates against the current editor, so it cannot be restored. Nothing was changed.')
    const published = await readPublished(context)
    const areas = changedAreas(asLayout(published?.document), checked.document)
    const version = await commit(context, 'restore', checked.document, parsed.data.version, parsed.data.note ?? '')
    const auditRecorded = await recordAuditEvent(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action: 'student_layout.restore', ...TARGET, outcome: 'success', severity: 'warning', summary: { restored: parsed.data.version, before: published?.version ?? 0, after: version, areas: areas.slice(0, 25) } })
    sendJson(res, 200, { ok: true, version, restored: parsed.data.version, areas, auditRecorded })
  })
}
