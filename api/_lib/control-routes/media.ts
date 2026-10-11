import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError, readJson, sendJson } from '../http.js'
import { controlHandler } from '../control.js'
import { MEDIA_BUCKET, MEDIA_LIMITS, MEDIA_EXTENSIONS } from '../../../src/lib/site-content/media.js'

/**
 * POST /api/control/appearance-media  { kind, mime, bytes }
 *
 * Owner-only (aal2). Mints a single-use signed upload URL for a new object under
 * `homepage-media/site/<kind>/<uuid>.<ext>` and records it in public.site_media.
 * Nothing is published here: the returned public URL only goes live when the owner saves
 * it into a draft and publishes through the usual pipeline. Existing objects are never
 * overwritten (fresh uuid per upload), so earlier versions stay restorable.
 */
const mediaBody = z.object({
  kind: z.enum(['image', 'video']),
  mime: z.string().max(40),
  bytes: z.number().int().positive()
}).strict()

export async function mediaUploadHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['POST'], { requireAal2: true }, async context => {
    const parsed = mediaBody.safeParse(await readJson(req, 2_000))
    if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Describe the file as an image or video with its type and size.')
    const { kind, mime, bytes } = parsed.data
    const limits = MEDIA_LIMITS[kind]
    const extension = MEDIA_EXTENSIONS[mime]
    if (!extension || !limits.mimes.includes(mime)) throw new ApiError(415, 'unsupported_media', kind === 'video' ? 'Upload an MP4 video.' : 'Upload a JPEG, PNG or WebP image.')
    if (bytes > limits.maxBytes) throw new ApiError(413, 'media_too_large', `Keep ${kind === 'video' ? 'videos' : 'images'} under ${Math.round(limits.maxBytes / 1_048_576)} MB.`)

    const path = `site/${kind}/${randomUUID()}.${extension}`
    const { data, error } = await context.admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path)
    if (error || !data) throw new ApiError(503, 'media_unavailable', 'Media uploads are not available yet. Nothing was changed.')

    const { error: recordError } = await context.admin.from('site_media').insert({ path, kind, mime, bytes, created_by: context.userId })
    if (recordError) throw new ApiError(503, 'media_unavailable', 'Media uploads are not available yet. Nothing was changed.')

    const { data: publicData } = context.admin.storage.from(MEDIA_BUCKET).getPublicUrl(path)
    sendJson(res, 200, { ok: true, bucket: MEDIA_BUCKET, path, token: data.token, publicUrl: publicData.publicUrl })
  })
}
