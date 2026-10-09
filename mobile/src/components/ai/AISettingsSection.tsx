import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { AlertTriangle, Check, CircleHelp, KeyRound, LoaderCircle, Pencil, Plus, RefreshCw, ShieldCheck, Sparkles, Star, Trash2 } from '../icons'
import { useTheme } from '../../contexts/AppearanceContext'
import { useAI, type AIProviderDraft } from '../../contexts/AIContext'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { AI_PROVIDERS, AI_STATUS_COPY, DEFAULT_CAPABILITIES, providerLabel, statusTone, type AIModelOption, type AIProviderConfig, type AIProviderId } from '../../shared/lib/ai/catalog'
import { defaultModelFor } from '../../shared/lib/ai/model-catalog'
import { Button } from '../ui/Button'
import { Chip, SelectField, SwitchRow, TextField } from '../ui/Forms'
import { ConfirmDialog, Dialog } from '../ui/Overlays'
import { NotebookCard, StatusBadge } from '../ui/Surfaces'
import { AIProviderMark } from './AIProviderMark'

const DEFAULT_MODEL: Record<AIProviderId, string> = {
  gemini: defaultModelFor('gemini'), openai: defaultModelFor('openai'), anthropic: defaultModelFor('anthropic'),
  deepseek: defaultModelFor('deepseek'), qwen: defaultModelFor('qwen'), custom: ''
}

const CAPABILITY_OPTIONS = [
  { key: 'supportsTools', label: 'Tool calling' },
  { key: 'supportsVision', label: 'Image input' },
  { key: 'supportsStructuredOutput', label: 'Structured output' },
  { key: 'supportsReasoning', label: 'Reasoning models' }
] as const

/** Connect, test, prefer, and remove AI providers. Keys are sent to Stracker's API and never come back. */
export function AISettingsSection() {
  const theme = useTheme()
  const router = useRouter()
  const { user } = useAuth()
  const { providers, providersLoading, providersError, backendStatus, backendHealth, checkBackendHealth, refreshProviders, saveProvider, testProvider, patchProvider, removeProvider, discoverModels } = useAI()
  const { notify } = useToast()
  const [editing, setEditing] = useState<AIProviderConfig | null>(null)
  const [draft, setDraft] = useState<AIProviderDraft | null>(null)
  const [models, setModels] = useState<AIModelOption[]>([])
  const [modelsMessage, setModelsMessage] = useState('')
  const [discoveryAvailable, setDiscoveryAvailable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<AIProviderConfig | null>(null)
  const [removing, setRemoving] = useState(false)

  const openNew = () => {
    setEditing(null); setModels([]); setModelsMessage(''); setDiscoveryAvailable(false)
    setDraft({ providerId: 'gemini', displayName: '', modelId: '', apiKey: '', baseUrl: null, protocol: 'google', region: 'international', capabilities: { ...DEFAULT_CAPABILITIES } })
  }
  const openEdit = (provider: AIProviderConfig) => {
    setEditing(provider); setModels([]); setModelsMessage(''); setDiscoveryAvailable(false)
    setDraft({
      id: provider.id, providerId: provider.provider_id, displayName: provider.display_name, modelId: provider.model_id, apiKey: '',
      baseUrl: provider.base_url, protocol: provider.protocol, organizationId: provider.organization_id,
      region: provider.region === 'china' ? 'china' : 'international', capabilities: { ...provider.capabilities }
    })
  }
  const closeEditor = () => { setDraft(null); setEditing(null); setModels([]); setModelsMessage(''); setSaving(false); setDiscovering(false) }
  const patchDraft = (patch: Partial<AIProviderDraft>) => setDraft(current => (current ? { ...current, ...patch } : current))

  const usesBaseUrl = (providerId: AIProviderId) => providerId === 'custom' || providerId === 'openai' || providerId === 'deepseek'

  const save = async () => {
    if (!draft || saving) return
    if (!draft.modelId.trim()) { notify('Choose or enter a model ID before saving.', 'error'); return }
    if (!editing && !draft.apiKey?.trim()) { notify('Enter your provider API key before saving.', 'error'); return }
    setSaving(true)
    try {
      const saved = await saveProvider({
        ...draft,
        displayName: draft.displayName?.trim() || undefined,
        modelId: draft.modelId.trim(),
        apiKey: draft.apiKey?.trim() || undefined,
        baseUrl: usesBaseUrl(draft.providerId) ? draft.baseUrl?.trim() || null : undefined,
        organizationId: draft.providerId === 'openai' ? draft.organizationId?.trim() || null : undefined
      })
      notify(editing ? 'Provider settings saved. Test the connection again before using changed settings.' : `${providerLabel(saved.provider_id)} saved. Test the connection to enable it.`)
      closeEditor()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Provider settings could not be saved.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const discover = async () => {
    if (!draft || discovering) return
    if (!editing && !draft.apiKey?.trim()) { notify('Enter the provider API key before discovering models.', 'error'); return }
    if (editing && !draft.apiKey?.trim()) {
      const changedConnection = draft.baseUrl !== editing.base_url || draft.protocol !== editing.protocol || draft.organizationId !== editing.organization_id
        || draft.region !== (editing.region === 'china' ? 'china' : 'international') || JSON.stringify(draft.capabilities ?? {}) !== JSON.stringify(editing.capabilities ?? {})
      if (changedConnection) { notify('Save these connection changes first, then reopen this provider to discover models.', 'info'); return }
    }
    setDiscovering(true); setModelsMessage(''); setModels([])
    try {
      const result = await discoverModels({
        ...draft,
        modelId: draft.modelId.trim() || DEFAULT_MODEL[draft.providerId],
        baseUrl: usesBaseUrl(draft.providerId) ? draft.baseUrl?.trim() || null : undefined,
        organizationId: draft.providerId === 'openai' ? draft.organizationId?.trim() || null : undefined
      })
      setModels(result.models ?? [])
      setDiscoveryAvailable(Boolean(result.discoveryAvailable))
      setModelsMessage(result.message ?? (result.models.length ? `Found ${result.models.length} available models.` : 'No models were listed. Enter a model ID manually.'))
      if (result.models.length && !result.models.some(model => model.id === draft.modelId)) patchDraft({ modelId: result.models[0]?.id ?? draft.modelId })
    } catch (error) {
      setModelsMessage(error instanceof Error ? error.message : 'Models could not be loaded. Enter a model ID manually.')
    } finally {
      setDiscovering(false)
    }
  }

  const runProviderAction = async (id: string, action: 'test' | 'enable' | 'disable' | 'default') => {
    setWorkingId(id)
    try {
      if (action === 'test') await testProvider(id)
      else await patchProvider(id, action)
      notify(action === 'test' ? 'Provider connection successful.' : action === 'disable' ? 'Provider disabled.' : action === 'default' ? 'Preferred AI updated.' : 'Provider enabled.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'That provider action failed. Try again.', 'error')
    } finally {
      setWorkingId(null)
    }
  }

  const confirmRemove = async () => {
    if (!removeTarget || removing) return
    setRemoving(true)
    try {
      await removeProvider(removeTarget.id)
      notify(`${providerLabel(removeTarget.provider_id)} credentials removed from Stracker.`)
      setRemoveTarget(null)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The provider could not be removed.', 'error')
    } finally {
      setRemoving(false)
    }
  }

  const selectedProvider = draft ? AI_PROVIDERS.find(provider => provider.id === draft.providerId) : null
  const providerChanged = (providerId: AIProviderId) => {
    const definition = AI_PROVIDERS.find(provider => provider.id === providerId)
    patchDraft({
      providerId, protocol: definition?.protocol ?? 'openai-compatible', baseUrl: definition?.defaultBaseUrl ?? null,
      modelId: DEFAULT_MODEL[providerId], organizationId: '', region: 'international', capabilities: { ...DEFAULT_CAPABILITIES }
    })
    setModels([]); setModelsMessage(''); setDiscoveryAvailable(false)
  }

  const healthNames = [...(backendHealth?.missing ?? []), ...(backendHealth?.invalid ?? [])]

  return (
    <>
      <NotebookCard style={styles.card}>
        <View style={styles.heading}>
          <View style={[styles.sparkIcon, { backgroundColor: theme.colors.surfaceCoolAccentBg }]}>
            <Sparkles size={18} color={theme.colors.accent} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[theme.type.label, { color: theme.colors.ink }]}>AI Assistant</Text>
            <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13 }]}>Connect an AI provider with your own API key. Stracker does not provide or pay for AI usage.</Text>
          </View>
        </View>
        <Button variant="secondary" size="sm" icon={<Sparkles size={15} color={theme.colors.ink} />} onPress={() => router.navigate('/assistant' as never)}>
          Open assistant
        </Button>

        <View style={[styles.privacy, { borderColor: theme.colors.surfaceCoolBorder, backgroundColor: theme.colors.surfaceCool }]} accessibilityRole="text">
          <ShieldCheck size={17} color={theme.colors.surfaceCoolInk} />
          <Text style={[theme.type.caption, { color: theme.colors.surfaceCoolInk, flex: 1 }]}>
            <Text style={{ fontFamily: theme.fonts.bodyBold }}>Your key stays server-side. </Text>
            Provider credentials are encrypted at rest and are never stored on this device or returned to the app. Your messages and relevant Stracker data are sent to the provider you choose; provider billing, quota, and privacy terms apply.
          </Text>
        </View>

        {user?.isLocal ? (
          <Notice text="AI requires a signed-in cloud account and the secure server configuration. Local preview stays available without AI or network dependencies." />
        ) : null}
        {!user?.isLocal && backendStatus === 'misconfigured' ? (
          <Notice tone="alert" onRetry={() => void checkBackendHealth()} retryLabel="Recheck" text={`The Stracker AI backend is not configured for this deployment. The administrator must finish the server setup. The server reports: ${backendHealth?.reason ?? 'incomplete server configuration'}${healthNames.length ? ` Missing or malformed: ${healthNames.join(', ')}.` : ''} Provider keys cannot be saved until it is fixed.`} />
        ) : null}
        {!user?.isLocal && backendStatus === 'unreachable' ? (
          <Notice tone="alert" onRetry={() => void checkBackendHealth()} retryLabel="Recheck" text="The Stracker AI backend is unavailable. The deployed app has no /api/ai functions. Deploy the Vercel AI backend and try again." />
        ) : null}
        {providersError && !user?.isLocal && backendStatus !== 'misconfigured' && backendStatus !== 'unreachable' ? (
          <Notice text={providersError} onRetry={() => void refreshProviders()} retryLabel="Retry" />
        ) : null}

        <View style={styles.list} accessibilityLiveRegion="polite">
          {providersLoading && providers.length === 0 ? (
            <View style={styles.loading}><LoaderCircle size={17} color={theme.colors.muted} /><Text style={[theme.type.caption, { color: theme.colors.muted }]}>Checking provider connections…</Text></View>
          ) : providers.length ? (
            providers.map(provider => {
              const busy = workingId === provider.id
              const canEnable = !provider.enabled && provider.connection_status === 'connected'
              return (
                <View key={provider.id} style={[styles.row, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
                  <View style={styles.rowTop}>
                    <AIProviderMark provider={provider.provider_id} />
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={styles.titleLine}>
                        <Text style={[theme.type.label, { color: theme.colors.ink }]}>{provider.display_name || providerLabel(provider.provider_id)}</Text>
                        <StatusBadge tone={statusTone(provider.connection_status)}>{AI_STATUS_COPY[provider.connection_status]}</StatusBadge>
                        {provider.is_default ? <StatusBadge tone="info">Preferred</StatusBadge> : null}
                      </View>
                      <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>
                        {`${provider.model_id} · ${provider.masked_key} · ${provider.enabled ? 'Enabled' : 'Disabled'}`}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.rowActions}>
                    <Button size="sm" variant="quiet" onPress={() => void runProviderAction(provider.id, 'test')} disabled={busy} loading={busy} icon={<RefreshCw size={14} color={theme.colors.ink} />}>Test</Button>
                    {canEnable ? (
                      <Button size="sm" variant="secondary" onPress={() => void runProviderAction(provider.id, 'enable')} disabled={busy} icon={<Check size={14} color={theme.colors.ink} />}>Enable</Button>
                    ) : provider.enabled ? (
                      <Button size="sm" variant="quiet" onPress={() => void runProviderAction(provider.id, 'disable')} disabled={busy}>Disable</Button>
                    ) : null}
                    {provider.enabled && !provider.is_default ? (
                      <Button size="sm" variant="quiet" onPress={() => void runProviderAction(provider.id, 'default')} disabled={busy} icon={<Star size={14} color={theme.colors.ink} />}>Preferred</Button>
                    ) : null}
                    <Button size="sm" variant="quiet" onPress={() => openEdit(provider)} accessibilityLabel={`Edit ${provider.display_name}`} icon={<Pencil size={14} color={theme.colors.ink} />}>Edit</Button>
                    <Button size="sm" variant="quiet" onPress={() => setRemoveTarget(provider)} accessibilityLabel={`Remove ${provider.display_name}`} icon={<Trash2 size={14} color={theme.colors.red} />}>Remove</Button>
                  </View>
                </View>
              )
            })
          ) : !providersError && !user?.isLocal ? (
            <View style={[styles.empty, { borderColor: theme.colors.line }]}>
              <AIProviderMark provider="gemini" />
              <View style={{ flex: 1 }}>
                <Text style={[theme.type.label, { color: theme.colors.ink }]}>No AI provider connected yet.</Text>
                <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13 }]}>Add your own API key to get started.</Text>
              </View>
            </View>
          ) : null}
        </View>

        {!user?.isLocal ? (
          <View style={styles.footer}>
            <View style={styles.footerNote}>
              <CircleHelp size={14} color={theme.colors.muted} />
              <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13, flex: 1 }]}>Configure one or more providers for transparent fallback.</Text>
            </View>
            <Button size="sm" onPress={openNew} icon={<Plus size={15} color={theme.colors.buttonPrimaryInk} />}>Add provider</Button>
          </View>
        ) : null}
        <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>
          Provider terms and model data-retention settings are controlled by the provider. Never enter another person’s credentials or sensitive personal information.
        </Text>
      </NotebookCard>

      <Dialog
        visible={draft !== null && selectedProvider !== null && selectedProvider !== undefined}
        onClose={closeEditor}
        title={editing ? `Edit ${providerLabel(editing.provider_id)}` : 'Connect an AI provider'}
        subtitle="Use a key from your provider account. Stracker never supplies a substitute key."
      >
        {draft && selectedProvider ? (
          <View style={styles.editor}>
            <View style={styles.choiceGrid} accessibilityRole="radiogroup">
              {AI_PROVIDERS.map(provider => (
                <Chip key={provider.id} label={provider.shortLabel} selected={draft.providerId === provider.id} onPress={() => providerChanged(provider.id)} />
              ))}
            </View>
            <TextField label="Display name" hint="Optional name used in the assistant and fallback notices." value={draft.displayName ?? ''} onChangeText={value => patchDraft({ displayName: value })} placeholder={selectedProvider.label} maxLength={80} />
            <View style={{ gap: 8 }}>
              <TextField label="Model ID" required hint="Use Discover when supported, or enter a model ID from your provider account." value={draft.modelId} onChangeText={value => patchDraft({ modelId: value })} placeholder={DEFAULT_MODEL[draft.providerId] || 'e.g. provider-model-name'} autoCapitalize="none" autoCorrect={false} />
              <Button variant="secondary" size="sm" onPress={() => void discover()} disabled={discovering || saving} loading={discovering} icon={<RefreshCw size={15} color={theme.colors.ink} />}>
                Discover models
              </Button>
              {models.length ? (
                <View style={styles.choiceGrid}>
                  {models.slice(0, 12).map(model => (
                    <Chip key={model.id} label={model.name || model.id} selected={draft.modelId === model.id} onPress={() => patchDraft({ modelId: model.id })} />
                  ))}
                </View>
              ) : null}
            </View>
            {draft.providerId === 'custom' ? (
              <SelectField<'openai-compatible' | 'anthropic-compatible'>
                label="API protocol"
                required
                hint="Custom APIs must implement the selected chat-completions or messages protocol."
                value={draft.protocol === 'anthropic-compatible' ? 'anthropic-compatible' : 'openai-compatible'}
                options={[{ value: 'openai-compatible', label: 'OpenAI-compatible' }, { value: 'anthropic-compatible', label: 'Anthropic-compatible' }]}
                onChange={value => patchDraft({ protocol: value })}
              />
            ) : null}
            {usesBaseUrl(draft.providerId) ? (
              <TextField label="API base URL" required hint="HTTPS only. Private, local, and link-local network endpoints are blocked." value={draft.baseUrl ?? ''} onChangeText={value => patchDraft({ baseUrl: value })} placeholder={selectedProvider.defaultBaseUrl ?? 'https://api.example.com/v1'} autoCapitalize="none" keyboardType="url" autoCorrect={false} />
            ) : null}
            {draft.providerId === 'qwen' ? (
              <SelectField<'international' | 'china'>
                label="Qwen service region"
                hint="The endpoint follows your selected DashScope region."
                value={draft.region === 'china' ? 'china' : 'international'}
                options={[{ value: 'international', label: 'International' }, { value: 'china', label: 'China mainland' }]}
                onChange={value => patchDraft({ region: value })}
              />
            ) : null}
            {draft.providerId === 'openai' ? (
              <TextField label="Organization ID" hint="Optional. Leave blank unless your OpenAI account requires it." value={draft.organizationId ?? ''} onChangeText={value => patchDraft({ organizationId: value })} maxLength={160} autoCapitalize="none" autoCorrect={false} />
            ) : null}
            <TextField
              label={editing ? 'Replace API key' : 'API key'}
              required={!editing}
              hint={editing ? `Saved key: ${editing.masked_key}. Leave blank to keep it; entering a key replaces it.` : 'The key is sent over HTTPS directly to Stracker’s secure API, encrypted, and never returned.'}
              value={draft.apiKey ?? ''}
              onChangeText={value => patchDraft({ apiKey: value })}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={editing ? 'Leave blank to keep current key' : 'Paste your provider API key'}
            />
            {draft.providerId === 'custom' ? (
              <View style={[styles.capabilityBox, { borderColor: theme.colors.line }]}>
                <Text style={[theme.type.label, { color: theme.colors.ink }]}>Capabilities declared by this endpoint</Text>
                <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13 }]}>Only enable features you have verified this model supports.</Text>
                {CAPABILITY_OPTIONS.map(option => (
                  <SwitchRow
                    key={option.key}
                    label={option.label}
                    value={Boolean(draft.capabilities?.[option.key])}
                    onValueChange={value => patchDraft({ capabilities: { ...draft.capabilities, [option.key]: value } })}
                  />
                ))}
              </View>
            ) : null}
            {modelsMessage ? (
              <View style={[styles.discovery, { borderColor: theme.colors.line, backgroundColor: discoveryAvailable ? theme.colors.greenBg : theme.colors.paperSoft }]} accessibilityLiveRegion="polite">
                <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>{modelsMessage}</Text>
              </View>
            ) : null}
            <View style={[styles.editorNote, { borderColor: theme.colors.line }]}>
              <KeyRound size={15} color={theme.colors.muted} />
              <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13, flex: 1 }]}>
                Saving changed connection details disables this provider until a fresh connection test succeeds. Test the selected model before relying on it.
              </Text>
            </View>
            <View style={styles.editorActions}>
              <Button variant="secondary" onPress={closeEditor} disabled={saving}>Cancel</Button>
              <Button onPress={() => void save()} loading={saving} icon={<Check size={15} color={theme.colors.buttonPrimaryInk} />}>
                {saving ? 'Saving provider…' : editing ? 'Save changes' : 'Save provider'}
              </Button>
            </View>
          </View>
        ) : null}
      </Dialog>

      <ConfirmDialog
        visible={removeTarget !== null}
        title="Remove this provider?"
        message={removeTarget ? `${removeTarget.display_name || providerLabel(removeTarget.provider_id)} (${removeTarget.masked_key}, ${removeTarget.model_id}). Its encrypted API key and saved connection settings will be deleted from your Stracker account.` : ''}
        confirmLabel="Remove key"
        loading={removing}
        onConfirm={() => void confirmRemove()}
        onCancel={() => { if (!removing) setRemoveTarget(null) }}
      />
    </>
  )
}

function Notice({ text, tone = 'info', onRetry, retryLabel }: { text: string; tone?: 'info' | 'alert'; onRetry?: () => void; retryLabel?: string }) {
  const theme = useTheme()
  const alert = tone === 'alert'
  return (
    <View accessibilityRole={alert ? 'alert' : 'text'} style={[styles.notice, { borderColor: alert ? theme.colors.red : theme.colors.line, backgroundColor: alert ? theme.colors.redBg : theme.colors.paperSoft }]}>
      <AlertTriangle size={17} color={alert ? theme.colors.red : theme.colors.muted} />
      <Text style={[theme.type.caption, { color: theme.colors.inkSoft, flex: 1 }]}>{text}</Text>
      {onRetry ? <Button variant="quiet" size="sm" onPress={onRetry}>{retryLabel ?? 'Retry'}</Button> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: 14 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  sparkIcon: { width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 11, flexWrap: 'wrap' },
  list: { gap: 10 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  titleLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  empty: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderStyle: 'dashed', borderRadius: 14, padding: 14 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  footerNote: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  editor: { gap: 14 },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  capabilityBox: { gap: 6, borderWidth: 1, borderRadius: 12, padding: 12 },
  discovery: { borderWidth: 1, borderRadius: 12, padding: 10 },
  editorNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 12, padding: 10 },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10 }
})
