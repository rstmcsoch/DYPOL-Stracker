import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../pageParts'
import { Button, Field, Panel } from '../ui'
import { supabase } from '../../lib/supabase'
import { AIProviderSettings } from '../../components/ai/AISettingsSection'
import { useProviderManager, type ApiFetch, type SiteAISettings } from '../../components/ai/useProviderManager'
import { useToast } from '../../contexts/ToastContext'

const REQUEST_TIMEOUT_MS = 60_000

/** Same bearer-token pattern as controlFetch, for the shared /api/ai endpoints with ?scope=site. */
const siteAIFetch:ApiFetch = async <T,>(path:string,init:RequestInit = {}):Promise<T> => {
  if (!supabase) throw new Error('Cloud sign-in is not configured for this deployment.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sign in to open the Stracker Control Center.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(),REQUEST_TIMEOUT_MS)
  let response:Response
  try {
    response = await fetch(path,{ ...init,signal:controller.signal,cache:'no-store',credentials:'omit',headers:{ Accept:'application/json','Content-Type':'application/json',Authorization:`Bearer ${token}`,...init.headers } })
  } catch {
    throw new Error(controller.signal.aborted ? 'The request took too long. Nothing was changed by this attempt; try again.' : 'Could not reach the Stracker AI service. Check your connection and try again.')
  } finally { clearTimeout(timer) }
  const body = await response.json().catch(() => null) as (T & { error?:string; message?:string }) | null
  if (!response.ok || !body) throw new Error(typeof body?.message === 'string' ? body.message : 'The request could not be completed.')
  return body
}

function LimitsPanel({ settings,onSave }: { settings:SiteAISettings|null; onSave:(settings:SiteAISettings)=>Promise<void> }) {
  const [draft,setDraft] = useState<SiteAISettings|null>(settings)
  const [saving,setSaving] = useState(false)
  const [problem,setProblem] = useState<string|null>(null)
  useEffect(() => { setDraft(settings) },[settings])
  if (!draft) return <Panel title="Availability and limits"><p className="cc-muted">Loading settings…</p></Panel>
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)
  const minuteOk = Number.isInteger(draft.perUserPerMinute) && draft.perUserPerMinute >= 1 && draft.perUserPerMinute <= 60
  const dailyOk = Number.isInteger(draft.perUserDaily) && draft.perUserDaily >= 1 && draft.perUserDaily <= 1000
  const save = async (next:SiteAISettings) => {
    setSaving(true); setProblem(null)
    try { await onSave(next) } catch (error) { setProblem(error instanceof Error ? error.message : 'Settings could not be saved.') } finally { setSaving(false) }
  }
  return <Panel title="Availability and limits" description="Students see this only as “Stracker AI (Default)” with the model name. Limits apply to each signed-in student and reset on a rolling minute and day."
    footer={<div className="cc-row-actions"><Button variant="primary" size="sm" disabled={!dirty || !minuteOk || !dailyOk || saving} onClick={() => void save(draft)}>{saving ? 'Saving…' : 'Save limits'}</Button>{dirty && <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDraft(settings)}>Discard</Button>}</div>}>
    <label className="cc-toggle-row"><input type="checkbox" checked={draft.enabled} disabled={saving} onChange={event => { const next = { ...draft,enabled:event.target.checked }; setDraft(next); if (settings) void save({ ...settings,enabled:event.target.checked }) }} /> <span><strong>Offer Stracker AI (Default) to every student</strong><small className="cc-muted"> Turn off to hide it; students then use only their own models.</small></span></label>
    <div className="cc-form-grid">
      <Field label="Requests per student per minute" htmlFor="site-ai-minute" hint="1–60. Default 4." error={minuteOk ? null : 'Enter a whole number from 1 to 60.'}>
        <input id="site-ai-minute" className="cc-input" type="number" min={1} max={60} value={draft.perUserPerMinute} onChange={event => setDraft({ ...draft,perUserPerMinute:Number(event.target.value) })} />
      </Field>
      <Field label="Requests per student per day" htmlFor="site-ai-daily" hint="1–1000. Default 40." error={dailyOk ? null : 'Enter a whole number from 1 to 1000.'}>
        <input id="site-ai-daily" className="cc-input" type="number" min={1} max={1000} value={draft.perUserDaily} onChange={event => setDraft({ ...draft,perUserDaily:Number(event.target.value) })} />
      </Field>
    </div>
    {problem && <p className="cc-field__error" role="alert">{problem}</p>}
  </Panel>
}

/**
 * Owner-only page for Stracker AI (Default): the same add, Discover, test, enable/disable,
 * preferred and remove options students have, stored encrypted in an RLS-locked table and
 * guarded by the Control Center session (owner role + two-step verification on every call).
 */
export default function AIDefaultsPage() {
  const manager = useProviderManager(siteAIFetch,'site',true)
  const { notify } = useToast()
  const { refreshProviders,saveSiteSettings } = manager
  useEffect(() => { void refreshProviders() },[refreshProviders])
  const onSave = useCallback(async (settings:SiteAISettings) => { await saveSiteSettings(settings); notify('Stracker AI settings saved.') },[saveSiteSettings,notify])
  return <div className="cc-page cc-ai-defaults">
    <PageHeader title="Stracker AI" description="The default AI model every student can use without adding their own. Keys are encrypted on the server and never shown to students." />
    <LimitsPanel settings={manager.siteSettings} onSave={onSave} />
    <div className="cc-ai-provider-settings">
      <AIProviderSettings manager={manager} variant="site" />
    </div>
  </div>
}
