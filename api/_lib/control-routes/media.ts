import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError, readJson, sendJson } from '../http.js'
import { controlHandler, recordAuditEvent } from '../control.js'
import { MEDIA_BUCKET, MEDIA_LIMITS, MEDIA_EXTENSIONS } from '../../../src/lib/site-content/media.js'

/**
 * POST /api/control/appearance-media  { kind, mime, bytes }
 *
 * Owner-only (aal2). Mints a single-use signed upload URL for a new object under
 * `homepage-media/site/<kind>/<uuid>.<ext>` and records it in public.site_media + audit log.
 * Nothing is published here: the returned public URL only goes live when the owner saves
 * it into a draft and publishes through the usual pipeline. Existing objects are never
 * overwritten (fresh uuid per upload), so earlier versions stay restorable.
 */
const plainText = (max: number) => z.string().max(max).transform(value => value.replace(/\s+/g, ' ').trim()).refine(value => !/[<>]/.test(value) && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127), 'Plain text only.')

const mediaBody = z.object({
  kind: z.enum(['image', 'video']),
  mime: z.string().max(40),
  bytes: z.number().int().positive(),
  name: plainText(80).optional()
}).strict()

const MEDIA_PATH = /^site\/(image|video)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|jpg|png|webp)$/
const updateBody = z.object({ path: z.string().regex(MEDIA_PATH), name: plainText(80).optional(), alt: plainText(200).optional() }).strict()
const deleteBody = z.object({ path: z.string().regex(MEDIA_PATH) }).strict()

type MediaRow = { path: string; kind: 'image' | 'video'; mime: string; bytes: number; created_at: string; name: string | null; alt: string | null }

/**
 * Every place an uploaded file can be referenced: the draft, the live copy and every saved
 * version (so restoring an older version never points at a deleted file).
 */
async function referencedText(context: Parameters<Parameters<typeof controlHandler>[4]>[0]): Promise<{ draft: string; published: string; versions: string }> {
  const [draft, published, versions] = await Promise.all([
    context.admin.from('site_content_draft').select('content, document').limit(1),
    context.admin.from('site_content_published').select('content, document').limit(1),
    context.admin.from('site_content_versions').select('content, document')
  ])
  if (draft.error || published.error || versions.error) throw new ApiError(503, 'media_unavailable', 'The media library is not available right now. Nothing was changed.')
  return { draft: JSON.stringify(draft.data ?? []), published: JSON.stringify(published.data ?? []), versions: JSON.stringify(versions.data ?? []) }
}

/** Objects that actually exist in the bucket (a minted upload URL that was never used leaves no file). */
async function storedPaths(context: Parameters<Parameters<typeof controlHandler>[4]>[0]): Promise<Set<string>> {
  const found = new Set<string>()
  for (const folder of ['site/image', 'site/video']) {
    const { data, error } = await context.admin.storage.from(MEDIA_BUCKET).list(folder, { limit: 1000 })
    if (error) throw new ApiError(503, 'media_unavailable', 'The media library is not available right now.')
    for (const object of data ?? []) found.add(`${folder}/${object.name}`)
  }
  return found
}

export async function mediaUploadHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method === 'GET') return mediaListHandler(req, res)
  if (req.method === 'PATCH') return mediaUpdateHandler(req, res)
  if (req.method === 'DELETE') return mediaDeleteHandler(req, res)
  await controlHandler(req, res, ['POST'], { requireAal2: true, permission: 'appearance.edit' }, async context => {
    const parsed = mediaBody.safeParse(await readJson(req, 2_000))
    if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Describe the file as an image or video with its type and size.')
    const { kind, mime, bytes, name } = parsed.data
    const limits = MEDIA_LIMITS[kind]
    const extension = MEDIA_EXTENSIONS[mime]
    if (!extension || !limits.mimes.includes(mime)) throw new ApiError(415, 'unsupported_media', kind === 'video' ? 'Upload an MP4 video.' : 'Upload a JPEG, PNG or WebP image.')
    if (bytes > limits.maxBytes) throw new ApiError(413, 'media_too_large', `Keep ${kind === 'video' ? 'videos' : 'images'} under ${Math.round(limits.maxBytes / 1_048_576)} MB.`)

    const path = `site/${kind}/${randomUUID()}.${extension}`
    const { data, error } = await context.admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path)
    if (error || !data) throw new ApiError(503, 'media_unavailable', 'Media uploads are not available yet. Nothing was changed.')

    const { error: recordError } = await context.admin.from('site_media').insert({ path, kind, mime, bytes, created_by: context.userId, ...(name ? { name } : {}) })
    if (recordError) throw new ApiError(503, 'media_unavailable', 'Media uploads are not available yet. Nothing was changed.')

    await recordAuditEvent(context.admin, {
      requestId: context.requestId,
      actorId: context.userId,
      actorRole: context.role,
      action: 'appearance.draft_save',
      targetType: 'site_media',
      targetId: path,
      outcome: 'success',
      severity: 'info',
      summary: { kind, mime, bytes }
    })

    const { data: publicData } = context.admin.storage.from(MEDIA_BUCKET).getPublicUrl(path)
    sendJson(res, 200, { ok: true, bucket: MEDIA_BUCKET, path, token: data.token, publicUrl: publicData.publicUrl })
  })
}

/** GET /api/control/appearance-media: the library (uploaded files only), newest first, with where each is used. */
async function mediaListHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET'], { requireAal2: true, permission: 'appearance.edit' }, async context => {
    const { data, error } = await context.admin.from('site_media').select('path, kind, mime, bytes, created_at, name, alt').order('created_at', { ascending: false }).limit(500)
    if (error) throw new ApiError(503, 'media_unavailable', 'The media library is not available right now.')
    const [stored, references] = await Promise.all([storedPaths(context), referencedText(context)])
    const assets = ((data ?? []) as MediaRow[]).filter(row => stored.has(row.path)).map(row => {
      const url = context.admin.storage.from(MEDIA_BUCKET).getPublicUrl(row.path).data.publicUrl
      const marker = row.path
      return {
        path: row.path, kind: row.kind, mime: row.mime, bytes: row.bytes, createdAt: row.created_at, name: row.name ?? '', alt: row.alt ?? '', url,
        usedInDraft: references.draft.includes(marker), usedLive: references.published.includes(marker), usedInVersions: references.versions.includes(marker)
      }
    })
    sendJson(res, 200, { ok: true, assets })
  })
}

/** PATCH { path, name?, alt? }: library metadata only (does not change any page by itself). */
async function mediaUpdateHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['PATCH'], { requireAal2: true, permission: 'appearance.edit' }, async context => {
    const parsed = updateBody.safeParse(await readJson(req, 2_000))
    if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Use plain text: a name up to 80 characters and a description up to 200.')
    const { path, ...patch } = parsed.data
    if (!Object.keys(patch).length) throw new ApiError(400, 'invalid_request', 'Nothing to change.')
    const { data, error } = await context.admin.from('site_media').update(patch).eq('path', path).select('path')
    if (error) throw new ApiError(503, 'media_unavailable', 'The change could not be saved. Nothing was changed.')
    if (!data?.length) throw new ApiError(404, 'media_not_found', 'That file is no longer in the library.')
    await recordAuditEvent(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action: 'appearance.media_update', targetType: 'site_media', targetId: path, outcome: 'success', severity: 'info', summary: { fields: Object.keys(patch) } })
    sendJson(res, 200, { ok: true })
  })
}

/**
 * DELETE { path }: removes a file that nothing uses. Refused (409) while the draft, the live
 * site or any saved version still refers to it, so publishing and restoring can never break.
 */
async function mediaDeleteHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['DELETE'], { requireAal2: true, permission: 'appearance.edit' }, async context => {
    const parsed = deleteBody.safeParse(await readJson(req, 1_000))
    if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Choose a file from the library.')
    const { path } = parsed.data
    const references = await referencedText(context)
    const where = [references.draft.includes(path) && 'the draft', references.published.includes(path) && 'the live site', references.versions.includes(path) && 'a saved version'].filter(Boolean)
    if (where.length) throw new ApiError(409, 'media_in_use', `This file is used in ${where.join(', ')}. Replace it there first; files in saved versions are kept so they can be restored.`)
    const { error: storageError } = await context.admin.storage.from(MEDIA_BUCKET).remove([path])
    if (storageError) throw new ApiError(503, 'media_unavailable', 'The file could not be deleted. Nothing was changed.')
    await context.admin.from('site_media').delete().eq('path', path)
    await recordAuditEvent(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action: 'appearance.media_delete', targetType: 'site_media', targetId: path, outcome: 'success', severity: 'warning' })
    sendJson(res, 200, { ok: true })
  })
}
