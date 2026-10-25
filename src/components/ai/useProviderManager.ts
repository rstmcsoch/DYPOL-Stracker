import { useCallback, useMemo, useState } from 'react'
import type { AIModelOption, AIProviderConfig, AIProviderId } from '../../lib/ai/catalog'

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
  /** Custom providers only: signed proof from Discover that this model passed a real chat test. */
  approvalToken?:string
}

/** The only facts students get about Stracker AI (Default): brand, model name and availability. */
export interface StrackerAIStatus {
  name:string
  model:string|null
  status:'ready'|'unavailable'
  preferred:boolean
  dailyLimit:number
  usedToday:number
}
export type AIPreference = 'stracker'|'own'
/** Owner-only settings for Stracker AI (Default). */
export interface SiteAISettings { enabled:boolean; perUserPerMinute:number; perUserDaily:number }

export type DiscoverResult = {models:AIModelOption[];discoveryAvailable:boolean;message?:string;rankedModelIds?:string[];modelPreferences?:Record<string,string[]>;approvals?:Record<string,string>;probe?:{listed:number;tried:number;passed:number}}
export type ApiFetch = <T>(path:string,init?:RequestInit)=>Promise<T>

/** Add/edit/test/remove for one set of providers: a student's own, or the owner's Stracker AI (Default). */
export interface ProviderManager {
  scope:'user'|'site'
  providers:AIProviderConfig[]
  providersLoading:boolean
  providersError:string|null
  refreshProviders:()=>Promise<void>
  discoverModels:(draft:AIProviderDraft)=>Promise<DiscoverResult>
  saveProvider:(draft:AIProviderDraft)=>Promise<AIProviderConfig>
  testProvider:(id:string)=>Promise<{latencyMs?:number}>
  patchProvider:(id:string,action:'enable'|'disable'|'default')=>Promise<void>
  removeProvider:(id:string)=>Promise<void>
}

export interface ProviderManagerState extends ProviderManager {
  /** Student scope: Stracker AI (Default) status and the student's preferred choice. */
  stracker:StrackerAIStatus|null
  preference:AIPreference
  preferStracker:()=>Promise<void>
  /** Site scope: owner settings. */
  siteSettings:SiteAISettings|null
  saveSiteSettings:(settings:SiteAISettings)=>Promise<void>
  reset:()=>void
}

/**
 * Shared provider logic for Settings → AI Assistant and the Control Center. Only the endpoint
 * scope differs, so the owner gets exactly the same add, Discover, test and fallback options.
 */
export function useProviderManager(apiFetch:ApiFetch,scope:'user'|'site',canLoad:boolean):ProviderManagerState {
  const [providers,setProviders] = useState<AIProviderConfig[]>([])
  const [providersLoading,setProvidersLoading] = useState(false)
  const [providersError,setProvidersError] = useState<string|null>(null)
  const [stracker,setStracker] = useState<StrackerAIStatus|null>(null)
  const [preference,setPreference] = useState<AIPreference>('stracker')
  const [siteSettings,setSiteSettings] = useState<SiteAISettings|null>(null)
  const suffix = scope === 'site' ? '?scope=site' : ''
  const providersPath = `/api/ai/providers${suffix}`

  const reset = useCallback(() => { setProviders([]); setProvidersError(null); setStracker(null); setPreference('stracker'); setSiteSettings(null) },[])

  const refreshProviders = useCallback(async () => {
    if (!canLoad) { reset(); return }
    setProvidersLoading(true)
    try {
      const result = await apiFetch<{providers:AIProviderConfig[];stracker?:StrackerAIStatus;preference?:AIPreference;settings?:SiteAISettings}>(providersPath,{method:'GET'})
      setProviders(result.providers ?? [])
      setStracker(result.stracker ?? null)
      if (result.preference === 'own' || result.preference === 'stracker') setPreference(result.preference)
      if (result.settings) setSiteSettings(result.settings)
      setProvidersError(null)
    } catch (error) {
      setProvidersError(error instanceof Error ? error.message : 'Provider settings could not be loaded.')
    } finally { setProvidersLoading(false) }
  },[canLoad,apiFetch,providersPath,reset])

  const discoverModels = useCallback(async (draft:AIProviderDraft) => {
    const { id,...setup } = draft
    const useSavedConfiguration = Boolean(id && !draft.apiKey)
    const { approvalToken:_unused,...discovery } = setup
    void _unused
    return apiFetch<DiscoverResult>(`/api/ai/models${suffix}`,{method:'POST',body:JSON.stringify(useSavedConfiguration ? { configId:id } : discovery)})
  },[apiFetch,suffix])

  // Every write returns the saved row, so the list is updated in place instead of re-downloading
  // all providers after each action (each GET is another authenticated serverless round trip).
  const putProvider = useCallback((provider:AIProviderConfig) => {
    setProviders(current => {
      const others = current.filter(item => item.id !== provider.id)
      const next = provider.is_default ? others.map(item => item.is_default ? { ...item,is_default:false } : item) : others
      const index = current.findIndex(item => item.id === provider.id)
      if (index < 0) return [...next,provider]
      const merged = [...next]; merged.splice(Math.min(index,merged.length),0,provider); return merged
    })
  },[])

  const saveProvider = useCallback(async (draft:AIProviderDraft) => {
    const result = await apiFetch<{provider?:AIProviderConfig}>(providersPath,{method:'POST',body:JSON.stringify(draft)})
    if (!result.provider) throw new Error('The provider was not saved. Try again.')
    putProvider(result.provider)
    return result.provider
  },[apiFetch,putProvider,providersPath])

  const testProvider = useCallback(async (id:string) => {
    try { return await apiFetch<{latencyMs?:number}>(`/api/ai/test-connection${suffix}`,{method:'POST',body:JSON.stringify({configId:id})}) ?? {} }
    // The test writes connection status server-side; reload it in the background, not before returning.
    finally { void refreshProviders() }
  },[apiFetch,refreshProviders,suffix])

  const patchProvider = useCallback(async (id:string,action:'enable'|'disable'|'default') => {
    const result = await apiFetch<{provider?:AIProviderConfig;preference?:AIPreference}>(providersPath,{method:'PATCH',body:JSON.stringify({id,action})})
    if (result?.provider) putProvider(result.provider)
    else void refreshProviders()
    if (result?.preference) {
      setPreference(result.preference)
      setStracker(current => current ? { ...current,preferred:result.preference === 'stracker' } : current)
    }
    // Disabling the provider a student preferred hands the conversation back to Stracker AI.
    if (scope === 'user' && action === 'disable') void refreshProviders()
  },[apiFetch,putProvider,refreshProviders,providersPath,scope])

  const preferStracker = useCallback(async () => {
    await apiFetch<{preference:AIPreference}>(providersPath,{method:'PATCH',body:JSON.stringify({action:'prefer_stracker'})})
    setPreference('stracker')
    setStracker(current => current ? { ...current,preferred:true } : current)
  },[apiFetch,providersPath])

  /** Optimistic: the row disappears at once and is restored if the server refuses. */
  const removeProvider = useCallback(async (id:string) => {
    let snapshot:AIProviderConfig[] = []
    setProviders(current => { snapshot = current; return current.filter(item => item.id !== id) })
    try { await apiFetch(providersPath,{method:'DELETE',body:JSON.stringify({id})}) }
    catch (error) { setProviders(snapshot); throw error }
    if (scope === 'user') void refreshProviders()
  },[apiFetch,providersPath,scope,refreshProviders])

  const saveSiteSettings = useCallback(async (settings:SiteAISettings) => {
    const result = await apiFetch<{settings:SiteAISettings}>(providersPath,{method:'PUT',body:JSON.stringify({settings})})
    setSiteSettings(result.settings)
  },[apiFetch,providersPath])

  return useMemo(() => ({
    scope,providers,providersLoading,providersError,refreshProviders,discoverModels,saveProvider,testProvider,patchProvider,removeProvider,
    stracker,preference,preferStracker,siteSettings,saveSiteSettings,reset
  }),[scope,providers,providersLoading,providersError,refreshProviders,discoverModels,saveProvider,testProvider,patchProvider,removeProvider,stracker,preference,preferStracker,siteSettings,saveSiteSettings,reset])
}
