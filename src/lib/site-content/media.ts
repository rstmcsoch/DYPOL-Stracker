/**
 * Shared rules for owner-uploaded homepage media (browser, editor and API).
 * Keep free of browser- and Node-only APIs.
 */
export const MEDIA_BUCKET = 'homepage-media'

export type MediaKind = 'image' | 'video'

export const MEDIA_LIMITS: Record<MediaKind, { mimes: readonly string[]; maxBytes: number }> = {
  image: { mimes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 5 * 1_048_576 },
  video: { mimes: ['video/mp4'], maxBytes: 50 * 1_048_576 }
}

export const MEDIA_EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'
}

const UPLOADED_MEDIA = {
  image: /^https:\/\/[a-z0-9]{20}\.supabase\.co\/storage\/v1\/object\/public\/homepage-media\/site\/image\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/,
  video: /^https:\/\/[a-z0-9]{20}\.supabase\.co\/storage\/v1\/object\/public\/homepage-media\/site\/video\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/
} as const

/** True for a public URL of an object this site uploaded into its own media bucket. */
export function isUploadedMediaUrl(kind: MediaKind, value: string): boolean {
  return UPLOADED_MEDIA[kind].test(value)
}
