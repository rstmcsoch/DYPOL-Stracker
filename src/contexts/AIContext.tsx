/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AIModelOption, AIProviderConfig, AIProviderId } from '../lib/ai/catalog'
import { redactPotentialSecrets } from '../lib/ai/sanitize'
import { createId } from '../lib/id'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { useData } from './DataContext'

export interface AIConversationSummary { id:string; title:string; created_at:string; updated_at:string }
export interface AIRecentTask { id:string; conversation_id:string; provider_id:string|null; model_id:string|null; task_type:string; status:AITaskState['status']; progress:string; started_at:string; completed_at:string|null }
export interface AIActionConfirmation {
  actionId:string
  taskId:string
  toolName:string
  title:string
  fields:Array<{ label:string; value:string }>
  expiresAt:string
}
export interface AIMessage {
  id:string
  role:'user'|'assistant'
  content:string
  providerId?:string|null
  modelId?:string|null
  status?:'running'|'completed'|'failed'|'cancelled'|'waiting'
  fallbackFrom?:{ providerId:string; providerName:string; modelId:string }|null
  confirmation?:AIActionConfirmation
  result?:Record<string,unknown>|null
  error?:string|null
  retryable?:boolean
  createdAt:string
}
export interface AITaskState {
  id:string
  conversationId:string|null
  status:'queued'|'running'|'tool_call'|'waiting'|'completed'|'failed'|'cancelled'|'fallback'|'retrying'
  progress:string
  providerId?:string|null
  modelId?:string|null
  fallbackFrom?:{ providerId:string; providerName:string; modelId:string }|null
  cancellable?:boolean
  startedAt:string
}
export interface AIProviderDraft {
  id?:string
  providerId:AIProviderId
  displayName?:string
  modelId:string
  apiKey?:string
  baseUrl?:string|null
  protocol?:'google'|'openai-compatible'|'anthropic-compatible'
  organizationId?:string|null
  region?:'international'|'china'
  capabilities?:Record<string,boolean>
}
interface LastRequest { message:string; messageId:string; assistantId:string; pageContext:string|null }
interface AIContextValue {
  providers:AIProviderConfig[]
  providersLoading:boolean
  providersError:string|null
  refreshProviders:()=>Promise<void>
  discoverModels:(draft:AIProviderDraft)=>Promise<{models:AIModelOption[];discoveryAvailable:boolean;message?:string}>
  saveProvider:(draft:AIProviderDraft)=>Promise<AIProviderConfig>
  testProvider:(id:string)=>Promise<void>
  patchProvider:(id:string,action:'enable'|'disable'|'default')=>Promise<void>
  removeProvider:(id:string)=>Promise<void>
  recentConversations:AIConversationSummary[]
  recentTasks:AIRecentTask[]
  loadConversations:()=>Promise<void>
  loadTasks:()=>Promise<void>
  openConversation:(id:string)=>Promise<void>
  clearConversation:()=>Promise<void>
  newConversation:()=>void
  conversationId:string|null
  conversationTitle:string
  messages:AIMessage[]
  activeTask:AITaskState|null
  isBusy:boolean
  lastRequest:LastRequest|null
  sendMessage:(message:string,pageContext?:string|null)=>Promise<void>
  retryLast:()=>Promise<void>
  stopTask:()=>void
  confirmAction:(actionId:string,approved:boolean)=>Promise<boolean>
  panelOpen:boolean
  minimized:boolean
  largeOpen:boolean
  openPanel:()=>void
  minimizePanel:()=>void
  closePanel:()=>void
  restorePanel:()=>void
  expandPanel:()=>void
  collapseLarge:()=>void
}

const AIContext = createContext<AIContextValue|null>(null)

interface APIErrorPayload { error?:string; message?:string }
class AIRequestError extends Error {
  constructor(message:string,readonly code:string,readonly status:number) { super(message); this.name='AIRequestError' }
}
async function readError(response:Response):Promise<APIErrorPayload> {
  try { return await response.json() as APIErrorPayload } catch { return {} }
}

function mapStoredMessage(value:Record<string,unknown>):AIMessage {
  const metadata = value.metadata && typeof value.metadata === 'object' ? value.metadata as Record<string,unknown> : {}
  const fallback = metadata.fallback_from && typeof metadata.fallback_from === 'object' ? metadata.fallback_from as Record<string,unknown> : null
  const actionResult = metadata.action_result && typeof metadata.action_result === 'object' ? metadata.action_result as Record<string,unknown> : null
  return {
    id:String(value.id),role:value.role === 'user' ? 'user' : 'assistant',content:String(value.content ?? ''),
    providerId:typeof value.provider_id === 'string' ? value.provider_id : null,
    modelId:typeof value.model_id === 'string' ? value.model_id : null,
    status:(value.status as AIMessage['status']) ?? 'completed',
    fallbackFrom:fallback ? { providerId:String(fallback.provider_id ?? ''),providerName:String(fallback.provider_name ?? fallback.provider_id ?? 'AI'),modelId:String(fallback.model_id ?? '') } : null,
    result:actionResult,retryable:metadata.action_failed === true ? false : undefined,createdAt:String(value.created_at ?? new Date().toISOString())
  }
}

export function AIProvider({ children }: { children:ReactNode }) {
  const { user } = useAuth()
  const { refresh } = useData()
  const [providers,setProviders] = useState<AIProviderConfig[]>([])
  const [providersLoading,setProvidersLoading] = useState(false)
  const [providersError,setProvidersError] = useState<string|null>(null)
  const [recentConversations,setRecentConversations] = useState<AIConversationSummary[]>([])
  const [recentTasks,setRecentTasks] = useState<AIRecentTask[]>([])
  const [conversationId,setConversationId] = useState<string|null>(null)
  const [conversationTitle,setConversationTitle] = useState('New conversation')
  const [messages,setMessages] = useState<AIMessage[]>([])
  const [activeTask,setActiveTask] = useState<AITaskState|null>(null)
  const [panelOpen,setPanelOpen] = useState(false)
  const [minimized,setMinimized] = useState(false)
  const [largeOpen,setLargeOpen] = useState(false)
  const [lastRequest,setLastRequest] = useState<LastRequest|null>(null)
  const controllerRef = useRef<AbortController|null>(null)
  const conversationRef = useRef<string|null>(null)
  const requestLockRef = useRef(false)
  const actionConfirmLocksRef = useRef(new Set<string>())
  conversationRef.current = conversationId

  const accessToken = useCallback(async () => {
    if (!user || user.isLocal || !supabase) throw new Error('Sign in to a cloud Stracker account to use AI Assistant.')
    const { data,error } = await supabase.auth.getSession()
    if (error || !data.session?.access_token) throw new Error('Your Stracker session expired. Sign in again to use AI Assistant.')
    return data.session.access_token
  },[user])

  const apiFetch = useCallback(async <T,>(path:string,init:RequestInit={}):Promise<T> => {
    const token = await accessToken()
    let response:Response
    try {
      response = await fetch(path,{ ...init,headers:{ 'Content-Type':'application/json',Authorization:`Bearer ${token}`,...init.headers } })
    } catch {
      if (!navigator.onLine) throw new Error('AI is unavailable while offline. Your Stracker notebook is still available.')
      throw new Error('The Stracker AI service could not be reached. Check your connection and try again.')
    }
    const payload = await response.json().catch(() => ({})) as T & APIErrorPayload
    if (!response.ok) throw new AIRequestError(typeof payload.message === 'string' ? payload.message : 'Stracker could not complete that AI request. Try again.',typeof payload.error === 'string' ? payload.error : 'request_failed',response.status)
    return payload as T
  },[accessToken])

  const refreshProviders = useCallback(async () => {
    if (!user || user.isLocal) { setProviders([]); setProvidersError(null); return }
    setProvidersLoading(true)
    try {
      const result = await apiFetch<{providers:AIProviderConfig[]}>('/api/ai/providers',{method:'GET'})
      setProviders(result.providers ?? [])
      setProvidersError(null)
    } catch (error) {
      setProvidersError(error instanceof Error ? error.message : 'Provider settings could not be loaded.')
    } finally { setProvidersLoading(false) }
  },[user,apiFetch])

  const loadConversations = useCallback(async () => {
    if (!user || user.isLocal) { setRecentConversations([]); return }
    try {
      const result = await apiFetch<{conversations:AIConversationSummary[]}>('/api/ai/conversations',{method:'GET'})
      setRecentConversations(result.conversations ?? [])
    } catch { /* Conversation history is optional when the backend is unavailable. */ }
  },[user,apiFetch])

  const loadTasks = useCallback(async () => {
    if (!user || user.isLocal) { setRecentTasks([]); return }
    try {
      const result = await apiFetch<{tasks:AIRecentTask[]}>('/api/ai/tasks',{method:'GET'})
      setRecentTasks(result.tasks ?? [])
    } catch { /* Task history is optional when the backend is unavailable. */ }
  },[user,apiFetch])

  useEffect(() => {
    if (!user) {
      setProviders([]); setRecentConversations([]); setRecentTasks([]); setConversationId(null); setMessages([]); setActiveTask(null)
      return
    }
    if (user.isLocal) {
      setProviders([]); setProvidersError(null); setRecentConversations([]); setRecentTasks([]); setConversationId(null); setMessages([])
      return
    }
    void Promise.all([refreshProviders(),loadConversations(),loadTasks()])
  },[user?.id,user?.isLocal,refreshProviders,loadConversations,loadTasks,user])

  const discoverModels = useCallback(async (draft:AIProviderDraft) => {
    const { id,...setup } = draft
    const useSavedConfiguration = Boolean(id && !draft.apiKey)
    return apiFetch<{models:AIModelOption[];discoveryAvailable:boolean;message?:string}>('/api/ai/models',{method:'POST',body:JSON.stringify(useSavedConfiguration ? { configId:id } : setup)})
  },[apiFetch])

  const saveProvider = useCallback(async (draft:AIProviderDraft) => {
    const result = await apiFetch<{provider:AIProviderConfig}>('/api/ai/providers',{method:'POST',body:JSON.stringify(draft)})
    await refreshProviders()
    return result.provider
  },[apiFetch,refreshProviders])

  const testProvider = useCallback(async (id:string) => {
    try { await apiFetch('/api/ai/test-connection',{method:'POST',body:JSON.stringify({configId:id})}) }
    finally { await refreshProviders() }
  },[apiFetch,refreshProviders])

  const patchProvider = useCallback(async (id:string,action:'enable'|'disable'|'default') => {
    await apiFetch('/api/ai/providers',{method:'PATCH',body:JSON.stringify({id,action})})
    await refreshProviders()
  },[apiFetch,refreshProviders])

  const removeProvider = useCallback(async (id:string) => {
    await apiFetch('/api/ai/providers',{method:'DELETE',body:JSON.stringify({id})})
    await refreshProviders()
  },[apiFetch,refreshProviders])

  const openConversation = useCallback(async (id:string) => {
    if (requestLockRef.current) return
    const result = await apiFetch<{conversation:Record<string,unknown>;messages:Record<string,unknown>[];pendingActions?:Record<string,unknown>[] }>(`/api/ai/conversations?id=${encodeURIComponent(id)}`,{method:'GET'})
    conversationRef.current = String(result.conversation.id)
    setConversationId(String(result.conversation.id))
    setConversationTitle(String(result.conversation.title ?? 'Conversation'))
    const storedMessages = (result.messages ?? []).map(mapStoredMessage)
    const pendingMessages:AIMessage[] = (result.pendingActions ?? []).map(action => {
      const summary = action.summary && typeof action.summary === 'object' ? action.summary as Record<string,unknown> : {}
      return {
        id:`pending-${String(action.id)}`,role:'assistant',content:'I prepared this Stracker change. Review the details and confirm or cancel below.',status:'waiting',
        providerId:typeof action.provider_id === 'string' ? action.provider_id : null,modelId:typeof action.model_id === 'string' ? action.model_id : null,
        confirmation:{actionId:String(action.id),taskId:String(action.task_id),toolName:String(action.tool_name),title:String(summary.title ?? 'Confirm this Stracker change?'),fields:Array.isArray(summary.fields) ? summary.fields as AIActionConfirmation['fields'] : [],expiresAt:String(action.expires_at ?? '')},
        createdAt:String(action.created_at ?? new Date().toISOString())
      }
    })
    setMessages([...storedMessages,...pendingMessages].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)))
    setActiveTask(null)
    setLastRequest(null)
    setPanelOpen(true); setMinimized(false)
  },[apiFetch])

  const newConversation = useCallback(() => {
    if (requestLockRef.current) return
    conversationRef.current = null
    setConversationId(null); setConversationTitle('New conversation'); setMessages([]); setActiveTask(null); setLastRequest(null)
    setPanelOpen(true); setMinimized(false)
  },[])

  const clearConversation = useCallback(async () => {
    if (requestLockRef.current) throw new Error('Wait for the current AI task to finish before clearing this conversation.')
    const current = conversationRef.current
    if (current) await apiFetch('/api/ai/conversations',{method:'DELETE',body:JSON.stringify({id:current})})
    conversationRef.current = null
    setConversationId(null); setConversationTitle('New conversation'); setMessages([]); setActiveTask(null); setLastRequest(null)
    await loadConversations()
  },[apiFetch,loadConversations])

  const sendMessage = useCallback(async (rawMessage:string,pageContext:string|null=null,retry?:LastRequest) => {
    if (requestLockRef.current) return
    const message = redactPotentialSecrets(rawMessage.trim()).slice(0,4000)
    if (!message) return
    const requestId = createId()
    const messageId = retry?.messageId ?? createId()
    const assistantId = retry?.assistantId ?? `assistant-${messageId}`
    const context = retry?.pageContext ?? pageContext
    const stateToSend:LastRequest = { message,messageId,assistantId,pageContext:context }
    const now = new Date().toISOString()
    if (!retry) {
      setMessages(current => [...current,{ id:messageId,role:'user',content:message,status:'completed',createdAt:now },{ id:assistantId,role:'assistant',content:'',status:'running',createdAt:now }])
      setLastRequest(stateToSend)
    } else {
      setMessages(current => current.map(item => item.id === assistantId ? { ...item,content:'',status:'running',error:null,confirmation:undefined,result:null } : item))
      setLastRequest(stateToSend)
    }
    setPanelOpen(true); setMinimized(false)
    requestLockRef.current = true
    const controller = new AbortController()
    controllerRef.current = controller
    setActiveTask({id:requestId,conversationId:conversationRef.current,status:'queued',progress:'Connecting to your AI provider…',cancellable:true,startedAt:now})
    let response:Response
    try {
      const token = await accessToken()
      response = await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({
        conversationId:conversationRef.current,requestId,messageId,message,pageContext:context
      }),signal:controller.signal})
    } catch (error) {
      if (controller.signal.aborted) {
        setMessages(current => current.map(item => item.id === assistantId ? { ...item,status:'cancelled',content:'Request stopped. No Stracker change was made.' } : item))
        setActiveTask(current => current ? { ...current,status:'cancelled',progress:'Cancelled by you.' } : current)
      } else {
        const messageText = !navigator.onLine ? 'AI is unavailable while offline. Your Stracker notebook is still available.' : error instanceof Error ? error.message : 'The AI request could not be started.'
        setMessages(current => current.map(item => item.id === assistantId ? { ...item,status:'failed',content:messageText,error:messageText } : item))
        setActiveTask(current => current ? { ...current,status:'failed',progress:'Request failed.' } : current)
      }
      requestLockRef.current = false; controllerRef.current = null
      return
    }

    if (!response.ok) {
      const error = await readError(response)
      const messageText = error.message ?? 'Stracker could not complete that AI request. Try again.'
      setMessages(current => current.map(item => item.id === assistantId ? { ...item,status:'failed',content:messageText,error:messageText } : item))
      setActiveTask(current => current ? { ...current,status:'failed',progress:'Request failed.' } : current)
      requestLockRef.current = false; controllerRef.current = null
      return
    }
    if (!response.body) {
      const messageText = 'The AI response stream was unavailable. Retry your message.'
      setMessages(current => current.map(item => item.id === assistantId ? { ...item,status:'failed',content:messageText,error:messageText } : item))
      setActiveTask(current => current ? { ...current,status:'failed',progress:'Request failed.' } : current)
      requestLockRef.current = false; controllerRef.current = null
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let responseText = ''
    let pendingDelta = ''
    let flushTimer:ReturnType<typeof setTimeout>|null = null
    let finalEventSeen = false
    const flushDelta = () => {
      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = null
      if (!pendingDelta) return
      const delta = pendingDelta; pendingDelta = ''
      setMessages(current => current.map(item => item.id === assistantId ? { ...item,content:item.content + delta,status:'running' } : item))
    }
    const appendDelta = (delta:string) => {
      responseText += delta
      pendingDelta += delta
      if (!flushTimer) flushTimer = setTimeout(flushDelta,45)
    }
    const setAssistant = (patch:Partial<AIMessage>) => setMessages(current => current.map(item => item.id === assistantId ? { ...item,...patch } : item))
    const handleEvent = (name:string,payload:Record<string,unknown>) => {
      if (name === 'task') {
        if (typeof payload.conversationId === 'string') {
          conversationRef.current = payload.conversationId
          setConversationId(payload.conversationId)
        }
        if (typeof payload.id === 'string') {
          setActiveTask(current => current ? { ...current,id:payload.id as string,conversationId:typeof payload.conversationId === 'string' ? payload.conversationId : current.conversationId,status:(payload.status as AITaskState['status']) ?? 'running',progress:'Thinking…' } : current)
          void loadTasks()
        }
      } else if (name === 'status') {
        setActiveTask(current => current ? { ...current,status:(payload.status as AITaskState['status']) ?? current.status,progress:typeof payload.progress === 'string' ? payload.progress : current.progress,providerId:typeof payload.providerId === 'string' ? payload.providerId : current.providerId,modelId:typeof payload.modelId === 'string' ? payload.modelId : current.modelId } : current)
      } else if (name === 'delta') {
        if (typeof payload.text === 'string') appendDelta(payload.text)
      } else if (name === 'reset') {
        pendingDelta = ''; responseText = ''
        if (flushTimer) clearTimeout(flushTimer)
        flushTimer = null
        setAssistant({content:'',status:'running'})
      } else if (name === 'fallback') {
        const fallback = { providerId:String(payload.to ?? ''),providerName:String(payload.to ?? 'AI'),modelId:'' }
        setActiveTask(current => current ? { ...current,status:'fallback',progress:typeof payload.reason === 'string' ? `Switching to ${String(payload.to)}…` : 'Switching to a configured fallback…',fallbackFrom:{providerId:String(payload.from ?? ''),providerName:String(payload.from ?? 'AI'),modelId:''} } : current)
        void fallback
      } else if (name === 'confirmation') {
        const action = payload.action as Record<string,unknown> | undefined
        if (action && typeof action.actionId === 'string') {
          const confirmation:AIActionConfirmation = {
            actionId:action.actionId,taskId:String(action.taskId ?? ''),toolName:String(action.toolName ?? ''),title:String(action.title ?? 'Confirm this Stracker change?'),
            fields:Array.isArray(action.fields) ? action.fields as AIActionConfirmation['fields'] : [],expiresAt:String(action.expiresAt ?? '')
          }
          flushDelta()
          setAssistant({status:'waiting',confirmation,providerId:typeof payload.providerId === 'string' ? payload.providerId : null,modelId:typeof payload.modelId === 'string' ? payload.modelId : null})
          setLastRequest(null)
          setActiveTask(current => current ? { ...current,status:'waiting',progress:'Waiting for your confirmation.',cancellable:false,providerId:typeof payload.providerId === 'string' ? payload.providerId : current.providerId,modelId:typeof payload.modelId === 'string' ? payload.modelId : current.modelId } : current)
        }
      } else if (name === 'done') {
        flushDelta(); finalEventSeen = true
        const fallbackFrom = payload.fallbackFrom && typeof payload.fallbackFrom === 'object' ? payload.fallbackFrom as Record<string,unknown> : null
        const content = typeof payload.content === 'string' ? payload.content : responseText
        setAssistant({content,status:'completed',providerId:typeof payload.providerId === 'string' ? payload.providerId : null,modelId:typeof payload.modelId === 'string' ? payload.modelId : null,fallbackFrom:fallbackFrom ? { providerId:String(fallbackFrom.providerId ?? ''),providerName:String(fallbackFrom.providerName ?? fallbackFrom.providerId ?? 'AI'),modelId:String(fallbackFrom.modelId ?? '') } : null})
        setActiveTask(current => current ? { ...current,status:'completed',progress:'Completed.',providerId:typeof payload.providerId === 'string' ? payload.providerId : current.providerId,modelId:typeof payload.modelId === 'string' ? payload.modelId : current.modelId,fallbackFrom:fallbackFrom ? { providerId:String(fallbackFrom.providerId ?? ''),providerName:String(fallbackFrom.providerName ?? 'AI'),modelId:String(fallbackFrom.modelId ?? '') } : null } : current)
        setLastRequest(null)
        void loadConversations(); void loadTasks()
      } else if (name === 'error') {
        flushDelta(); finalEventSeen = true
        const messageText = typeof payload.message === 'string' ? payload.message : 'Stracker could not complete that AI request. Try again.'
        setAssistant({status:'failed',content:messageText,error:messageText})
        setActiveTask(current => current ? { ...current,status:'failed',progress:'Request failed.' } : current)
      } else if (name === 'cancelled') {
        flushDelta(); finalEventSeen = true
        setAssistant({status:'cancelled',content:'Request stopped. No Stracker change was made.'})
        setActiveTask(current => current ? { ...current,status:'cancelled',progress:'Cancelled by you.' } : current)
      }
    }
    const parseBlock = (block:string) => {
      let name = 'message'
      const data:string[] = []
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) name = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /,''))
      }
      if (!data.length) return
      try { handleEvent(name,JSON.parse(data.join('\n')) as Record<string,unknown>) } catch { /* Ignore one malformed event; the stream remains bounded. */ }
    }
    try {
      while (true) {
        const {value,done} = await reader.read()
        if (done) break
        buffer += decoder.decode(value,{stream:true})
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() ?? ''
        for (const block of blocks) parseBlock(block)
      }
      buffer += decoder.decode()
      if (buffer.trim()) parseBlock(buffer)
      flushDelta()
      if (!controller.signal.aborted && !finalEventSeen) {
        const messageText = 'The AI response ended before Stracker received a complete answer. Retry the saved message.'
        setAssistant({status:'failed',content:messageText,error:messageText})
        setActiveTask(current => current ? { ...current,status:'failed',progress:'Response interrupted.' } : current)
      }
    } catch {
      if (controller.signal.aborted) {
        setAssistant({status:'cancelled',content:'Request stopped. No Stracker change was made.'})
        setActiveTask(current => current ? { ...current,status:'cancelled',progress:'Cancelled by you.' } : current)
      } else {
        const messageText = !navigator.onLine ? 'AI is unavailable while offline. Your Stracker notebook is still available.' : 'The AI response was interrupted. Retry the saved message.'
        setAssistant({status:'failed',content:messageText,error:messageText})
        setActiveTask(current => current ? { ...current,status:'failed',progress:'Response interrupted.' } : current)
      }
    } finally {
      if (flushTimer) clearTimeout(flushTimer)
      try { reader.releaseLock() } catch { /* closed stream */ }
      requestLockRef.current = false
      controllerRef.current = null
      if (finalEventSeen) void Promise.all([loadConversations(),loadTasks()])
    }
  },[accessToken,loadConversations,loadTasks])

  const retryLast = useCallback(async () => {
    if (!lastRequest || requestLockRef.current) return
    await sendMessage(lastRequest.message,lastRequest.pageContext,lastRequest)
  },[lastRequest,sendMessage])

  const stopTask = useCallback(() => {
    if (!controllerRef.current) return
    controllerRef.current.abort(new DOMException('Stopped by the user','AbortError'))
  },[])

  const confirmAction = useCallback(async (actionId:string,approved:boolean):Promise<boolean> => {
    if (actionConfirmLocksRef.current.has(actionId)) return false
    const message = messages.find(item => item.confirmation?.actionId === actionId)
    if (!message?.confirmation) return false
    actionConfirmLocksRef.current.add(actionId)
    const taskId = message.confirmation.taskId
    setMessages(current => current.map(item => item.id === message.id ? { ...item,status:'running',error:null } : item))
    setActiveTask({id:taskId,conversationId:conversationRef.current,status:'running',progress:approved ? 'Saving the confirmed change…' : 'Saving your cancellation…',providerId:message.providerId ?? null,modelId:message.modelId ?? null,cancellable:false,startedAt:new Date().toISOString()})
    try {
      const result = await apiFetch<{message:string;result?:Record<string,unknown>;taskId:string;conversationId:string;approved:boolean}>('/api/ai/confirm',{method:'POST',body:JSON.stringify({actionId,approved})})
      const mutationVerified = Boolean(result.result)
      const resultStatus:AIMessage['status'] = mutationVerified ? 'completed' : 'cancelled'
      setMessages(current => current.map(item => item.id === message.id ? { ...item,content:item.content ? `${item.content}\n\n${result.message}` : result.message,status:resultStatus,confirmation:undefined,result:result.result ?? null,error:null,retryable:false } : item))
      setActiveTask(current => current?.id === result.taskId ? { ...current,status:mutationVerified ? 'completed' : 'cancelled',progress:mutationVerified ? 'Saved to Stracker.' : 'Cancelled by you.' } : current)
      if (mutationVerified) await refresh()
      await Promise.all([loadConversations(),loadTasks()])
      return true
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'The Stracker action could not be confirmed.'
      const terminal = error instanceof AIRequestError && ['action_save_failed','action_expired','action_already_handled','action_not_found','invalid_confirmation'].includes(error.code)
      setMessages(current => current.map(item => item.id === message.id ? {
        ...item,status:terminal ? 'failed' : 'waiting',content:item.content ? `${item.content}\n\n${messageText}` : messageText,
        error:messageText,confirmation:terminal ? undefined : item.confirmation,retryable:false
      } : item))
      setActiveTask(current => current?.id === taskId ? { ...current,status:terminal ? 'failed' : 'waiting',progress:terminal ? 'The save result could not be confirmed.' : 'Confirmation is still available; try again when ready.' } : current)
      await loadTasks()
      return false
    } finally {
      actionConfirmLocksRef.current.delete(actionId)
    }
  },[messages,apiFetch,refresh,loadConversations,loadTasks])

  const openPanel = useCallback(() => { setPanelOpen(true); setMinimized(false); setLargeOpen(false) },[])
  const minimizePanel = useCallback(() => { setPanelOpen(false); setMinimized(true); setLargeOpen(false) },[])
  const closePanel = useCallback(() => { setPanelOpen(false); setMinimized(false); setLargeOpen(false) },[])
  const restorePanel = useCallback(() => { setPanelOpen(true); setMinimized(false) },[])
  const expandPanel = useCallback(() => { setPanelOpen(true); setMinimized(false); setLargeOpen(true) },[])
  const collapseLarge = useCallback(() => { setLargeOpen(false); setPanelOpen(true); setMinimized(false) },[])

  const isBusy = activeTask !== null && ['queued','running','tool_call','fallback','retrying'].includes(activeTask.status)
  const value = useMemo<AIContextValue>(() => ({
    providers,providersLoading,providersError,refreshProviders,discoverModels,saveProvider,testProvider,patchProvider,removeProvider,
    recentConversations,recentTasks,loadConversations,loadTasks,openConversation,clearConversation,newConversation,conversationId,conversationTitle,messages,activeTask,isBusy,lastRequest,
    sendMessage,retryLast,stopTask,confirmAction,panelOpen,minimized,largeOpen,openPanel,minimizePanel,closePanel,restorePanel,expandPanel,collapseLarge
  }),[providers,providersLoading,providersError,refreshProviders,discoverModels,saveProvider,testProvider,patchProvider,removeProvider,recentConversations,recentTasks,loadConversations,loadTasks,openConversation,clearConversation,newConversation,conversationId,conversationTitle,messages,activeTask,isBusy,lastRequest,sendMessage,retryLast,stopTask,confirmAction,panelOpen,minimized,largeOpen,openPanel,minimizePanel,closePanel,restorePanel,expandPanel,collapseLarge])
  return <AIContext.Provider value={value}>{children}</AIContext.Provider>
}

export function useAI():AIContextValue {
  const context = useContext(AIContext)
  if (!context) throw new Error('useAI must be used inside AIProvider')
  return context
}
