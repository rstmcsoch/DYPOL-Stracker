import { useRef, useState } from 'react'
import { ImagePlus, Trash2, Video } from 'lucide-react'
import { Button } from '../ui'
import { controlFetch } from '../api'
import { supabase } from '../../lib/supabase'
import { MEDIA_LIMITS, type MediaKind } from '../../lib/site-content/media'

type UploadTicket = { ok: true; bucket: string; path: string; token: string; publicUrl: string }

/**
 * Upload through the existing owner media flow: the API checks permission, type and size and
 * issues a one-time signed upload into the `homepage-media` bucket; only those URLs validate.
 */
export function MediaUpload({ kind, value, onChange, label }: { kind: MediaKind; value: string; onChange: (url: string) => void; label: string }) {
  const limits = MEDIA_LIMITS[kind]
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const upload = async (file: File) => {
    setProblem(null)
    if (!limits.mimes.includes(file.type)) { setProblem(kind === 'image' ? 'Choose a JPEG, PNG or WebP image.' : 'Choose an MP4 video.'); return }
    if (file.size > limits.maxBytes) { setProblem(`Keep the file under ${Math.round(limits.maxBytes / 1_048_576)} MB.`); return }
    if (!supabase) { setProblem('Uploads are unavailable in this environment.'); return }
    setBusy(true)
    try {
      const ticket = await controlFetch<UploadTicket>('appearance-media', { method: 'POST', body: { kind, mime: file.type, bytes: file.size } })
      const { error } = await supabase.storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type })
      if (error) throw new Error('The upload did not finish. Try again.')
      onChange(ticket.publicUrl)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The upload did not finish. Try again.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return <div className="le-media">
    <div className="le-media__preview">
      {value
        ? kind === 'image' ? <img src={value} alt="" loading="lazy" /> : <video src={value} preload="metadata" muted />
        : <span>{kind === 'image' ? 'No image' : 'No video'}</span>}
    </div>
    <div className="le-media__actions">
      <input ref={fileRef} type="file" accept={limits.mimes.join(',')} className="cc-sr-only" aria-label={label} disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file) }} />
      <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
        {kind === 'image' ? <ImagePlus size={14} aria-hidden="true" /> : <Video size={14} aria-hidden="true" />} {busy ? 'Uploading…' : value ? 'Replace' : 'Upload'}
      </Button>
      {value && <Button size="sm" variant="ghost" onClick={() => onChange('')} disabled={busy}><Trash2 size={14} aria-hidden="true" /> Remove</Button>}
    </div>
    {problem && <p className="le-error" role="alert">{problem}</p>}
  </div>
}
