import { useQuery, useQueryClient } from '@tanstack/react-query'
import { controlFetch } from '../api'
import { APPEARANCE_QUERY_KEY } from '../appearance/ContentEditor'
import { supabase } from '../../lib/supabase'
import { MEDIA_LIMITS, type MediaKind } from '../../lib/site-content/media'

/**
 * The owner media library (homepage-media bucket). Listing, metadata and deletion go through
 * /api/control/appearance-media, which re-checks owner permission and aal2 on every call;
 * uploads use the existing one-time signed upload URL flow (type and size checked server-side).
 */

export interface MediaAsset {
  path: string; kind: MediaKind; mime: string; bytes: number; createdAt: string; name: string; alt: string; url: string
  usedInDraft: boolean; usedLive: boolean; usedInVersions: boolean
}

export const MEDIA_QUERY_KEY = [...APPEARANCE_QUERY_KEY, 'media'] as const

type UploadTicket = { ok: true; bucket: string; path: string; token: string; publicUrl: string }

export function checkMediaFile(kind: MediaKind, file: File): string | null {
  const limits = MEDIA_LIMITS[kind]
  if (!limits.mimes.includes(file.type)) return kind === 'image' ? 'Choose a JPEG, PNG or WebP image.' : 'Choose an MP4 video.'
  if (file.size > limits.maxBytes) return `Keep the file under ${Math.round(limits.maxBytes / 1_048_576)} MB.`
  return null
}

export function kindOfFile(file: File): MediaKind | null {
  if (MEDIA_LIMITS.image.mimes.includes(file.type)) return 'image'
  if (MEDIA_LIMITS.video.mimes.includes(file.type)) return 'video'
  return null
}

/** Uploads one file and returns its public URL (only these URLs pass content validation). */
export async function uploadMedia(kind: MediaKind, file: File): Promise<string> {
  const problem = checkMediaFile(kind, file)
  if (problem) throw new Error(problem)
  if (!supabase) throw new Error('Uploads are unavailable in this environment.')
  const name = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[^\p{L}\p{N} ._-]+/gu, ' ').trim().slice(0, 80)
  const ticket = await controlFetch<UploadTicket>('appearance-media', { method: 'POST', body: { kind, mime: file.type, bytes: file.size, ...(name ? { name } : {}) } })
  const { error } = await supabase.storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type })
  if (error) throw new Error('The upload did not finish. Try again.')
  return ticket.publicUrl
}

export function useMediaLibrary(enabled = true) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: MEDIA_QUERY_KEY,
    queryFn: () => controlFetch<{ ok: true; assets: MediaAsset[] }>('appearance-media').then(result => result.assets),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false
  })
  const refresh = () => client.invalidateQueries({ queryKey: MEDIA_QUERY_KEY })
  return {
    query,
    assets: query.data ?? [],
    refresh,
    upload: async (kind: MediaKind, file: File) => { const url = await uploadMedia(kind, file); void refresh(); return url },
    update: async (path: string, patch: { name?: string; alt?: string }) => { await controlFetch('appearance-media', { method: 'PATCH', body: { path, ...patch } }); void refresh() },
    remove: async (path: string) => { await controlFetch('appearance-media', { method: 'DELETE', body: { path } }); void refresh() }
  }
}

export function formatBytes(bytes: number): string {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
