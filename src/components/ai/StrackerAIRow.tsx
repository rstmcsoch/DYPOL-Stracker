import { AlertTriangle, LoaderCircle, Plus, Sparkles, Star } from 'lucide-react'
import { Button, StatusBadge } from '../ui'
import type { StrackerAIStatus } from './useProviderManager'

export const STRACKER_AI_NAME = 'Stracker AI (Default)'
export const STRACKER_UNAVAILABLE_COPY = 'Stracker AI is temporarily unavailable. You can add your own AI model to keep going.'

/** Professional notice with a direct "Add your own model" action, used in Settings and the AI window. */
export function StrackerUnavailableNotice({ onAddOwn, compact = false }: { onAddOwn?:()=>void; compact?:boolean }) {
  return <div className={`ai-service-notice ai-stracker-notice${compact ? ' compact' : ''}`} role="status">
    <AlertTriangle size={compact ? 15 : 17} />
    <span>{STRACKER_UNAVAILABLE_COPY}</span>
    {onAddOwn && <Button type="button" size="sm" variant="secondary" onClick={onAddOwn}><Plus size={14} /> Add your own model</Button>}
  </div>
}

/**
 * The always-first row in Settings → AI Assistant. Students can prefer it but never edit or
 * remove it, and it shows nothing beyond the brand, the model name and availability.
 */
export function StrackerAIRow({ stracker, preferred, onPrefer, busy = false, onAddOwn, loading = false }: { stracker:StrackerAIStatus|null; preferred:boolean; onPrefer?:()=>void; busy?:boolean; onAddOwn?:()=>void; loading?:boolean }) {
  const ready = stracker?.status === 'ready'
  return <>
    <div className="ai-provider-row ai-stracker-row" data-testid="stracker-ai-row">
      <span className="ai-provider-mark ai-stracker-mark" aria-hidden="true"><Sparkles size={18} strokeWidth={2.1} /></span>
      <div className="ai-provider-copy">
        <div className="ai-provider-title"><strong>{STRACKER_AI_NAME}</strong>{loading ? <StatusBadge>Checking…</StatusBadge> : <StatusBadge tone={ready ? 'good' : 'warn'}>{ready ? 'Ready' : 'Unavailable'}</StatusBadge>}{preferred && <span className="ai-preferred-tag"><Star size={11} fill="currentColor" /> Preferred</span>}</div>
        <div className="ai-provider-meta">{stracker?.model ? <span>{stracker.model}</span> : null}<span>Included with Stracker</span>{ready && stracker ? <span>{Math.max(0,stracker.dailyLimit - stracker.usedToday)} of {stracker.dailyLimit} requests left today</span> : null}</div>
      </div>
      <div className="ai-provider-actions">
        {!preferred && onPrefer && <Button size="sm" variant="quiet" onClick={onPrefer} disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : <Star size={14} />}<span className="ai-action-label">Preferred</span></Button>}
      </div>
    </div>
    {!loading && stracker && !ready && <StrackerUnavailableNotice onAddOwn={onAddOwn} />}
  </>
}
