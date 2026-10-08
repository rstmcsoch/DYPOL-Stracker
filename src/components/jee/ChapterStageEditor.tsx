import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import type { Chapter, ChapterStageKey } from '../../types'
import { useData } from '../../contexts/DataContext'
import { useToast } from '../../contexts/ToastContext'
import { chapterStages } from '../../lib/jee/progress'
import { chapterStageId } from '../../lib/jee/ids'
import { StagePipeline } from './shared'

const TOGGLEABLE: { key: Exclude<ChapterStageKey, 'pyqs'>; label: string; hint: string }[] = [
  { key: 'theory', label: 'Theory read', hint: 'You have been through the theory once.' },
  { key: 'notes', label: 'Notes made', hint: 'Your own notes exist for this chapter.' },
  { key: 'revised', label: 'Revised', hint: 'Also set automatically when a revision is completed.' },
  { key: 'tested', label: 'Tested', hint: 'Also set automatically when a test result is logged.' }
]

/**
 * Chapter pipeline: Theory → Notes → PYQs → Revised → Tested. Each stage is independent.
 * Toggles write to their own row; PYQs and evidence-backed stages reflect real records.
 */
export function ChapterStageEditor({ chapter }: { chapter: Chapter }) {
  const { data, upsert } = useData()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<string | null>(null)
  const stages = useMemo(() => chapterStages(data, chapter), [data, chapter])
  const userId = data.settings.user_id ?? data.settings.id

  const toggle = async (key: Exclude<ChapterStageKey, 'pyqs'>, current: boolean) => {
    if (busy) return
    setBusy(key)
    const now = new Date().toISOString()
    const existing = data.chapterStages.find(row => row.chapter_id === chapter.id && row.stage === key)
    try {
      await upsert('chapter_stages', {
        id: chapterStageId(userId, chapter.id, key), chapter_id: chapter.id, stage: key, done: !current,
        completed_at: !current ? now : null, created_at: existing?.created_at ?? now, updated_at: now
      })
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update this stage.', 'error') }
    finally { setBusy(null) }
  }

  return <div className="jee-stage-editor" aria-label="Learning stages">
    <div className="jee-stage-editor-head"><span className="eyebrow">LEARNING STAGES</span><span className="jee-muted jee-small">Independent — order is up to you</span></div>
    <StagePipeline stages={stages} />
    <div className="jee-stage-toggles">
      {TOGGLEABLE.map(item => {
        const state = stages.find(stage => stage.key === item.key)
        const done = state?.done ?? false
        return <button key={item.key} type="button" className={`jee-stage-toggle ${done ? 'on' : ''}`} aria-pressed={done} disabled={busy !== null} title={item.hint} onClick={() => void toggle(item.key, done)}>
          <span className="jee-stage-toggle-box">{done && <Check size={13} aria-hidden="true" />}</span>
          <span><strong>{item.label}</strong><small>{state?.source === 'evidence' ? 'from your records' : item.hint}</small></span>
        </button>
      })}
    </div>
    {(() => {
      const pyq = stages.find(stage => stage.key === 'pyqs')!
      return <button type="button" className="jee-link jee-pyq-link" onClick={() => navigate(`/pyqs`)}>PYQs: {Math.round(pyq.progress * 100)}% done — open the PYQ tracker</button>
    })()}
  </div>
}
