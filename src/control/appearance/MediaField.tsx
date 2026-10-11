import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '../ui'
import { controlFetch } from '../api'
import { supabase } from '../../lib/supabase'
import { MEDIA_LIMITS } from '../../lib/site-content/media'
import type { FieldDefinition } from '../../lib/site-content/registry'

type UploadTicket = { ok: true; bucket: string; path: string; token: string; publicUrl: string }

/**
 * Upload control for `media` fields. The file goes straight from the owner's browser to
 * Supabase Storage through a single-use signed URL minted by the Control Center API; the
 * field then holds the public URL, which only goes live once the draft is published.
 */
export function MediaField({ definition, value, disabled, onChange, describedBy, inputId }: {
  definition: FieldDefinition
  value: string
  disabled: boolean
  onChange: (next: string) => void
  describedBy: string
  inputId: string
}) {
  const kind = definition.mediaKind ?? 'image'
  const limits = MEDIA_LIMITS[kind]
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const isDefault = value === definition.defaultValue

  const upload = async (file: File) => {
    setProblem(null)
    if (!limits.mimes.includes(file.type)) { setProblem(kind === 'video' ? 'Choose an MP4 video.' : 'Choose a JPEG, PNG or WebP image.'); return }
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

  return <div className="cc-media-field" aria-describedby={describedBy}>
    <div className="cc-media-preview">
      {kind === 'video'
        ? <video src={value} muted playsInline preload="metadata" controls aria-label="Current video" />
        : <img src={value} alt="Current poster" loading="lazy" />}
    </div>
    <div className="cc-media-meta">
      <span className="cc-muted">{isDefault ? 'Built-in file' : 'Uploaded file'}</span>
      <input ref={fileRef} id={inputId} type="file" accept={limits.mimes.join(',')} className="cc-sr-only" disabled={disabled || busy} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file) }} />
      <Button size="sm" variant="default" disabled={disabled || busy} onClick={() => fileRef.current?.click()}>
        <Upload size={13} aria-hidden="true" /> {busy ? 'Uploading…' : kind === 'video' ? 'Upload video' : 'Upload image'}
      </Button>
      {problem && <span className="cc-field__error" role="alert">{problem}</span>}
    </div>
  </div>
}
