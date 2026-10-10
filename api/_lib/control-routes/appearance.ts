import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError, readJson, sendJson } from '../http.js'
import { controlHandler, recordAuditEvent, requireRecentMfa, type ControlContext } from '../control.js'
import { SITE_CONTENT_SCHEMA_VERSION } from '../../../src/lib/site-content/registry.js'
import {
  diffSiteValues,
  resolveSiteValues,
  sanitizeStoredOverrides,
  validateOverrides,
  type SiteOverrides
} from '../../../src/lib/site-content/content.js'

/**
 * Owner-only management of website and user-panel copy.
 *
 * Routes (dispatched by api/control/appearance.ts; rewritten from /api/control/appearance-*):
 *   GET  state     draft, published and recent versions (owner only; drafts never go public)
 *   PUT  draft     replace the unpublished draft with validated sparse overrides
 *   POST discard   delete the draft so the published copy is shown again
 *   POST publish   publish the validated draft atomically      (aal2 + fresh TOTP)
 *   POST restore   publish an earlier version as a new version (aal2 + fresh TOTP)
 *
 * Writes never touch accounts, roles, study data, the audit trail, or code. A publish or
 * restore only changes the three site_content_* tables through site_content_commit.
 */

const DRAFT_BODY_LIMIT = 64_000
const VERSION_LIST_LIMIT = 20

const publishBody = z.object({
  note: z.string().trim().max(280, 'Keep the note to 280 characters or fewer.').optional()
}).strict()

const restoreBody = z.object({
  version: z.number().int().min(1).max(1_000_000),
  note: z.string().trim().max(280, 'Keep the note to 280 characters or fewer.').optional()
}).strict()

const draftBody = z.object({
  overrides: z.record(z.string().max(120), z.unknown())
}).strict()

const SITE_TARGET = { targetType: 'site_content', targetId: 'site' } as const

type Row = Record<string, unknown>

function asOverrides(value: unknown): SiteOverrides {
  return sanitizeStoredOverrides(value)
}

function countChanges(before: SiteOverrides, after: SiteOverrides): number {
  return diffSiteValues(resolveSiteValues(before), resolveSiteValues(after)).length
}

async function readDraft(context: ControlContext): Promise<Row | null> {
  const { data, error } = await context.admin
    .from('site_content_draft')
    .select('content, schema_version, updated_at, updated_by')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new ApiError(503, 'content_unavailable', 'The draft could not be read. Nothing was changed.')
  return (data as Row | null) ?? null
}

async function readPublished(context: ControlContext): Promise<Row | null> {
  const { data, error } = await context.admin
    .from('site_content_published')
    .select('content, schema_version, version, published_at, published_by')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new ApiError(503, 'content_unavailable', 'The published copy could not be read. Nothing was changed.')
  return (data as Row | null) ?? null
}

async function readVersion(context: ControlContext, version: number): Promise<Row | null> {
  const { data, error } = await context.admin
    .from('site_content_versions')
    .select('version, content, action, restored_from, note, created_at')
    .eq('version', version)
    .maybeSingle()
  if (error) throw new ApiError(503, 'content_unavailable', 'The version could not be read. Nothing was changed.')
  return (data as Row | null) ?? null
}

function ownerFlag(context: ControlContext, userId: unknown): boolean {
  return typeof userId === 'string' && userId === context.userId
}

/** GET /api/control/appearance?route=state */
export async function stateHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET'], { requireAal2: true }, async context => {
    const [draft, published] = await Promise.all([readDraft(context), readPublished(context)])
    const { data: versions, error } = await context.admin
      .from('site_content_versions')
      .select('version, action, restored_from, note, created_at, created_by, content')
      .order('version', { ascending: false })
      .limit(VERSION_LIST_LIMIT)
    if (error) throw new ApiError(503, 'content_unavailable', 'The version history could not be read.')

    sendJson(res, 200, {
      schemaVersion: SITE_CONTENT_SCHEMA_VERSION,
      draft: {
        exists: Boolean(draft),
        overrides: asOverrides(draft?.content),
        updatedAt: (draft?.updated_at as string | undefined) ?? null,
        updatedByYou: ownerFlag(context, draft?.updated_by)
      },
      published: {
        version: typeof published?.version === 'number' ? published.version : 0,
        overrides: asOverrides(published?.content),
        publishedAt: (published?.published_at as string | undefined) ?? null,
        publishedByYou: ownerFlag(context, published?.published_by)
      },
      versions: ((versions ?? []) as Row[]).map(row => ({
        version: row.version,
        action: row.action,
        restoredFrom: row.restored_from ?? null,
        note: typeof row.note === 'string' ? row.note : null,
        createdAt: row.created_at,
        createdByYou: ownerFlag(context, row.created_by),
        overrides: asOverrides(row.content)
      }))
    })
  })
}

/** PUT /api/control/appearance?route=draft  { overrides } */
export async function draftHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['PUT'], { requireAal2: true }, async context => {
    const parsed = draftBody.safeParse(await readJson(req, DRAFT_BODY_LIMIT))
    if (!parsed.success) throw new ApiError(400, 'invalid_request', 'The content payload has an unexpected shape.')
    const checked = validateOverrides(parsed.data.overrides)
    if (!checked.ok) {
      // Field-level messages are returned so the editor can show them next to each input.
      sendJson(res, 422, { error: 'invalid_content', message: 'Some fields need attention. Nothing was saved.', errors: checked.errors })
      return
    }

    const updatedAt = new Date().toISOString()
    const { error } = await context.admin.from('site_content_draft').upsert({
      id: 1,
      content: checked.overrides,
      schema_version: SITE_CONTENT_SCHEMA_VERSION,
      updated_at: updatedAt,
      updated_by: context.userId
    }, { onConflict: 'id' })
    if (error) throw new ApiError(503, 'content_unavailable', 'The draft could not be saved. Nothing was changed; try again.')

    sendJson(res, 200, { ok: true, updatedAt, fieldsChanged: Object.keys(checked.overrides).length })
  })
}

/** POST /api/control/appearance?route=discard — drafts are removed; the published copy stays live. */
export async function discardHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['POST'], { requireAal2: true }, async context => {
    const { error } = await context.admin.from('site_content_draft').delete().eq('id', 1)
    if (error) throw new ApiError(503, 'content_unavailable', 'The draft could not be discarded. Nothing was changed; try again.')
    sendJson(res, 200, { ok: true })
  })
}

/** POST /api/control/appearance?route=publish  { note? } */
export async function publishHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['POST'], { requireAal2: true }, async context => {
    const parsed = publishBody.safeParse(await readJson(req, 4_000))
    if (!parsed.success) throw new ApiError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Check the publish note and try again.')
    await requireRecentMfa(context, { action: 'content.publish', ...SITE_TARGET })

    const draft = await readDraft(context)
    if (!draft) throw new ApiError(409, 'no_draft', 'There are no unpublished changes to publish.')
    const checked = validateOverrides(draft.content)
    if (!checked.ok) {
      await recordAuditEvent(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action: 'content.publish', ...SITE_TARGET, outcome: 'failed', severity: 'warning', errorCode: 'draft_invalid', summary: { fields: Object.keys(checked.errors).length } })
      sendJson(res, 422, { error: 'invalid_content', message: 'The draft has fields that no longer validate. Fix them and save again; nothing was published.', errors: checked.errors })
      return
    }

    const published = await readPublished(context)
    const before = asOverrides(published?.content)
    const changed = countChanges(before, checked.overrides)
    if (changed === 0) throw new ApiError(409, 'no_changes', 'The draft is identical to the published copy. Nothing was published.')

    const { data: newVersion, error } = await context.admin.rpc('site_content_commit', {
      p_actor: context.userId,
      p_action: 'publish',
      p_content: checked.overrides,
      p_schema_version: SITE_CONTENT_SCHEMA_VERSION,
      p_restored_from: null,
      p_note: parsed.data.note ?? ''
    })
    if (error) {
      const unchanged = error.message?.includes('no_changes')
      await recordAuditEvent(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action: 'content.publish', ...SITE_TARGET, outcome: 'failed', severity: 'warning', errorCode: unchanged ? 'no_changes' : 'publish_failed' })
      if (unchanged) throw new ApiError(409, 'no_changes', 'The draft is identical to the published copy. Nothing was published.')
      throw new ApiError(503, 'publish_failed', 'The changes were not published. The live site is unchanged; try again.')
    }

    const version = typeof newVersion === 'number' ? newVersion : Number(newVersion)
    const auditRecorded = await recordAuditEvent(context.admin, {
      requestId: context.requestId,
      actorId: context.userId,
      actorRole: context.role,
      action: 'content.publish',
      ...SITE_TARGET,
      outcome: 'success',
      severity: 'notice',
      summary: { before: published?.version ?? 0, after: version, changed }
    })
    sendJson(res, 200, { ok: true, version, changed, publishedAt: new Date().toISOString(), auditRecorded })
  })
}

/** POST /api/control/appearance?route=restore  { version, note? } */
export async function restoreHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['POST'], { requireAal2: true }, async context => {
    const parsed = restoreBody.safeParse(await readJson(req, 4_000))
    if (!parsed.success) throw new ApiError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Choose a version to restore.')
    await requireRecentMfa(context, { action: 'content.restore', ...SITE_TARGET })

    const source = await readVersion(context, parsed.data.version)
    if (!source) throw new ApiError(404, 'version_not_found', 'That version does not exist.')
    const checked = validateOverrides(source.content)
    if (!checked.ok) throw new ApiError(422, 'invalid_content', 'That version no longer validates against the current editor, so it cannot be restored. Nothing was changed.')

    const published = await readPublished(context)
    const before = asOverrides(published?.content)
    const changed = countChanges(before, checked.overrides)
    if (changed === 0 && (published?.version ?? 0) !== 0) {
      throw new ApiError(409, 'no_changes', 'The live site already shows this version. Nothing was changed.')
    }

    const { data: newVersion, error } = await context.admin.rpc('site_content_commit', {
      p_actor: context.userId,
      p_action: 'restore',
      p_content: checked.overrides,
      p_schema_version: SITE_CONTENT_SCHEMA_VERSION,
      p_restored_from: parsed.data.version,
      p_note: parsed.data.note ?? ''
    })
    if (error) {
      const unchanged = error.message?.includes('no_changes')
      await recordAuditEvent(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action: 'content.restore', ...SITE_TARGET, outcome: 'failed', severity: 'warning', errorCode: unchanged ? 'no_changes' : 'restore_failed', summary: { restored: parsed.data.version } })
      if (unchanged) throw new ApiError(409, 'no_changes', 'The live site already shows this version. Nothing was changed.')
      throw new ApiError(503, 'restore_failed', 'The version was not restored. The live site is unchanged; try again.')
    }

    const version = typeof newVersion === 'number' ? newVersion : Number(newVersion)
    const auditRecorded = await recordAuditEvent(context.admin, {
      requestId: context.requestId,
      actorId: context.userId,
      actorRole: context.role,
      action: 'content.restore',
      ...SITE_TARGET,
      outcome: 'success',
      severity: 'warning',
      summary: { restored: parsed.data.version, before: published?.version ?? 0, after: version, changed }
    })
    sendJson(res, 200, { ok: true, version, restored: parsed.data.version, changed, auditRecorded })
  })
}
