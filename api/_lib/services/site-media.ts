import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../http.js'
import { MEDIA_BUCKET, MEDIA_EXTENSIONS, MEDIA_LIMITS, type MediaKind } from '../../../src/lib/site-content/media.js'

const MEDIA_PATH = /^site\/(image|video)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|jpg|png|webp)$/
const plainText = (max: number) => z.string().max(max).transform(value => value.replace(/\s+/g, ' ').trim()).refine(value => !/[<>]/.test(value) && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127), 'Plain text only.')

const mediaPathSchema = z.string().regex(MEDIA_PATH)
const updateInput = z.object({ path: mediaPathSchema, name: plainText(80).optional(), alt: plainText(200).optional() }).strict()
const listInput = z.object({
  q: z.string().trim().max(80).optional(),
  kind: z.enum(['image', 'video', 'all']).optional(),
  usage: z.enum(['all', 'unused', 'in_use']).optional()
}).strict()

const MAX_INLINE_BYTES = 180_000
const FORBIDDEN_UPLOAD_HINT = 'Upload a JPEG, PNG or WebP image, or an MP4 video. Executable and other file types are not accepted.'

type MediaRow = { path: string; kind: 'image' | 'video'; mime: string; bytes: number; created_at: string; name: string | null; alt: string | null }

export type MediaUsage = {
  usedInDraft: boolean
  usedLive: boolean
  usedInVersions: boolean
  used: boolean
  usedIn: string[]
}

export type MediaAsset = MediaRow & MediaUsage & { url: string; name: string; alt: string; createdAt: string }

async function referencedText(admin: SupabaseClient): Promise<{ draft: string; published: string; versions: string }> {
  const [draft, published, versions] = await Promise.all([
    admin.from('site_content_draft').select('content, document').limit(1),
    admin.from('site_content_published').select('content, document').limit(1),
    admin.from('site_content_versions').select('content, document')
  ])
  if (draft.error || published.error || versions.error) throw new ApiError(503, 'media_unavailable', 'The media library is not available right now. Nothing was changed.')
  return { draft: JSON.stringify(draft.data ?? []), published: JSON.stringify(published.data ?? []), versions: JSON.stringify(versions.data ?? []) }
}

async function storedPaths(admin: SupabaseClient): Promise<Set<string>> {
  const found = new Set<string>()
  for (const folder of ['site/image', 'site/video']) {
    const { data, error } = await admin.storage.from(MEDIA_BUCKET).list(folder, { limit: 1000 })
    if (error) throw new ApiError(503, 'media_unavailable', 'The media library is not available right now.')
    for (const object of data ?? []) found.add(`${folder}/${object.name}`)
  }
  return found
}

function usageFrom(path: string, references: { draft: string; published: string; versions: string }): MediaUsage {
  const usedInDraft = references.draft.includes(path)
  const usedLive = references.published.includes(path)
  const usedInVersions = references.versions.includes(path)
  const usedIn = [
    usedInDraft ? 'the draft' : null,
    usedLive ? 'the live site' : null,
    usedInVersions ? 'a saved version' : null
  ].filter((item): item is string => Boolean(item))
  return { usedInDraft, usedLive, usedInVersions, used: usedIn.length > 0, usedIn }
}

function publicUrl(admin: SupabaseClient, path: string): string {
  return admin.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl
}

function toAsset(admin: SupabaseClient, row: MediaRow, references: { draft: string; published: string; versions: string }): MediaAsset {
  return {
    ...row,
    name: row.name ?? '',
    alt: row.alt ?? '',
    createdAt: row.created_at,
    url: publicUrl(admin, row.path),
    ...usageFrom(row.path, references)
  }
}

async function loadRow(admin: SupabaseClient, path: string): Promise<MediaRow> {
  const parsed = mediaPathSchema.safeParse(path)
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Choose a file from the library.')
  const { data, error } = await admin.from('site_media').select('path, kind, mime, bytes, created_at, name, alt').eq('path', parsed.data).maybeSingle()
  if (error) throw new ApiError(503, 'media_unavailable', 'The media library is not available right now.')
  if (!data) throw new ApiError(404, 'media_not_found', 'That file is no longer in the library.')
  return data as MediaRow
}

export async function listSiteMedia(admin: SupabaseClient, input: unknown = {}) {
  const parsed = listInput.safeParse(input ?? {})
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Check the media filters.')
  const { data, error } = await admin.from('site_media').select('path, kind, mime, bytes, created_at, name, alt').order('created_at', { ascending: false }).limit(500)
  if (error) throw new ApiError(503, 'media_unavailable', 'The media library is not available right now.')
  const [stored, references] = await Promise.all([storedPaths(admin), referencedText(admin)])
  const term = (parsed.data.q ?? '').trim().toLowerCase()
  const kind = parsed.data.kind ?? 'all'
  const usage = parsed.data.usage ?? 'all'
  const assets = ((data ?? []) as MediaRow[])
    .filter(row => stored.has(row.path))
    .map(row => toAsset(admin, row, references))
    .filter(asset => kind === 'all' || asset.kind === kind)
    .filter(asset => usage === 'all' || (usage === 'unused' ? !asset.used : asset.used))
    .filter(asset => {
      if (!term) return true
      return [asset.name, asset.alt, asset.path, asset.mime].some(value => value.toLowerCase().includes(term))
    })
  return { assets, total: assets.length, includesUsage: true }
}

export async function getSiteMedia(admin: SupabaseClient, path: string) {
  const row = await loadRow(admin, path)
  const references = await referencedText(admin)
  return { asset: toAsset(admin, row, references) }
}

export async function getMediaUsage(admin: SupabaseClient, path: string) {
  const { asset } = await getSiteMedia(admin, path)
  return {
    path: asset.path,
    used: asset.used,
    usedIn: asset.usedIn,
    usedInDraft: asset.usedInDraft,
    usedLive: asset.usedLive,
    usedInVersions: asset.usedInVersions,
    note: asset.used
      ? `This file is used in ${asset.usedIn.join(', ')}. Replace those references with the public site editor before it can be deleted.`
      : 'This file is not referenced by the draft, the live site or any saved version.'
  }
}

function decodeInline(contentBase64: string): Buffer {
  try {
    const raw = contentBase64.includes(',') ? contentBase64.slice(contentBase64.indexOf(',') + 1) : contentBase64
    return Buffer.from(raw, 'base64')
  } catch {
    throw new ApiError(400, 'invalid_request', 'The file content was not valid base64.')
  }
}

function kindForMime(mime: string): MediaKind {
  if (MEDIA_LIMITS.image.mimes.includes(mime)) return 'image'
  if (MEDIA_LIMITS.video.mimes.includes(mime)) return 'video'
  throw new ApiError(415, 'unsupported_media', FORBIDDEN_UPLOAD_HINT)
}

export async function uploadSiteMedia(admin: SupabaseClient, input: unknown) {
  const parsed = z.object({
    kind: z.enum(['image', 'video']).optional(),
    mime: z.string().trim().min(1).max(40),
    bytes: z.number().int().positive().optional(),
    name: plainText(80).optional(),
    contentBase64: z.string().min(1).max(260_000).optional()
  }).strict().safeParse(input ?? {})
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Describe the file as an image or video with its type and size.')
  const mime = parsed.data.mime.toLowerCase()
  const kind = parsed.data.kind ?? kindForMime(mime)
  const limits = MEDIA_LIMITS[kind]
  const extension = MEDIA_EXTENSIONS[mime]
  if (!extension || !limits.mimes.includes(mime) || (parsed.data.kind && kindForMime(mime) !== parsed.data.kind)) {
    throw new ApiError(415, 'unsupported_media', kind === 'video' ? 'Upload an MP4 video.' : FORBIDDEN_UPLOAD_HINT)
  }

  const inline = parsed.data.contentBase64 ? decodeInline(parsed.data.contentBase64) : null
  const bytes = inline ? inline.byteLength : parsed.data.bytes
  if (!bytes) throw new ApiError(400, 'invalid_request', 'Send the file size, or include the file as base64 content.')
  if (bytes > limits.maxBytes) throw new ApiError(413, 'media_too_large', `Keep ${kind === 'video' ? 'videos' : 'images'} under ${Math.round(limits.maxBytes / 1_048_576)} MB.`)
  if (inline && inline.byteLength > MAX_INLINE_BYTES) {
    throw new ApiError(413, 'media_too_large', `Inline uploads through Master MCP must be under ${Math.round(MAX_INLINE_BYTES / 1024)} KB. Use the signed upload URL flow for larger files.`)
  }

  const path = `site/${kind}/${randomUUID()}.${extension}`
  if (inline) {
    const { error } = await admin.storage.from(MEDIA_BUCKET).upload(path, inline, { contentType: mime, upsert: false })
    if (error) throw new ApiError(503, 'media_unavailable', 'Media uploads are not available yet. Nothing was changed.')
  } else {
    const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path)
    if (error || !data) throw new ApiError(503, 'media_unavailable', 'Media uploads are not available yet. Nothing was changed.')
    const { error: recordError } = await admin.from('site_media').insert({ path, kind, mime, bytes, created_by: null, ...(parsed.data.name ? { name: parsed.data.name } : {}) })
    if (recordError) throw new ApiError(503, 'media_unavailable', 'Media uploads are not available yet. Nothing was changed.')
    return {
      ok: true,
      bucket: MEDIA_BUCKET,
      path,
      token: data.token,
      publicUrl: publicUrl(admin, path),
      upload: 'signed_url',
      note: 'Upload the file to the signed URL, then save the public URL into a site draft. The token is single-use and is not a storage secret.'
    }
  }

  const { error: recordError } = await admin.from('site_media').insert({ path, kind, mime, bytes, created_by: null, ...(parsed.data.name ? { name: parsed.data.name } : {}) })
  if (recordError) throw new ApiError(503, 'media_unavailable', 'Media uploads are not available yet. Nothing was changed.')
  return {
    ok: true,
    bucket: MEDIA_BUCKET,
    path,
    publicUrl: publicUrl(admin, path),
    upload: 'inline',
    note: 'The file is in the library. It only appears on the public site after it is added to a draft and published.'
  }
}

export async function updateSiteMedia(admin: SupabaseClient, input: unknown) {
  const parsed = updateInput.safeParse(input ?? {})
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Use plain text: a name up to 80 characters and a description up to 200.')
  const { path, ...patch } = parsed.data
  if (!Object.keys(patch).length) throw new ApiError(400, 'invalid_request', 'Nothing to change.')
  await loadRow(admin, path)
  const { data, error } = await admin.from('site_media').update(patch).eq('path', path).select('path')
  if (error) throw new ApiError(503, 'media_unavailable', 'The change could not be saved. Nothing was changed.')
  if (!data?.length) throw new ApiError(404, 'media_not_found', 'That file is no longer in the library.')
  return { ok: true, path, fields: Object.keys(patch) }
}

export async function deleteSiteMedia(admin: SupabaseClient, path: string) {
  const row = await loadRow(admin, path)
  const references = await referencedText(admin)
  const usage = usageFrom(row.path, references)
  if (usage.used) {
    throw new ApiError(409, 'media_in_use', `This file is used in ${usage.usedIn.join(', ')}. Replace it there first; files in saved versions are kept so they can be restored.`)
  }
  const { error: storageError } = await admin.storage.from(MEDIA_BUCKET).remove([row.path])
  if (storageError) throw new ApiError(503, 'media_unavailable', 'The file could not be deleted. Nothing was changed.')
  await admin.from('site_media').delete().eq('path', row.path)
  return { ok: true, deleted: true, path: row.path }
}

export { MEDIA_PATH, mediaPathSchema }
