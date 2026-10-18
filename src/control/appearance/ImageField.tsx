import { useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { Button } from '../ui'
import { controlFetch } from '../api'
import { supabase } from '../../lib/supabase'
import { MEDIA_LIMITS } from '../../lib/site-content/media'
import type { FieldDefinition } from '../../lib/site-content/registry'

type UploadTicket = { ok: true; bucket: string; path: string; token: string; publicUrl: string }

/**
 * Optional image (cards, hero). Images only: uses the existing owner image upload
 * (`kind: 'image'`) and can be cleared back to "no image". Video fields keep MediaField.
 */
export function ImageField({ definition, value, disabled, onChange, describedBy, inputId }: {
  definition: FieldDefinition
  value: string
  disabled: boolean
  onChange: (next: string) => void
  describedBy: string
  inputId: string
}) {
  const limits = MEDIA_LIMITS.image
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const upload = async (file: File) => {
    setProblem(null)
    if (!limits.mimes.includes(file.type)) { setProblem('Choose a JPEG, PNG or WebP image.'); return }
    if (file.size > limits.maxBytes) { setProblem(`Keep the image under ${Math.round(limits.maxBytes / 1_048_576)} MB.`); return }
    if (!supabase) { setProblem('Uploads are unavailable in this environment.'); return }
    setBusy(true)
    try {
      const ticket = await controlFetch<UploadTicket>('appearance-media', { method: 'POST', body: { kind: 'image', mime: file.type, bytes: file.size } })
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
    <div className="cc-media-preview cc-image-preview">
      {value ? <img src={value} alt="Current image" loading="lazy" /> : <span className="cc-muted">No image</span>}
    </div>
    <div className="cc-media-meta">
      <input ref={fileRef} id={inputId} type="file" accept={limits.mimes.join(',')} className="cc-sr-only" disabled={disabled || busy} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file) }} />
      <Button size="sm" variant="default" disabled={disabled || busy} onClick={() => fileRef.current?.click()}>
        <ImagePlus size={13} aria-hidden="true" /> {busy ? 'Uploading…' : value ? 'Replace image' : 'Add image'}
      </Button>
      {value && <Button size="sm" variant="ghost" disabled={disabled || busy} onClick={() => onChange(definition.defaultValue)}>
        <Trash2 size={13} aria-hidden="true" /> Remove image
      </Button>}
      {problem && <span className="cc-field__error" role="alert">{problem}</span>}
    </div>
  </div>
}
