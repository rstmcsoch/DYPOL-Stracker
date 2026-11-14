import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './http.js'

/**
 * Server-side half of "site down" (Control Center → Settings → Site status). The browser shows
 * the maintenance page; these functions also refuse work while the site is down, except for
 * active control role holders. A read failure fails OPEN (the site stays usable) so a settings
 * outage can never take Stracker down by itself.
 */
export async function assertSiteUp(admin: SupabaseClient, userId: string | null = null): Promise<void> {
  const { data, error } = await admin.from('site_settings').select('site_down').eq('id', 1).maybeSingle()
  if (error || !data || data.site_down !== true) return
  if (userId) {
    const { data: role } = await admin.from('control_roles').select('revoked_at').eq('user_id', userId).maybeSingle()
    if (role && !role.revoked_at) return
  }
  throw new ApiError(503, 'site_down', 'Stracker is down for maintenance. Please try again later.')
}
