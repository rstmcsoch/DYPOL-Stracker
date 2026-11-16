import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { AuthPreviewProvider, type AuthContextValue } from '../../contexts/AuthContext'
import { DataPreviewProvider, type DataContextValue } from '../../contexts/DataContext'
import { AIPreviewProvider, type AIContextValue } from '../../contexts/AIContext'
import { FocusProvider } from '../../contexts/FocusContext'
import { AppearanceProvider } from '../../contexts/AppearanceContext'
import { useProviderManager } from '../../components/ai/useProviderManager'
import type { AppData, RecordFor, TableName } from '../../types'
import { applyPreviewRemove, applyPreviewUpsert } from './preview-data'
import { PREVIEW_DISABLED } from './preview-data'
import { PREVIEW_EMAIL, PREVIEW_USER_ID, type PreviewFixture } from './fixtures'

/**
 * Preview-only providers for the Student Dashboard Editor canvas. They stand in for the real
 * Auth, Data and AI providers with explicit boundaries:
 *  - reads come from the synthetic fixture; writes change an in-memory copy only;
 *  - no Supabase, IndexedDB, sync queue, private image storage, AI request, import or export;
 *  - the shared FocusProvider runs in preview mode (simulated timer, nothing persisted).
 * The student app never renders these.
 */

const refuse = () => Promise.reject(new Error(PREVIEW_DISABLED))

function usePreviewData(fixture: PreviewFixture): DataContextValue {
  const [data, setData] = useState<AppData>(fixture.data)
  const dataRef = useRef(data)
  dataRef.current = data
  const [undo, setUndo] = useState<{ table: TableName; record: Record<string, unknown> } | null>(null)
  const commit = useCallback((next: AppData) => { dataRef.current = next; setData(next) }, [])
  const upsertMany = useCallback(async <T extends TableName>(table: T, records: RecordFor<T>[]) => {
    commit(applyPreviewUpsert(dataRef.current, table, records as unknown as Record<string, unknown>[]))
  }, [commit])
  return useMemo<DataContextValue>(() => ({
    data, loading: false, syncState: fixture.syncState, profileLoaded: true, pendingCount: fixture.pendingCount, syncError: null,
    refresh: async () => undefined,
    upsert: async (table, record) => upsertMany(table, [record]),
    upsertMany,
    updateSettings: async mutate => {
      const settings = mutate(dataRef.current.settings)
      commit({ ...dataRef.current, settings })
      return settings
    },
    mergeImportedData: refuse,
    remove: async (table, record, options) => {
      const raw = record as unknown as Record<string, unknown>
      commit(applyPreviewRemove(dataRef.current, table, String(raw.id)))
      setUndo(options?.undo === false ? null : { table, record: raw })
    },
    undoDelete: async () => { if (undo) { commit(applyPreviewUpsert(dataRef.current, undo.table, [undo.record])); setUndo(null) } },
    undoAvailable: Boolean(undo),
    dismissUndo: () => setUndo(null),
    saveImage: refuse
  }), [data, fixture.syncState, fixture.pendingCount, upsertMany, commit, undo])
}

const PREVIEW_AUTH: AuthContextValue = {
  user: { id: PREVIEW_USER_ID, email: PREVIEW_EMAIL, displayName: 'Aarav Sample', isLocal: true, providers: ['email'] },
  loading: false, error: null, clearError: () => undefined,
  signIn: refuse, signUp: refuse, resendConfirmation: refuse, signOut: refuse,
  suspension: null, clearSuspension: () => undefined, startLocalPreview: () => undefined, sendPasswordReset: refuse, updatePassword: refuse
}

function usePreviewAI(): AIContextValue {
  const manager = useProviderManager(refuse, 'user', false)
  const [panel, setPanel] = useState({ open: false, minimized: false, large: false })
  return useMemo<AIContextValue>(() => ({
    providers: [], providersLoading: false, providersError: null, backendStatus: 'unknown', backendHealth: null,
    checkBackendHealth: async () => undefined, refreshProviders: async () => undefined, discoverModels: refuse, saveProvider: refuse, testProvider: refuse,
    patchProvider: refuse, removeProvider: refuse, providerManager: manager, stracker: null, preference: 'stracker', preferStracker: refuse,
    recentConversations: [], recentTasks: [], loadConversations: async () => undefined, loadTasks: async () => undefined, openConversation: refuse,
    clearConversation: async () => undefined, newConversation: () => undefined, conversationId: null, conversationTitle: 'Sample conversation', messages: [],
    activeTask: null, isBusy: false, lastRequest: null, sendMessage: refuse, retryLast: refuse, stopTask: () => undefined, confirmAction: async () => false,
    panelOpen: panel.open, minimized: panel.minimized, largeOpen: panel.large,
    openPanel: () => setPanel({ open: true, minimized: false, large: false }), minimizePanel: () => setPanel(value => ({ ...value, minimized: true })),
    closePanel: () => setPanel({ open: false, minimized: false, large: false }), restorePanel: () => setPanel(value => ({ ...value, minimized: false })),
    expandPanel: () => setPanel(value => ({ ...value, large: true })), collapseLarge: () => setPanel(value => ({ ...value, large: false }))
  }), [manager, panel])
}

function PreviewInner({ fixture, children }: { fixture: PreviewFixture; children: ReactNode }) {
  const data = usePreviewData(fixture)
  const ai = usePreviewAI()
  return <DataPreviewProvider value={data}>
    <AIPreviewProvider value={ai}>
      <AppearanceProvider>
        <FocusProvider preview={{ initial: fixture.focus }}>{children}</FocusProvider>
      </AppearanceProvider>
    </AIPreviewProvider>
  </DataPreviewProvider>
}

/** Wraps the real AppFrame and pages with the synthetic student. Re-key it to reset the scenario. */
export function PreviewProviders({ fixture, children }: { fixture: PreviewFixture; children: ReactNode }) {
  return <AuthPreviewProvider value={PREVIEW_AUTH}><PreviewInner fixture={fixture}>{children}</PreviewInner></AuthPreviewProvider>
}
