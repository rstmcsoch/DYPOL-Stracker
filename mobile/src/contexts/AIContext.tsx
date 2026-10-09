import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AIModelOption, AIProviderConfig, AIProviderId } from '../shared/lib/ai/catalog'
import { redactPotentialSecrets } from '../shared/lib/ai/sanitize'
import { createId } from '../shared/lib/id'
import { supabase } from '../lib/supabase'
import { AIRequestError, apiJson, fetchBackendHealth, streamChat, type SseEvent } from '../lib/ai/transport'
import { useAuth } from './AuthContext'
import { useData } from './DataContext'

export interface AIConversationSummary { id: string; title: string; created_at: string; updated_at: string }
export interface AIRecentTask { id: string; conversation_id: string; provider_id: string | null; model_id: string | null; task_type: string; status: AITaskState['status']; progress: string; started_at: string; completed_at: string | null }
export interface AIActionConfirmation {
  actionId: string
  taskId: string
  toolName: string
  title: string
  fields: { label: string; value: string }[]
  expiresAt: string
}
export interface AIMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  providerId?: string | null
  modelId?: string | null
  status?: 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting'
  fallbackFrom?: { providerId: string; providerName: string; modelId: string } | null
  confirmation?: AIActionConfirmation
  result?: Record<string, unknown> | null
  error?: string | null
  retryable?: boolean
  createdAt: string
}
export interface AITaskState {
  id: string
  conversationId: string | null
  status: 'queued' | 'running' | 'tool_call' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'fallback' | 'retrying'
  progress: string
  providerId?: string | null
  modelId?: string | null
  cancellable?: boolean
  startedAt: string
}
export interface AIProviderDraft {
  id?: string
  providerId: AIProviderId
  displayName?: string
  modelId: string
  apiKey?: string
  baseUrl?: string | null
  protocol?: 'google' | 'openai-compatible' | 'anthropic-compatible'
  organizationId?: string | null
  region?: 'international' | 'china'
  capabilities?: Record<string, boolean>
}
export type AIBackendStatus = 'unknown' | 'ok' | 'misconfigured' | 'unreachable'
export interface AIBackendHealth { configured: boolean; reason?: string | null; missing?: string[]; invalid?: string[] }

interface LastRequest { message: string; messageId: string; assistantId: string; pageContext: string | null }

interface AIContextValue {
  providers: AIProviderConfig[]
  providersLoading: boolean
  providersError: string | null
  backendStatus: AIBackendStatus
  backendHealth: AIBackendHealth | null
  checkBackendHealth: () => Promise<void>
  refreshProviders: () => Promise<void>
  discoverModels: (draft: AIProviderDraft) => Promise<{ models: AIModelOption[]; discoveryAvailable: boolean; message?: string }>
  saveProvider: (draft: AIProviderDraft) => Promise<AIProviderConfig>
  testProvider: (id: string) => Promise<void>
  patchProvider: (id: string, action: 'enable' | 'disable' | 'default') => Promise<void>
  removeProvider: (id: string) => Promise<void>
  recentConversations: AIConversationSummary[]
  recentTasks: AIRecentTask[]
  loadConversations: () => Promise<void>
  loadTasks: () => Promise<void>
  openConversation: (id: string) => Promise<void>
  clearConversation: () => Promise<void>
  newConversation: () => void
  conversationId: string | null
  conversationTitle: string
  messages: AIMessage[]
  activeTask: AITaskState | null
  isBusy: boolean
  lastRequest: LastRequest | null
  sendMessage: (message: string, pageContext?: string | null) => Promise<void>
  retryLast: () => Promise<void>
  stopTask: () => void
  confirmAction: (actionId: string, approved: boolean) => Promise<boolean>
}

const AIContext = createContext<AIContextValue | null>(null)

function mapStoredMessage(value: Record<string, unknown>): AIMessage {
  const metadata = value.metadata && typeof value.metadata === 'object' ? value.metadata as Record<string, unknown> : {}
  const fallback = metadata.fallback_from && typeof metadata.fallback_from === 'object' ? metadata.fallback_from as Record<string, unknown> : null
  const actionResult = metadata.action_result && typeof metadata.action_result === 'object' ? metadata.action_result as Record<string, unknown> : null
  return {
    id: String(value.id),
    role: value.role === 'user' ? 'user' : 'assistant',
    content: String(value.content ?? ''),
    providerId: typeof value.provider_id === 'string' ? value.provider_id : null,
    modelId: typeof value.model_id === 'string' ? value.model_id : null,
    status: (value.status as AIMessage['status']) ?? 'completed',
    fallbackFrom: fallback ? { providerId: String(fallback.provider_id ?? ''), providerName: String(fallback.provider_name ?? fallback.provider_id ?? 'AI'), modelId: String(fallback.model_id ?? '') } : null,
    result: actionResult,
    retryable: metadata.action_failed === true ? false : undefined,
    createdAt: String(value.created_at ?? new Date().toISOString())
  }
}

const TERMINAL_ACTION_ERRORS = ['action_save_failed', 'action_expired', 'action_already_handled', 'action_not_found', 'invalid_confirmation']
const BUSY_STATUSES = ['queued', 'running', 'tool_call', 'fallback', 'retrying']
const STOPPED_MESSAGE = 'Request stopped. No Stracker change was made.'

/**
 * Stracker AI state. The conversation, streaming, confirmation, and provider behaviour is the same as the
 * website's AIContext. Only the transport differs: the app calls the deployed `/api/ai/*` routes with the
 * user's session token and parses the same SSE events.
 */
export function AIProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { refresh } = useData()
  const [providers, setProviders] = useState<AIProviderConfig[]>([])
  const [providersLoading, setProvidersLoading] = useState(false)
  const [providersError, setProvidersError] = useState<string | null>(null)
  const [backendStatus, setBackendStatus] = useState<AIBackendStatus>('unknown')
  const [backendHealth, setBackendHealth] = useState<AIBackendHealth | null>(null)
  const [recentConversations, setRecentConversations] = useState<AIConversationSummary[]>([])
  const [recentTasks, setRecentTasks] = useState<AIRecentTask[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversationTitle, setConversationTitle] = useState('New conversation')
  const [messages, setMessages] = useState<AIMessage[]>([])
  const [activeTask, setActiveTask] = useState<AITaskState | null>(null)
  const [lastRequest, setLastRequest] = useState<LastRequest | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const inflightRequestIdRef = useRef<string | null>(null)
  const conversationRef = useRef<string | null>(null)
  const requestLockRef = useRef(false)
  const actionLocksRef = useRef(new Set<string>())
  const messagesRef = useRef<AIMessage[]>([])
  useEffect(() => {
    messagesRef.current = messages
    conversationRef.current = conversationId
  }, [messages, conversationId])

  const signedIn = Boolean(user && supabase)

  const accessToken = useCallback(async (): Promise<string> => {
    if (!user || !supabase) throw new Error('Sign in to a Stracker account to use AI Assistant.')
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session?.access_token) throw new Error('Your Stracker session expired. Sign in again to use AI Assistant.')
    return data.session.access_token
  }, [user])

  const apiFetch = useCallback(async <T,>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
    const token = await accessToken()
    return apiJson<T>(path, { ...init, token })
  }, [accessToken])

  const checkBackendHealth = useCallback(async () => {
    const payload = await fetchBackendHealth()
    if (!payload) {
      setBackendStatus('unreachable')
      setBackendHealth(null)
      return
    }
    setBackendHealth(payload)
    setBackendStatus(payload.configured ? 'ok' : 'misconfigured')
  }, [])

  const refreshProviders = useCallback(async () => {
    if (!signedIn) { setProviders([]); setProvidersError(null); return }
    setProvidersLoading(true)
    try {
      const result = await apiFetch<{ providers: AIProviderConfig[] }>('/api/ai/providers')
      setProviders(result.providers ?? [])
      setProvidersError(null)
    } catch (error) {
      setProvidersError(error instanceof Error ? error.message : 'Provider settings could not be loaded.')
    } finally {
      setProvidersLoading(false)
    }
  }, [signedIn, apiFetch])

  const loadConversations = useCallback(async () => {
    if (!signedIn) { setRecentConversations([]); return }
    try {
      const result = await apiFetch<{ conversations: AIConversationSummary[] }>('/api/ai/conversations')
      setRecentConversations(result.conversations ?? [])
    } catch { /* History is optional while the backend is unavailable. */ }
  }, [signedIn, apiFetch])

  const loadTasks = useCallback(async () => {
    if (!signedIn) { setRecentTasks([]); return }
    try {
      const result = await apiFetch<{ tasks: AIRecentTask[] }>('/api/ai/tasks')
      setRecentTasks(result.tasks ?? [])
    } catch { /* Task history is optional. */ }
  }, [signedIn, apiFetch])

  // Signing out clears everything the account owned. This runs during render, when the signed-in state
  // changes, so the next frame never shows the previous account's conversations.
  const [signedInSeen, setSignedInSeen] = useState(signedIn)
  if (signedInSeen !== signedIn) {
    setSignedInSeen(signedIn)
    if (!signedIn) {
      setProviders([]); setRecentConversations([]); setRecentTasks([]); setConversationId(null); setMessages([]); setActiveTask(null)
      setBackendStatus('unknown'); setBackendHealth(null)
    }
  }

  useEffect(() => {
    if (!signedIn) return
    // Loading the account's AI state from the server on sign-in is an external sync, which effects exist for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkBackendHealth()
    void Promise.all([refreshProviders(), loadConversations(), loadTasks()])
  }, [signedIn, user?.id, checkBackendHealth, refreshProviders, loadConversations, loadTasks])

  const discoverModels = useCallback(async (draft: AIProviderDraft) => {
    const { id, ...setup } = draft
    const useSaved = Boolean(id && !draft.apiKey)
    return apiFetch<{ models: AIModelOption[]; discoveryAvailable: boolean; message?: string }>('/api/ai/models', { method: 'POST', body: useSaved ? { configId: id } : setup })
  }, [apiFetch])

  const saveProvider = useCallback(async (draft: AIProviderDraft) => {
    const result = await apiFetch<{ provider?: AIProviderConfig }>('/api/ai/providers', { method: 'POST', body: draft })
    await refreshProviders()
    if (!result.provider) throw new AIRequestError('The provider was not saved. Try again.', 'provider_not_returned', 200)
    return result.provider
  }, [apiFetch, refreshProviders])

  const testProvider = useCallback(async (id: string) => {
    try { await apiFetch('/api/ai/test-connection', { method: 'POST', body: { configId: id } }) }
    finally { await refreshProviders() }
  }, [apiFetch, refreshProviders])

  const patchProvider = useCallback(async (id: string, action: 'enable' | 'disable' | 'default') => {
    await apiFetch('/api/ai/providers', { method: 'PATCH', body: { id, action } })
    await refreshProviders()
  }, [apiFetch, refreshProviders])

  const removeProvider = useCallback(async (id: string) => {
    await apiFetch('/api/ai/providers', { method: 'DELETE', body: { id } })
    await refreshProviders()
  }, [apiFetch, refreshProviders])

  const openConversation = useCallback(async (id: string) => {
    if (requestLockRef.current) return
    const result = await apiFetch<{ conversation: Record<string, unknown>; messages: Record<string, unknown>[]; pendingActions?: Record<string, unknown>[] }>(`/api/ai/conversations?id=${encodeURIComponent(id)}`)
    conversationRef.current = String(result.conversation.id)
    setConversationId(String(result.conversation.id))
    setConversationTitle(String(result.conversation.title ?? 'Conversation'))
    const stored = (result.messages ?? []).map(mapStoredMessage)
    const pending: AIMessage[] = (result.pendingActions ?? []).map(action => {
      const summary = action.summary && typeof action.summary === 'object' ? action.summary as Record<string, unknown> : {}
      return {
        id: `pending-${String(action.id)}`,
        role: 'assistant',
        content: 'I prepared this Stracker change. Review the details and confirm or cancel below.',
        status: 'waiting',
        providerId: typeof action.provider_id === 'string' ? action.provider_id : null,
        modelId: typeof action.model_id === 'string' ? action.model_id : null,
        confirmation: {
          actionId: String(action.id),
          taskId: String(action.task_id),
          toolName: String(action.tool_name),
          title: String(summary.title ?? 'Confirm this Stracker change?'),
          fields: Array.isArray(summary.fields) ? summary.fields as AIActionConfirmation['fields'] : [],
          expiresAt: String(action.expires_at ?? '')
        },
        createdAt: String(action.created_at ?? new Date().toISOString())
      }
    })
    setMessages([...stored, ...pending].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    setActiveTask(null)
    setLastRequest(null)
  }, [apiFetch])

  const newConversation = useCallback(() => {
    if (requestLockRef.current) return
    conversationRef.current = null
    setConversationId(null); setConversationTitle('New conversation'); setMessages([]); setActiveTask(null); setLastRequest(null)
  }, [])

  const clearConversation = useCallback(async () => {
    if (requestLockRef.current) throw new Error('Wait for the current AI task to finish before clearing this conversation.')
    const current = conversationRef.current
    if (current) await apiFetch('/api/ai/conversations', { method: 'DELETE', body: { id: current } })
    conversationRef.current = null
    setConversationId(null); setConversationTitle('New conversation'); setMessages([]); setActiveTask(null); setLastRequest(null)
    await loadConversations()
  }, [apiFetch, loadConversations])

  const sendMessage = useCallback(async (rawMessage: string, pageContext: string | null = null, retry?: LastRequest) => {
    if (requestLockRef.current) return
    const message = redactPotentialSecrets(rawMessage.trim()).slice(0, 4000)
    if (!message) return
    const requestId = createId()
    const messageId = retry?.messageId ?? createId()
    const assistantId = retry?.assistantId ?? `assistant-${messageId}`
    const context = retry?.pageContext ?? pageContext
    const state: LastRequest = { message, messageId, assistantId, pageContext: context }
    const now = new Date().toISOString()
    if (!retry) {
      setMessages(current => [...current, { id: messageId, role: 'user', content: message, status: 'completed', createdAt: now }, { id: assistantId, role: 'assistant', content: '', status: 'running', createdAt: now }])
    } else {
      setMessages(current => current.map(item => item.id === assistantId ? { ...item, content: '', status: 'running', error: null, confirmation: undefined, result: null } : item))
    }
    setLastRequest(state)
    requestLockRef.current = true
    const controller = new AbortController()
    controllerRef.current = controller
    inflightRequestIdRef.current = requestId
    setActiveTask({ id: requestId, conversationId: conversationRef.current, status: 'queued', progress: 'Connecting to your AI provider…', cancellable: true, startedAt: now })

    const setAssistant = (patch: Partial<AIMessage>) => setMessages(current => current.map(item => item.id === assistantId ? { ...item, ...patch } : item))
    const failWith = (text: string) => {
      setAssistant({ status: 'failed', content: text, error: text })
      setActiveTask(current => current ? { ...current, status: 'failed', progress: 'Request failed.' } : current)
    }
    let responseText = ''
    let pendingDelta = ''
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    let finalEventSeen = false
    const flushDelta = () => {
      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = null
      if (!pendingDelta) return
      const delta = pendingDelta
      pendingDelta = ''
      setMessages(current => current.map(item => item.id === assistantId ? { ...item, content: item.content + delta, status: 'running' } : item))
    }
    const appendDelta = (delta: string) => {
      responseText += delta
      pendingDelta += delta
      if (!flushTimer) flushTimer = setTimeout(flushDelta, 45)
    }
    const handleEvent = ({ name, data: payload }: SseEvent) => {
      if (name === 'task') {
        if (typeof payload.conversationId === 'string') {
          conversationRef.current = payload.conversationId
          setConversationId(payload.conversationId)
        }
        if (typeof payload.id === 'string') {
          setActiveTask(current => current ? { ...current, id: payload.id as string, conversationId: typeof payload.conversationId === 'string' ? payload.conversationId : current.conversationId, status: (payload.status as AITaskState['status']) ?? 'running', progress: 'Thinking…' } : current)
          void loadTasks()
        }
      } else if (name === 'status') {
        setActiveTask(current => current ? {
          ...current,
          status: (payload.status as AITaskState['status']) ?? current.status,
          progress: typeof payload.progress === 'string' ? payload.progress : current.progress,
          providerId: typeof payload.providerId === 'string' ? payload.providerId : current.providerId,
          modelId: typeof payload.modelId === 'string' ? payload.modelId : current.modelId
        } : current)
      } else if (name === 'delta') {
        if (typeof payload.text === 'string') appendDelta(payload.text)
      } else if (name === 'reset') {
        pendingDelta = ''
        responseText = ''
        if (flushTimer) clearTimeout(flushTimer)
        flushTimer = null
        setAssistant({ content: '', status: 'running' })
      } else if (name === 'fallback') {
        setActiveTask(current => current ? {
          ...current,
          status: 'fallback',
          progress: typeof payload.reason === 'string' ? `Switching to ${String(payload.to)}…` : 'Switching to a configured fallback…',
          fallbackFrom: { providerId: String(payload.from ?? ''), providerName: String(payload.from ?? 'AI'), modelId: '' }
        } as AITaskState : current)
      } else if (name === 'confirmation') {
        const action = payload.action as Record<string, unknown> | undefined
        if (action && typeof action.actionId === 'string') {
          const confirmation: AIActionConfirmation = {
            actionId: action.actionId,
            taskId: String(action.taskId ?? ''),
            toolName: String(action.toolName ?? ''),
            title: String(action.title ?? 'Confirm this Stracker change?'),
            fields: Array.isArray(action.fields) ? action.fields as AIActionConfirmation['fields'] : [],
            expiresAt: String(action.expiresAt ?? '')
          }
          flushDelta()
          setAssistant({ status: 'waiting', confirmation, providerId: typeof payload.providerId === 'string' ? payload.providerId : null, modelId: typeof payload.modelId === 'string' ? payload.modelId : null })
          setLastRequest(null)
          setActiveTask(current => current ? { ...current, status: 'waiting', progress: 'Waiting for your confirmation.', cancellable: false } : current)
        }
      } else if (name === 'done') {
        flushDelta()
        finalEventSeen = true
        const fallbackFrom = payload.fallbackFrom && typeof payload.fallbackFrom === 'object' ? payload.fallbackFrom as Record<string, unknown> : null
        const content = typeof payload.content === 'string' ? payload.content : responseText
        setAssistant({
          content,
          status: 'completed',
          providerId: typeof payload.providerId === 'string' ? payload.providerId : null,
          modelId: typeof payload.modelId === 'string' ? payload.modelId : null,
          fallbackFrom: fallbackFrom ? { providerId: String(fallbackFrom.providerId ?? ''), providerName: String(fallbackFrom.providerName ?? fallbackFrom.providerId ?? 'AI'), modelId: String(fallbackFrom.modelId ?? '') } : null
        })
        setActiveTask(current => current ? { ...current, status: 'completed', progress: 'Completed.' } : current)
        setLastRequest(null)
        void loadConversations()
        void loadTasks()
      } else if (name === 'error') {
        flushDelta()
        finalEventSeen = true
        const text = typeof payload.message === 'string' ? payload.message : 'Stracker could not complete that AI request. Try again.'
        failWith(text)
      } else if (name === 'cancelled') {
        flushDelta()
        finalEventSeen = true
        setAssistant({ status: 'cancelled', content: STOPPED_MESSAGE })
        setActiveTask(current => current ? { ...current, status: 'cancelled', progress: 'Cancelled by you.' } : current)
      }
    }

    try {
      const token = await accessToken()
      const outcome = await streamChat({
        conversationId: conversationRef.current,
        requestId,
        messageId,
        message,
        pageContext: context
      }, token, controller.signal, handleEvent)
      if (!outcome.ok) {
        failWith(outcome.message)
        return
      }
      flushDelta()
      if (!controller.signal.aborted && !finalEventSeen) {
        failWith('The AI response ended before Stracker received a complete answer. Retry the saved message.')
        setActiveTask(current => current ? { ...current, progress: 'Response interrupted.' } : current)
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setAssistant({ status: 'cancelled', content: STOPPED_MESSAGE })
        setActiveTask(current => current ? { ...current, status: 'cancelled', progress: 'Cancelled by you.' } : current)
      } else {
        failWith(error instanceof Error ? error.message : 'The AI response was interrupted. Retry the saved message.')
      }
    } finally {
      if (flushTimer) clearTimeout(flushTimer)
      requestLockRef.current = false
      controllerRef.current = null
      if (finalEventSeen) void Promise.all([loadConversations(), loadTasks()])
    }
  }, [accessToken, loadConversations, loadTasks])

  const retryLast = useCallback(async () => {
    if (!lastRequest || requestLockRef.current) return
    await sendMessage(lastRequest.message, lastRequest.pageContext, lastRequest)
  }, [lastRequest, sendMessage])

  const stopTask = useCallback(() => {
    if (!controllerRef.current) return
    const requestId = inflightRequestIdRef.current
    controllerRef.current.abort()
    // Closing the connection alone does not cancel provider work, so the server is told explicitly.
    if (requestId) void apiFetch('/api/ai/tasks', { method: 'POST', body: { requestId } }).catch(() => undefined)
  }, [apiFetch])

  const confirmAction = useCallback(async (actionId: string, approved: boolean): Promise<boolean> => {
    if (actionLocksRef.current.has(actionId)) return false
    const message = messagesRef.current.find(item => item.confirmation?.actionId === actionId)
    if (!message?.confirmation) return false
    actionLocksRef.current.add(actionId)
    const taskId = message.confirmation.taskId
    setMessages(current => current.map(item => item.id === message.id ? { ...item, status: 'running', error: null } : item))
    setActiveTask({ id: taskId, conversationId: conversationRef.current, status: 'running', progress: approved ? 'Saving the confirmed change…' : 'Saving your cancellation…', providerId: message.providerId ?? null, modelId: message.modelId ?? null, cancellable: false, startedAt: new Date().toISOString() })
    try {
      const result = await apiFetch<{ message: string; result?: Record<string, unknown>; taskId: string; conversationId: string; approved: boolean }>('/api/ai/confirm', { method: 'POST', body: { actionId, approved } })
      const verified = Boolean(result.result)
      setMessages(current => current.map(item => item.id === message.id ? {
        ...item,
        content: item.content ? `${item.content}\n\n${result.message}` : result.message,
        status: verified ? 'completed' : 'cancelled',
        confirmation: undefined,
        result: result.result ?? null,
        error: null,
        retryable: false
      } : item))
      setActiveTask(current => current?.id === result.taskId ? { ...current, status: verified ? 'completed' : 'cancelled', progress: verified ? 'Saved to Stracker.' : 'Cancelled by you.' } : current)
      if (verified) await refresh()
      await Promise.all([loadConversations(), loadTasks()])
      return true
    } catch (error) {
      const text = error instanceof Error ? error.message : 'The Stracker action could not be confirmed.'
      const terminal = error instanceof AIRequestError && TERMINAL_ACTION_ERRORS.includes(error.code)
      setMessages(current => current.map(item => item.id === message.id ? {
        ...item,
        status: terminal ? 'failed' : 'waiting',
        content: item.content ? `${item.content}\n\n${text}` : text,
        error: text,
        confirmation: terminal ? undefined : item.confirmation,
        retryable: false
      } : item))
      setActiveTask(current => current?.id === taskId ? { ...current, status: terminal ? 'failed' : 'waiting', progress: terminal ? 'The save result could not be confirmed.' : 'Confirmation is still available; try again when ready.' } : current)
      await loadTasks()
      return false
    } finally {
      actionLocksRef.current.delete(actionId)
    }
  }, [apiFetch, refresh, loadConversations, loadTasks])

  const isBusy = activeTask !== null && BUSY_STATUSES.includes(activeTask.status)
  const value = useMemo<AIContextValue>(() => ({
    providers, providersLoading, providersError, backendStatus, backendHealth, checkBackendHealth, refreshProviders,
    discoverModels, saveProvider, testProvider, patchProvider, removeProvider,
    recentConversations, recentTasks, loadConversations, loadTasks, openConversation, clearConversation, newConversation,
    conversationId, conversationTitle, messages, activeTask, isBusy, lastRequest, sendMessage, retryLast, stopTask, confirmAction
  }), [providers, providersLoading, providersError, backendStatus, backendHealth, checkBackendHealth, refreshProviders, discoverModels, saveProvider, testProvider, patchProvider, removeProvider, recentConversations, recentTasks, loadConversations, loadTasks, openConversation, clearConversation, newConversation, conversationId, conversationTitle, messages, activeTask, isBusy, lastRequest, sendMessage, retryLast, stopTask, confirmAction])

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>
}

export function useAI(): AIContextValue {
  const context = useContext(AIContext)
  if (!context) throw new Error('useAI must be used inside AIProvider')
  return context
}
