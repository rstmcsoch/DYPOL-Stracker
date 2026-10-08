import { useState } from 'react'
import { AlertTriangle, Check, CircleHelp, KeyRound, LoaderCircle, Pencil, Plus, RefreshCw, ShieldCheck, Sparkles, Star, Trash2 } from 'lucide-react'
import { AI_PROVIDERS, AI_STATUS_COPY, DEFAULT_CAPABILITIES, providerLabel, statusTone, type AIModelOption, type AIProviderConfig, type AIProviderId } from '../../lib/ai/catalog'
import { defaultModelFor } from '../../lib/ai/model-catalog'
import { useAI, type AIProviderDraft } from '../../contexts/AIContext'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { Button, Dialog, Field, NotebookCard, StatusBadge } from '../ui'
import { AIProviderMark } from './AIProviderMark'

const DEFAULT_MODEL:Record<AIProviderId,string> = { gemini:defaultModelFor('gemini'),openai:defaultModelFor('openai'),anthropic:defaultModelFor('anthropic'),deepseek:defaultModelFor('deepseek'),qwen:defaultModelFor('qwen'),custom:'' }

export function AISettingsSection() {
  const { user } = useAuth()
  const { providers,providersLoading,providersError,backendStatus,backendHealth,checkBackendHealth,refreshProviders,saveProvider,testProvider,patchProvider,removeProvider,discoverModels,openPanel } = useAI()
  const { notify } = useToast()
  const [editing,setEditing] = useState<AIProviderConfig|null>(null)
  const [draft,setDraft] = useState<AIProviderDraft|null>(null)
  const [models,setModels] = useState<AIModelOption[]>([])
  const [modelsMessage,setModelsMessage] = useState('')
  const [discoveryAvailable,setDiscoveryAvailable] = useState(false)
  const [saving,setSaving] = useState(false)
  const [discovering,setDiscovering] = useState(false)
  const [workingId,setWorkingId] = useState<string|null>(null)
  const [removeTarget,setRemoveTarget] = useState<AIProviderConfig|null>(null)
  const [removing,setRemoving] = useState(false)

  const openNew = () => {
    setEditing(null); setModels([]); setModelsMessage(''); setDiscoveryAvailable(false)
    setDraft({ providerId:'gemini',displayName:'',modelId:'',apiKey:'',baseUrl:null,protocol:'google',region:'international',capabilities:{...DEFAULT_CAPABILITIES} })
  }
  const openEdit = (provider:AIProviderConfig) => {
    setEditing(provider); setModels([]); setModelsMessage(''); setDiscoveryAvailable(false)
    setDraft({ id:provider.id,providerId:provider.provider_id,displayName:provider.display_name,modelId:provider.model_id,apiKey:'',baseUrl:provider.base_url,protocol:provider.protocol,organizationId:provider.organization_id,region:provider.region === 'china' ? 'china' : 'international',capabilities:{...provider.capabilities} })
  }
  const closeEditor = () => { setDraft(null); setEditing(null); setModels([]); setModelsMessage(''); setSaving(false); setDiscovering(false) }
  const patchDraft = (patch:Partial<AIProviderDraft>) => setDraft(current => current ? { ...current,...patch } : current)

  const save = async () => {
    if (!draft || saving) return
    if (!draft.modelId.trim()) { notify('Choose or enter a model ID before saving.', 'error'); return }
    if (!editing && !draft.apiKey?.trim()) { notify('Enter your provider API key before saving.', 'error'); return }
    setSaving(true)
    try {
      const saved = await saveProvider({
        ...draft,displayName:draft.displayName?.trim() || undefined,modelId:draft.modelId.trim(),apiKey:draft.apiKey?.trim() || undefined,
        baseUrl:draft.providerId === 'custom' || ['openai','deepseek'].includes(draft.providerId) ? draft.baseUrl?.trim() || null : undefined,
        organizationId:draft.providerId === 'openai' ? draft.organizationId?.trim() || null : undefined
      })
      notify(editing ? 'Provider settings saved. Test the connection again before using changed settings.' : `${providerLabel(saved.provider_id)} saved. Test the connection to enable it.`)
      closeEditor()
    } catch (error) { notify(error instanceof Error ? error.message : 'Provider settings could not be saved.', 'error') }
    finally { setSaving(false) }
  }

  const discover = async () => {
    if (!draft || discovering) return
    if (!editing && !draft.apiKey?.trim()) { notify('Enter the provider API key before discovering models.', 'error'); return }
    if (editing && !draft.apiKey?.trim()) {
      const changedConnection = draft.baseUrl !== editing.base_url || draft.protocol !== editing.protocol || draft.organizationId !== editing.organization_id || draft.region !== (editing.region === 'china' ? 'china' : 'international') || JSON.stringify(draft.capabilities ?? {}) !== JSON.stringify(editing.capabilities ?? {})
      if (changedConnection) { notify('Save these connection changes first, then reopen this provider to discover models.', 'info'); return }
    }
    setDiscovering(true); setModelsMessage(''); setModels([])
    try {
      const result = await discoverModels({
        ...draft,modelId:draft.modelId.trim() || DEFAULT_MODEL[draft.providerId],
        baseUrl:draft.providerId === 'custom' || ['openai','deepseek'].includes(draft.providerId) ? draft.baseUrl?.trim() || null : undefined,
        organizationId:draft.providerId === 'openai' ? draft.organizationId?.trim() || null : undefined
      })
      setModels(result.models ?? []); setDiscoveryAvailable(Boolean(result.discoveryAvailable))
      setModelsMessage(result.message ?? (result.models.length ? `Found ${result.models.length} available models.` : 'No models were listed. Enter a model ID manually.'))
      if (result.models.length && !result.models.some(model => model.id === draft.modelId)) patchDraft({modelId:result.models[0]?.id ?? draft.modelId})
    } catch (error) { setModelsMessage(error instanceof Error ? error.message : 'Models could not be loaded. Enter a model ID manually.') }
    finally { setDiscovering(false) }
  }

  const runProviderAction = async (id:string,action:'test'|'enable'|'disable'|'default') => {
    setWorkingId(id)
    try {
      if (action === 'test') await testProvider(id)
      else await patchProvider(id,action)
      notify(action === 'test' ? 'Provider connection successful.' : action === 'disable' ? 'Provider disabled.' : action === 'default' ? 'Preferred AI updated.' : 'Provider enabled.')
    } catch (error) { notify(error instanceof Error ? error.message : 'That provider action failed. Try again.', 'error') }
    finally { setWorkingId(null) }
  }

  const confirmRemove = async () => {
    if (!removeTarget || removing) return
    setRemoving(true)
    try { await removeProvider(removeTarget.id); notify(`${providerLabel(removeTarget.provider_id)} credentials removed from Stracker.`); setRemoveTarget(null) }
    catch (error) { notify(error instanceof Error ? error.message : 'The provider could not be removed.', 'error') }
    finally { setRemoving(false) }
  }

  const selectedProvider = draft ? AI_PROVIDERS.find(provider => provider.id === draft.providerId) : null
  const providerChanged = (providerId:AIProviderId) => {
    const definition = AI_PROVIDERS.find(provider => provider.id === providerId)!
    patchDraft({providerId,protocol:definition.protocol,baseUrl:definition.defaultBaseUrl,modelId:DEFAULT_MODEL[providerId],organizationId:'',region:'international',capabilities:{...DEFAULT_CAPABILITIES}})
    setModels([]); setModelsMessage(''); setDiscoveryAvailable(false)
  }

  return <>
    <NotebookCard className="settings-section ai-settings-card" id="ai-provider-settings">
      <div className="ai-settings-heading">
        <div className="settings-section-heading"><span className="settings-section-icon ai-settings-spark"><Sparkles size={18} /></span><div><h2>AI Assistant</h2><p>Connect an AI provider with your own API key. Stracker does not provide or pay for AI usage.</p></div></div>
        <Button type="button" variant="secondary" onClick={openPanel}><Sparkles size={15} /> Open assistant</Button>
      </div>
      <div className="ai-privacy-note" role="note"><ShieldCheck size={17} /><span><strong>Your key stays server-side.</strong> Provider credentials are encrypted at rest and are never stored in browser storage or returned to the app. Your messages and relevant Stracker data are sent to the provider you choose; provider billing, quota, and privacy terms apply.</span></div>

      {user?.isLocal && <div className="ai-service-notice"><AlertTriangle size={17} /><span>AI requires a signed-in cloud account and the secure server configuration. Local preview stays available without AI or network dependencies.</span></div>}
      {!user?.isLocal && backendStatus === 'misconfigured' && <div className="ai-service-notice" role="alert"><AlertTriangle size={17} /><span><strong>The Stracker AI backend is not configured for this deployment.</strong> The administrator must finish the server setup. The server reports: {backendHealth?.reason ?? 'incomplete server configuration'}{(backendHealth?.missing?.length || backendHealth?.invalid?.length) ? <> Missing or malformed: {[...(backendHealth?.missing ?? []),...(backendHealth?.invalid ?? [])].map(name => <code key={name}>{name}</code>)}</> : null} The health endpoint <code>/api/ai/health</code> shows this diagnosis; provider keys cannot be saved until it is fixed.</span><Button variant="quiet" size="sm" onClick={() => void checkBackendHealth()}>Recheck</Button></div>}
      {!user?.isLocal && backendStatus === 'unreachable' && <div className="ai-service-notice" role="alert"><AlertTriangle size={17} /><span><strong>The Stracker AI backend is unavailable.</strong> The deployed app has no <code>/api/ai/*</code> functions. Deploy the Vercel AI backend (see the README) and reload.</span><Button variant="quiet" size="sm" onClick={() => void checkBackendHealth()}>Recheck</Button></div>}
      {providersError && !user?.isLocal && backendStatus !== 'misconfigured' && backendStatus !== 'unreachable' && <div className="ai-service-notice"><AlertTriangle size={17} /><span>{providersError}</span><Button variant="quiet" size="sm" onClick={() => void refreshProviders()}>Retry</Button></div>}

      <div className="ai-provider-list" aria-live="polite">
        {providersLoading && providers.length === 0 ? <div className="ai-settings-loading"><LoaderCircle size={17} className="spin" /> Checking provider connections…</div> : providers.length ? providers.map(provider => {
          const busy = workingId === provider.id
          const canEnable = !provider.enabled && provider.connection_status === 'connected'
          return <div className="ai-provider-row" key={provider.id}>
            <AIProviderMark provider={provider.provider_id} />
            <div className="ai-provider-copy"><div className="ai-provider-title"><strong>{provider.display_name || providerLabel(provider.provider_id)}</strong><StatusBadge tone={statusTone(provider.connection_status)}>{AI_STATUS_COPY[provider.connection_status]}</StatusBadge>{provider.is_default && <span className="ai-preferred-tag"><Star size={11} fill="currentColor" /> Preferred</span>}</div><div className="ai-provider-meta"><span>{provider.model_id}</span><span>{provider.masked_key}</span>{provider.enabled ? <span>Enabled</span> : <span>Disabled</span>}</div></div>
            <div className="ai-provider-actions">
              <Button size="sm" variant="quiet" onClick={() => void runProviderAction(provider.id,'test')} disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} <span className="ai-action-label">Test</span></Button>
              {canEnable ? <Button size="sm" variant="secondary" onClick={() => void runProviderAction(provider.id,'enable')} disabled={busy}><Check size={14} /><span className="ai-action-label">Enable</span></Button> : provider.enabled ? <Button size="sm" variant="quiet" onClick={() => void runProviderAction(provider.id,'disable')} disabled={busy}><span className="ai-action-label">Disable</span></Button> : null}
              {provider.enabled && !provider.is_default && <Button size="sm" variant="quiet" onClick={() => void runProviderAction(provider.id,'default')} disabled={busy}><Star size={14} /><span className="ai-action-label">Preferred</span></Button>}
              <Button size="sm" variant="quiet" aria-label={`Edit ${provider.display_name}`} onClick={() => openEdit(provider)}><Pencil size={14} /><span className="ai-action-label">Edit</span></Button>
              <Button size="sm" variant="quiet" aria-label={`Remove ${provider.display_name}`} onClick={() => setRemoveTarget(provider)}><Trash2 size={14} /><span className="ai-action-label">Remove</span></Button>
            </div>
          </div>
        }) : !providersError && !user?.isLocal ? <div className="ai-provider-empty"><AIProviderMark provider="gemini" /><div><strong>No AI provider connected yet.</strong><span>Add your own API key to get started.</span></div></div> : null}
      </div>
      {!user?.isLocal && <div className="ai-settings-footer"><span><CircleHelp size={14} /> Configure one or more providers for transparent fallback.</span><Button type="button" size="sm" onClick={openNew}><Plus size={15} /> Add provider</Button></div>}
      <p className="ai-privacy-footnote">Provider terms and model data-retention settings are controlled by the provider. Never enter another person’s credentials or sensitive personal information.</p>
    </NotebookCard>

    {draft && selectedProvider && <Dialog title={editing ? `Edit ${providerLabel(editing.provider_id)}` : 'Connect an AI provider'} subtitle="Use a key from your provider account. Stracker never supplies a substitute key." onClose={closeEditor} className="dialog-ai-provider">
      <div className="ai-provider-choice-grid" role="group" aria-label="AI provider">
        {AI_PROVIDERS.map(provider => <button type="button" key={provider.id} className={`ai-provider-choice ${draft.providerId === provider.id ? 'selected' : ''}`} onClick={() => providerChanged(provider.id)} aria-pressed={draft.providerId === provider.id}><AIProviderMark provider={provider.id} small /><span>{provider.shortLabel}</span></button>)}
      </div>
      <div className="ai-editor-fields">
        <Field label="Display name" hint="Optional name used in the assistant and fallback notices."><input maxLength={80} value={draft.displayName ?? ''} onChange={event => patchDraft({displayName:event.target.value})} placeholder={selectedProvider.label} /></Field>
        <div className="ai-model-field"><Field label="Model ID" required hint="Use Discover when supported, or enter a model ID from your provider account."><input list="ai-model-list" value={draft.modelId} onChange={event => patchDraft({modelId:event.target.value})} placeholder={DEFAULT_MODEL[draft.providerId] || 'e.g. provider-model-name'} autoComplete="off" /><datalist id="ai-model-list">{models.map(model => <option key={model.id} value={model.id} label={model.name} />)}</datalist></Field><Button type="button" variant="secondary" size="sm" onClick={() => void discover()} disabled={discovering || saving}>{discovering ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} Discover</Button></div>
        {draft.providerId === 'custom' && <Field label="API protocol" required hint="Custom APIs must implement the selected chat-completions or messages protocol."><select value={draft.protocol} onChange={event => patchDraft({protocol:event.target.value as AIProviderDraft['protocol']})}><option value="openai-compatible">OpenAI-compatible</option><option value="anthropic-compatible">Anthropic-compatible</option></select></Field>}
        {(draft.providerId === 'custom' || ['openai','deepseek'].includes(draft.providerId)) && <Field label="API base URL" required hint="HTTPS only. Private, local, and link-local network endpoints are blocked."><input type="url" autoComplete="url" value={draft.baseUrl ?? ''} onChange={event => patchDraft({baseUrl:event.target.value})} placeholder={selectedProvider.defaultBaseUrl ?? 'https://api.example.com/v1'} /></Field>}
        {draft.providerId === 'qwen' && <Field label="Qwen service region" hint="The endpoint follows your selected DashScope region."><select value={draft.region ?? 'international'} onChange={event => patchDraft({region:event.target.value as 'international'|'china'})}><option value="international">International</option><option value="china">China mainland</option></select></Field>}
        {draft.providerId === 'openai' && <Field label="Organization ID" hint="Optional. Leave blank unless your OpenAI account requires it."><input maxLength={160} value={draft.organizationId ?? ''} onChange={event => patchDraft({organizationId:event.target.value})} autoComplete="off" /></Field>}
        <Field label={editing ? 'Replace API key' : 'API key'} required={!editing} hint={editing ? `Saved key: ${editing.masked_key}. Leave blank to keep it; entering a key replaces it.` : 'The key is sent over HTTPS directly to Stracker’s secure API, encrypted, and never returned.'}><input type="password" autoComplete="new-password" value={draft.apiKey ?? ''} onChange={event => patchDraft({apiKey:event.target.value})} placeholder={editing ? 'Leave blank to keep current key' : 'Paste your provider API key'} /></Field>
        {draft.providerId === 'custom' && <div className="ai-capability-box"><strong>Capabilities declared by this endpoint</strong><span>Only enable features you have verified this model supports.</span><div className="ai-capability-options">{([['supportsTools','Tool calling'],['supportsVision','Image input'],['supportsStructuredOutput','Structured output'],['supportsReasoning','Reasoning models']] as const).map(([key,label]) => <label key={key}><input type="checkbox" checked={Boolean(draft.capabilities?.[key])} onChange={event => patchDraft({capabilities:{...draft.capabilities,[key]:event.target.checked}})} /><span>{label}</span></label>)}</div></div>}
        {modelsMessage && <div className={`ai-discovery-message ${discoveryAvailable ? 'available' : ''}`} role="status">{discovering && <LoaderCircle size={14} className="spin" />}{modelsMessage}</div>}
        <div className="ai-editor-note"><KeyRound size={15} /><span>Saving changed connection details disables this provider until a fresh connection test succeeds. Test the selected model before relying on it.</span></div>
      </div>
      <div className="dialog-actions ai-editor-actions"><Button type="button" variant="secondary" onClick={closeEditor} disabled={saving}>Cancel</Button><Button type="button" loading={saving} onClick={() => void save()}><Check size={15} /> {saving ? 'Saving provider…' : editing ? 'Save changes' : 'Save provider'}</Button></div>
    </Dialog>}

    {removeTarget && <Dialog title="Remove this provider?" subtitle="Its encrypted API key and saved connection settings will be deleted from your Stracker account." onClose={() => !removing && setRemoveTarget(null)} className="dialog-narrow"><div className="ai-remove-copy"><AIProviderMark provider={removeTarget.provider_id} /><div><strong>{removeTarget.display_name || providerLabel(removeTarget.provider_id)}</strong><span>{removeTarget.masked_key} · {removeTarget.model_id}</span></div></div><div className="dialog-actions"><Button variant="secondary" onClick={() => setRemoveTarget(null)} disabled={removing}>Keep provider</Button><Button variant="danger" loading={removing} onClick={() => void confirmRemove()}><Trash2 size={15} /> Remove key</Button></div></Dialog>}
  </>
}
