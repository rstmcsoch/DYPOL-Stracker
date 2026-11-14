/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { fetchIsTeamMember, fetchSiteStatus, NORMAL_SITE_STATUS, type SiteStatus } from '../../lib/site-status'
import { useAuth } from '../../contexts/AuthContext'

interface SiteStatusValue { status: SiteStatus; ready: boolean; teamMember: boolean; refresh: () => void }
const SiteStatusContext = createContext<SiteStatusValue>({ status: NORMAL_SITE_STATUS, ready: true, teamMember: false, refresh: () => undefined })

const POLL_MS = 60_000
/** Never hold the page longer than this waiting for the switches (then fail open). */
const FIRST_LOAD_TIMEOUT_MS = 2_500

export function SiteStatusProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [status, setStatus] = useState<SiteStatus>(NORMAL_SITE_STATUS)
  const [ready, setReady] = useState(false)
  const [teamMember, setTeamMember] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let active = true
    const timeout = window.setTimeout(() => { if (active) setReady(true) }, FIRST_LOAD_TIMEOUT_MS)
    void fetchSiteStatus().then(next => { if (active) { setStatus(next); setReady(true) } })
    return () => { active = false; window.clearTimeout(timeout) }
  }, [tick])

  useEffect(() => {
    const timer = window.setInterval(() => setTick(value => value + 1), POLL_MS)
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

  return <SiteStatusContext.Provider value={{ status, ready, teamMember, refresh: () => setTick(value => value + 1) }}>{children}</SiteStatusContext.Provider>
}

export function useSiteStatus(): SiteStatusValue {
  return useContext(SiteStatusContext)
}
