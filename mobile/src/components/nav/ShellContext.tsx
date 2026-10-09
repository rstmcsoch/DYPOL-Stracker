import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

interface ShellApi {
  moreOpen: boolean
  searchOpen: boolean
  quickTaskOpen: boolean
  quickActionsOpen: boolean
  openMore: () => void
  closeMore: () => void
  openSearch: () => void
  closeSearch: () => void
  openQuickTask: () => void
  closeQuickTask: () => void
  setQuickActionsOpen: (open: boolean) => void
}

const ShellContext = createContext<ShellApi | null>(null)

/** Open/close state for the app-wide overlays: More, search, quick task, and quick actions. */
export function ShellProvider({ children }: { children: ReactNode }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [quickTaskOpen, setQuickTaskOpen] = useState(false)
  const [quickActionsOpen, setQuickActionsOpen] = useState(false)
  const openMore = useCallback(() => setMoreOpen(true), [])
  const closeMore = useCallback(() => setMoreOpen(false), [])
  const openSearch = useCallback(() => { setQuickActionsOpen(false); setSearchOpen(true) }, [])
  const closeSearch = useCallback(() => setSearchOpen(false), [])
  const openQuickTask = useCallback(() => { setQuickActionsOpen(false); setQuickTaskOpen(true) }, [])
  const closeQuickTask = useCallback(() => setQuickTaskOpen(false), [])
  const value = useMemo<ShellApi>(() => ({
    moreOpen, searchOpen, quickTaskOpen, quickActionsOpen, openMore, closeMore, openSearch, closeSearch, openQuickTask, closeQuickTask, setQuickActionsOpen
  }), [moreOpen, searchOpen, quickTaskOpen, quickActionsOpen, openMore, closeMore, openSearch, closeSearch, openQuickTask, closeQuickTask])
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

export function useShell(): ShellApi {
  const context = useContext(ShellContext)
  if (!context) throw new Error('useShell must be used inside ShellProvider')
  return context
}
