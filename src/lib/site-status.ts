import { supabase } from './supabase'

/** Public site switches set in the console (Settings → Site status / Access). */
export interface SiteStatus {
  maintenanceEnabled: boolean
  maintenanceMessage: string
  siteDown: boolean
  signupEnabled: boolean
  signinEnabled: boolean
}

/** Used when the settings cannot be read: the site stays fully usable (fail open). */
export const NORMAL_SITE_STATUS: SiteStatus = { maintenanceEnabled: false, maintenanceMessage: '', siteDown: false, signupEnabled: true, signinEnabled: true }

export const DEFAULT_MAINTENANCE_MESSAGE = 'Stracker is down for maintenance. Please check back soon.'

export function parseSiteStatus(row: Record<string, unknown> | null | undefined): SiteStatus {
  if (!row) return NORMAL_SITE_STATUS
  return {
    maintenanceEnabled: row.maintenance_enabled === true,
    maintenanceMessage: typeof row.maintenance_message === 'string' ? row.maintenance_message.slice(0, 500) : '',
    siteDown: row.site_down === true,
    signupEnabled: row.signup_enabled !== false,
    signinEnabled: row.signin_enabled !== false
  }
}

export async function fetchSiteStatus(): Promise<SiteStatus> {
  if (!supabase) return NORMAL_SITE_STATUS
  try {
    const { data, error } = await supabase.from('site_settings').select('maintenance_enabled, maintenance_message, site_down, signup_enabled, signin_enabled').eq('id', 1).maybeSingle()
    if (error) return NORMAL_SITE_STATUS
    return parseSiteStatus(data as Record<string, unknown> | null)
  } catch {
    return NORMAL_SITE_STATUS
  }
}

/** True when the signed-in account holds an active team role (asked of the database for itself only). */
export async function fetchIsTeamMember(): Promise<boolean> {
  if (!supabase) return false
  try {
    const { data, error } = await supabase.rpc('is_control_member')
    return !error && data === true
  } catch {
    return false
  }
}

/** What a page should render for the current switches. Pure, so it is unit-tested directly. */
export type SiteGateKind = 'public' | 'app' | 'auth'
export type SiteGateDecision = 'render' | 'render-with-notice' | 'maintenance-page'

export function siteGateDecision(status: SiteStatus, kind: SiteGateKind, signedIn: boolean, teamMember: boolean): SiteGateDecision {
  if (status.siteDown) {
    // Sign-in pages stay reachable so the team can still sign in; everyone else sees the
    // maintenance page, including signed-in students.
    if (kind === 'auth') return 'render-with-notice'
    if (signedIn && teamMember) return 'render-with-notice'
    return 'maintenance-page'
  }
  return status.maintenanceEnabled ? 'render-with-notice' : 'render'
}
