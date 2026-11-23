import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../http.js'
import { cleanText } from '../control-policy.js'

const OPERATIONAL_COLUMNS = 'maintenance_enabled, maintenance_message, site_down, updated_at'
const DEFAULT_DOWN_MESSAGE = 'Stracker is down for maintenance. Please check back soon.'
const FORBIDDEN_KEYS = [
  'signupEnabled', 'signinEnabled', 'signup_enabled', 'signin_enabled',
  'allowedDomains', 'blockedDomains', 'emailDomains', 'domain',
  'auth', 'authentication', 'security', 'roles', 'permissions'
] as const

const settingsPatch = z.object({
  maintenanceEnabled: z.boolean().optional(),
  maintenanceMessage: z.string().max(500).optional()
}).strict()

export type OperationalSettings = {
  maintenanceEnabled: boolean
  maintenanceMessage: string
  siteDown: boolean
  updatedAt: string | null
  status: 'live' | 'notice' | 'down'
}

function rejectForbiddenKeys(input: unknown): void {
  if (!input || typeof input !== 'object') return
  const keys = Object.keys(input as Record<string, unknown>)
  const blocked = keys.filter(key => (FORBIDDEN_KEYS as readonly string[]).includes(key) || /sign[-_]?up|sign[-_]?in|domain|password|passkey|mfa|turnstile|captcha|role|permission|security|auth/i.test(key) && !['maintenanceEnabled', 'maintenanceMessage', 'siteDown', 'confirmationToken', 'message'].includes(key))
  if (blocked.length) {
    throw new ApiError(403, 'forbidden_setting', 'Sign-up, sign-in, domain, authentication, role and security settings are owner-controlled and cannot be changed or inspected through Master MCP.')
  }
}

function view(row: Record<string, unknown>): OperationalSettings {
  const maintenanceEnabled = row.maintenance_enabled === true
  const siteDown = row.site_down === true
  const maintenanceMessage = typeof row.maintenance_message === 'string' ? row.maintenance_message : ''
  return {
    maintenanceEnabled,
    maintenanceMessage,
    siteDown,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    status: siteDown ? 'down' : maintenanceEnabled ? 'notice' : 'live'
  }
}

export async function readOperationalSettings(admin: SupabaseClient): Promise<OperationalSettings> {
  const { data, error } = await admin.from('site_settings').select(OPERATIONAL_COLUMNS).eq('id', 1).maybeSingle()
  if (error || !data) throw new ApiError(503, 'control_unavailable', 'Operational settings could not be loaded right now.')
  return view(data as Record<string, unknown>)
}

export async function getOperationalSettings(admin: SupabaseClient) {
  const site = await readOperationalSettings(admin)
  return {
    site,
    reachable: ['maintenanceEnabled', 'maintenanceMessage', 'siteDown'],
    unreachable: ['Sign-up enablement', 'Sign-in enablement', 'Email domain rules', 'Authentication settings', 'Security policies', 'Roles', 'Permissions'],
    note: 'Only maintenance presentation can be changed here. Sign-up and sign-in switches stay under Owner control.'
  }
}

export async function getOperationalStatus(admin: SupabaseClient) {
  const site = await readOperationalSettings(admin)
  return {
    status: site.status,
    siteDown: site.siteDown,
    maintenanceEnabled: site.maintenanceEnabled,
    maintenanceMessage: site.maintenanceMessage,
    updatedAt: site.updatedAt,
    impact: site.siteDown
      ? 'The public site and student workspace are hidden behind the maintenance message until the site is turned back up.'
      : site.maintenanceEnabled
        ? 'The site is live, and the maintenance notice is shown to visitors and students.'
        : 'The site is live with no maintenance notice.'
  }
}

async function saveOperational(admin: SupabaseClient, patch: { maintenance_enabled?: boolean; maintenance_message?: string; site_down?: boolean }) {
  const current = await readOperationalSettings(admin)
  const maintenanceEnabled = patch.maintenance_enabled ?? current.maintenanceEnabled
  const siteDown = patch.site_down ?? current.siteDown
  const requestedMessage = patch.maintenance_message !== undefined ? cleanText(patch.maintenance_message, 500) : current.maintenanceMessage
  const next = {
    maintenance_enabled: maintenanceEnabled,
    site_down: siteDown,
    maintenance_message: requestedMessage || (siteDown || maintenanceEnabled ? DEFAULT_DOWN_MESSAGE : ''),
    updated_by: null,
    updated_at: new Date().toISOString()
  }
  const { error } = await admin.from('site_settings').update(next).eq('id', 1)
  if (error) throw new ApiError(502, 'save_failed', 'The site status could not be saved. Nothing changed.')
  return readOperationalSettings(admin)
}

export async function updateOperationalSettings(admin: SupabaseClient, input: unknown) {
  rejectForbiddenKeys(input)
  const parsed = settingsPatch.safeParse(input ?? {})
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Only the maintenance notice and its message can be updated here. Use set_maintenance_mode to take the site down or bring it back up.')
  if (parsed.data.maintenanceEnabled === undefined && parsed.data.maintenanceMessage === undefined) {
    throw new ApiError(400, 'invalid_request', 'Nothing to change.')
  }
  const site = await saveOperational(admin, {
    maintenance_enabled: parsed.data.maintenanceEnabled,
    maintenance_message: parsed.data.maintenanceMessage
  })
  return { ok: true, site }
}

export async function updateMaintenanceMessage(admin: SupabaseClient, input: unknown) {
  rejectForbiddenKeys(input)
  const parsed = z.object({ message: z.string().max(500) }).strict().safeParse(input ?? {})
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Send a maintenance message of up to 500 characters.')
  const site = await saveOperational(admin, { maintenance_message: parsed.data.message })
  return { ok: true, site }
}

export function maintenanceImpact(current: OperationalSettings, siteDown: boolean, maintenanceEnabled?: boolean): string[] {
  const nextDown = siteDown
  const nextNotice = maintenanceEnabled ?? current.maintenanceEnabled
  const effects: string[] = []
  if (nextDown && !current.siteDown) {
    effects.push('The public website and student workspace will be hidden from every student until the site is turned back up.')
    effects.push('Control Centre members can still reach the console.')
    effects.push('This does not change sign-up or sign-in switches, domain rules, or authentication settings.')
  } else if (!nextDown && current.siteDown) {
    effects.push('The public website and student workspace will be available again.')
    effects.push('This does not change sign-up or sign-in switches.')
  } else {
    effects.push('Site-down state stays as it is now.')
  }
  if (nextNotice && !nextDown) effects.push('The maintenance notice will remain visible on the live site.')
  if (!nextNotice && !nextDown) effects.push('No maintenance notice will be shown.')
  return effects
}

export async function setMaintenanceMode(admin: SupabaseClient, input: { siteDown: boolean; maintenanceEnabled?: boolean; maintenanceMessage?: string }) {
  rejectForbiddenKeys(input)
  const site = await saveOperational(admin, {
    site_down: input.siteDown,
    maintenance_enabled: input.maintenanceEnabled,
    maintenance_message: input.maintenanceMessage
  })
  return { ok: true, site }
}
