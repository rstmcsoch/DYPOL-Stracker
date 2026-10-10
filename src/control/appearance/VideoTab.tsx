import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, Trash2, Upload } from 'lucide-react'
import { PromoVideoSection } from '../../components/public/PromoVideoPlayer'
import { SiteContentProvider } from '../../contexts/SiteContentContext'
import { overridesFromValues } from '../../lib/site-content/content'
import { VIDEO_SIZE_PRESETS, resolvePromoVideoConfig, type VideoSizePreset } from '../../lib/promo-video-config'
import { supabase } from '../../lib/supabase'
import { Button, Panel, Segmented } from '../ui'
import { useContentEditor, fieldsForArea } from './ContentEditor'
import { PREVIEW_DEVICES, type PreviewDevice } from './devices'
import { FieldRow, SaveBar } from './FieldRow'

type Notice = { tone: 'ok' | 'crit'; text: string } | null

const BUCKET = 'homepage-media'
const MAX_VIDEO_BYTES = 48 * 1024 * 1024
const MAX_POSTER_BYTES = 2_500_000

interface StoredObject { folder: 'videos' | 'posters'; name: string; size: number; updatedAt: string }

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Owner management for the homepage promotional player: media uploads into the
 * `homepage-media` storage bucket, appearance and playback settings (registry
 * fields, so they flow through the same draft → publish pipeline as copy), and
 * an instant device preview that renders the real player component.
 *
 * Uploads write objects only; the homepage switches to a new file when its URL
 * is saved into the draft and published. Nothing here bypasses the server:
 * storage policies re-check the owner role on every write and delete.
 */
export function VideoTab() {
  const editor = useContentEditor()
  const { values, setValue, saving } = editor
  const config = useMemo(() => resolvePromoVideoConfig(values), [values])

  const [notice, setNotice] = useState<Notice>(null)
  const [uploading, setUploading] = useState<null | 'video' | 'poster'>(null)
  const [objects, setObjects] = useState<StoredObject[]>([])
  const [objectsLoaded, setObjectsLoaded] = useState(false)
  const [device, setDevice] = useState<PreviewDevice>('desktop')
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>('light')
  const videoInputRef = useRef<HTMLInputElement | null>(null)
  const posterInputRef = useRef<HTMLInputElement | null>(null)

  const videoFields = fieldsForArea('public').filter(definition => definition.key.startsWith('public.video.'))
  const deviceInfo = PREVIEW_DEVICES.find(item => item.value === device) ?? PREVIEW_DEVICES[0]!

  const refreshObjects = useCallback(async () => {
    if (!supabase) return
    const folders: Array<'videos' | 'posters'> = ['videos', 'posters']
    const listed: StoredObject[] = []
    for (const folder of folders) {
      const { data } = await supabase.storage.from(BUCKET).list(folder, { limit: 100 })
      for (const item of data ?? []) {
        if (item.name) listed.push({ folder, name: item.name, size: item.metadata?.size ?? 0, updatedAt: item.updated_at ?? '' })
      }
    }
    setObjects(listed.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    setObjectsLoaded(true)
  }, [])

  useEffect(() => { void refreshObjects() }, [refreshObjects])

  const upload = async (kind: 'video' | 'poster', file: File | undefined) => {
    if (!file) return
    if (!supabase) { setNotice({ tone: 'crit', text: 'The media library is not configured for this deployment.' }); return }
    const isVideo = kind === 'video'
    const typeOk = isVideo
      ? (file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4'))
      : ['image/jpeg', 'image/webp', 'image/png'].includes(file.type)
    if (!typeOk) {
      setNotice({ tone: 'crit', text: isVideo ? 'Only H.264 MP4 video files are accepted.' : 'Posters must be JPEG, WebP or PNG images.' })
      return
    }
    if (file.size > (isVideo ? MAX_VIDEO_BYTES : MAX_POSTER_BYTES)) {
      setNotice({ tone: 'crit', text: isVideo ? `Keep the video under ${formatBytes(MAX_VIDEO_BYTES)} — compress it to a 2–4 MB fast-start MP4 for the best playback.` : 'Keep the poster under 2.5 MB.' })
      return
    }
    setUploading(kind)
    setNotice(null)
    const folder = isVideo ? 'videos' : 'posters'
    const extension = isVideo ? 'mp4' : file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
      upsert: false
    })
    setUploading(null)
    if (error) {
      setNotice({ tone: 'crit', text: error.message.includes('security') || error.message.includes('policy') ? 'You are not authorised to upload media.' : `The upload failed: ${error.message}` })
      return
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    setValue(isVideo ? 'public.video.src' : 'public.video.poster', data.publicUrl)
    setNotice({ tone: 'ok', text: isVideo ? 'Video uploaded. It becomes live when you save the draft and publish.' : 'Poster uploaded. Save the draft and publish to make it live.' })
    void refreshObjects()
  }

  const removeObject = async (object: StoredObject) => {
    if (!supabase) return
    const url = supabase.storage.from(BUCKET).getPublicUrl(`${object.folder}/${object.name}`).data.publicUrl
    const inUse = values['public.video.src'] === url || values['public.video.poster'] === url
      || editor.publishedValues['public.video.src'] === url || editor.publishedValues['public.video.poster'] === url
    if (inUse) {
      setNotice({ tone: 'crit', text: 'That file is currently used by the draft or the live homepage. Point the player at another file first.' })
      return
    }
    const { error } = await supabase.storage.from(BUCKET).remove([`${object.folder}/${object.name}`])
    setNotice(error ? { tone: 'crit', text: 'The file could not be deleted.' } : { tone: 'ok', text: 'File deleted from the media library.' })
    void refreshObjects()
  }

  const applyPreset = (preset: VideoSizePreset) => {
    if (preset === 'custom') return
    const bounds = VIDEO_SIZE_PRESETS[preset]
    setValue('public.video.desktop_height', String(bounds.desktopVh))
    setValue('public.video.max_width', String(bounds.maxWidth))
  }

  return <>
    <Panel
      title="Video file & poster"
      description="Uploads go to the homepage media library (persistent object storage). The public homepage keeps the current published video until a replacement is saved and published."
    >
      {!supabase && <p className="cc-note cc-note--warn">The media library is not configured for this deployment; the built-in Stracker video remains in use.</p>}
      <div className="cc-video-grid">
        <div className="cc-video-current">
          <strong>Current draft video</strong>
          <video controls preload="metadata" playsInline src={values['public.video.src'] || '/videos/stracker-ad1-web.mp4'} poster={values['public.video.poster'] || '/videos/stracker-ad1-poster.jpg'} />
          <div className="cc-video-actions">
            <Button size="sm" disabled={!supabase || uploading !== null || saving} onClick={() => videoInputRef.current?.click()}>{uploading === 'video' ? 'Uploading…' : <><Upload size={13} aria-hidden="true" /> Upload video</>}</Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setValue('public.video.src', ''); setNotice({ tone: 'ok', text: 'Draft now uses the built-in Stracker video.' }) }}><RotateCcw size={13} aria-hidden="true" /> Built-in video</Button>
          </div>
          <p className="cc-video-note">Best results: H.264 MP4, fast-start (moov before mdat), around 2–4 MB for a 10-second clip. The file is validated on upload and never replaces the live video until you publish.</p>
        </div>
        <div className="cc-video-current">
          <strong>Current draft poster</strong>
          <img className="cc-video-poster" src={values['public.video.poster'] || '/videos/stracker-ad1-poster.jpg'} alt="Current poster thumbnail" loading="lazy" />
          <div className="cc-video-actions">
            <Button size="sm" disabled={!supabase || uploading !== null || saving} onClick={() => posterInputRef.current?.click()}>{uploading === 'poster' ? 'Uploading…' : <><Upload size={13} aria-hidden="true" /> Upload poster</>}</Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setValue('public.video.poster', ''); setNotice({ tone: 'ok', text: 'Draft now uses the built-in poster.' }) }}><RotateCcw size={13} aria-hidden="true" /> Built-in poster</Button>
          </div>
          <p className="cc-video-note">A lightweight JPEG or WebP still, matching the video’s aspect ratio, shown until playback starts.</p>
        </div>
      </div>
      <input ref={videoInputRef} type="file" accept="video/mp4,.mp4" className="cc-sr-only" aria-label="Upload a promotional video" onChange={event => { void upload('video', event.target.files?.[0]); event.target.value = '' }} />
      <input ref={posterInputRef} type="file" accept="image/jpeg,image/webp,image/png" className="cc-sr-only" aria-label="Upload a poster image" onChange={event => { void upload('poster', event.target.files?.[0]); event.target.value = '' }} />
      {notice && <p className={`cc-note ${notice.tone === 'crit' ? 'cc-note--crit' : ''}`} role="status">{notice.text}</p>}
    </Panel>

    <Panel title="Player size & appearance" description="Every value is clamped to safe bounds: the responsive layout, the aspect ratio and the mobile limits always stay enforced.">
      <div className="cc-field">
        <span className="cc-copy-field__label">One-tap size</span>
        <Segmented
          label="Player size"
          value={config.size}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'medium', label: 'Medium' },
            { value: 'large', label: 'Large' },
            { value: 'custom', label: 'Custom' }
          ]}
          onChange={applyPreset}
        />
      </div>
      <div className="cc-stack">
        {videoFields.map(definition => <FieldRow key={definition.key} definition={definition} showContext={false} />)}
      </div>
    </Panel>

    <Panel
      title="Instant preview"
      description="The real homepage player with your on-screen settings, before saving. The publishing tab preview shows the saved draft on the full page."
      actions={<div className="cc-panel__actions-row">
        <Segmented label="Preview size" value={device} options={PREVIEW_DEVICES.map(item => ({ value: item.value, label: item.label }))} onChange={setDevice} />
        <Segmented label="Preview theme" value={previewTheme} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Night' }]} onChange={setPreviewTheme} />
      </div>}
    >
      <div className="cc-video-preview-shell">
        <div className="cc-video-preview-frame" style={{ width: deviceInfo.width, height: Math.min(560, deviceInfo.height) }}>
          <SiteContentProvider overrides={overridesFromValues(values)}>
            <div className="pub-page" data-public-theme={previewTheme}>
              <main className="pub-main">
                <PromoVideoSection />
              </main>
            </div>
          </SiteContentProvider>
        </div>
      </div>
    </Panel>

    <Panel title="Media library" description="Files stored in the homepage media bucket. Deleting never touches the built-in video; files used by the draft or the live site are protected.">
      {!supabase
        ? <p className="cc-muted">Not configured.</p>
        : !objectsLoaded
          ? <p className="cc-muted">Loading the library…</p>
          : objects.length === 0
            ? <p className="cc-muted">No uploaded files yet — the built-in Stracker video and poster are in use.</p>
            : <ul className="cc-video-storage">
              {objects.map(object => (
                <li key={`${object.folder}/${object.name}`}>
                  <code>{object.folder}/{object.name}</code>
                  <span>{object.size ? formatBytes(object.size) : ''}</span>
                  <Button size="sm" variant="ghost" onClick={() => void removeObject(object)} aria-label={`Delete ${object.folder}/${object.name}`}><Trash2 size={13} aria-hidden="true" /> Delete</Button>
                </li>
              ))}
            </ul>}
    </Panel>

    <SaveBar notice={null} onNotice={setNotice} />
  </>
}
