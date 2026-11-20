/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchIsTeamMember, fetchSiteStatus, NORMAL_SITE_STATUS, type SiteStatus } from '../../lib/site-status'
import { useAuth } from '../../contexts/AuthContext'

interface SiteStatusValue { status: SiteStatus; ready: boolean; teamMember: boolean; refresh: () => void }
const SiteStatusContext = createContext<SiteStatusValue>({ status: NORMAL_SITE_STATUS, ready: true, teamMember: false, refresh: () => undefined })

const POLL_MS = 60_000
const CACHE_KEY = 'stracker-site-status-v1'

function readCachedStatus(): SiteStatus {
  if (typeof window === 'undefined') return NORMAL_SITE_STATUS
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return NORMAL_SITE_STATUS
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return NORMAL_SITE_STATUS
    return {
      maintenanceEnabled: parsed.maintenanceEnabled === true,
      maintenanceMessage: typeof parsed.maintenanceMessage === 'string' ? parsed.maintenanceMessage : '',
      siteDown: parsed.siteDown === true,
      signupEnabled: parsed.signupEnabled !== false,
      signinEnabled: parsed.signinEnabled !== false
    }
  } catch {
    return NORMAL_SITE_STATUS
  }
}

function writeCachedStatus(status: SiteStatus): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(status))
  } catch {
    // Display-only cache; ignore storage failures.
  }
}

export function SiteStatusProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  // Paint immediately from the last known status (or normal defaults on a first visit) and
  // revalidate in the background so first paint never stalls behind a "Just a moment…" screen.
  const [status, setStatus] = useState<SiteStatus>(readCachedStatus)
  const [teamMember, setTeamMember] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let active = true
    void fetchSiteStatus().then(next => {
      if (!active) return
      setStatus(next)
      writeCachedStatus(next)
    })
    return () => { active = false }
  }, [tick])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTick(value => value + 1)
    }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') setTick(value => value + 1) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  const userId = user && !user.isLocal ? user.id : null
  const needsMembership = status.siteDown && Boolean(userId)
  useEffect(() => {
    let active = true
    if (!needsMembership) { setTeamMember(false); return }
    void fetchIsTeamMember().then(value => { if (active) setTeamMember(value) })
    return () => { active = false }
  }, [needsMembership, userId])

  const refresh = useCallback(() => setTick(value => value + 1), [])
  const value = useMemo<SiteStatusValue>(
    () => ({ status, ready: true, teamMember, refresh }),
    [status, teamMember, refresh]
  )

  return <SiteStatusContext.Provider value={value}>{children}</SiteStatusContext.Provider>
}

export function useSiteStatus(): SiteStatusValue {
  return useContext(SiteStatusContext)
}
