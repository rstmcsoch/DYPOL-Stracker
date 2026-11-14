/** Ban length presets and custom end-time handling for the console's ban dialog. Pure. */
export const BAN_PRESETS = [
  { id: '1h', label: '1 hour', seconds: 60 * 60 },
  { id: '24h', label: '24 hours', seconds: 24 * 60 * 60 },
  { id: '3d', label: '3 days', seconds: 3 * 24 * 60 * 60 },
  { id: '7d', label: '7 days', seconds: 7 * 24 * 60 * 60 },
  { id: '30d', label: '30 days', seconds: 30 * 24 * 60 * 60 },
  { id: 'permanent', label: 'Permanent', seconds: null },
  { id: 'duration', label: 'Custom length', seconds: null },
  { id: 'until', label: 'Until a date', seconds: null }
] as const
export type BanPreset = (typeof BAN_PRESETS)[number]['id']

export type DurationUnit = 'minutes' | 'hours' | 'days'
const UNIT_SECONDS: Record<DurationUnit, number> = { minutes: 60, hours: 3600, days: 86400 }

export interface BanChoice { preset: BanPreset; amount: string; unit: DurationUnit; untilLocal: string }

/**
 * Converts the dialog's choice into what the server needs. `zone` is the console's display zone:
 * 'UTC' reads the date-time field as UTC, anything else as the browser's local time.
 * Returns an error string when the choice is not usable.
 */
export function resolveBan(choice: BanChoice, zone: string, nowMs = Date.now()): { permanent: true } | { permanent: false; until: string } | { error: string } {
  if (choice.preset === 'permanent') return { permanent: true }
  let end: number
  if (choice.preset === 'duration') {
    const amount = Number(choice.amount)
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter how long the ban lasts.' }
    end = nowMs + amount * UNIT_SECONDS[choice.unit] * 1000
  } else if (choice.preset === 'until') {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(choice.untilLocal)) return { error: 'Choose the date and time the ban ends.' }
    end = Date.parse(zone === 'UTC' ? `${choice.untilLocal}:00Z` : `${choice.untilLocal}:00`)
  } else {
    const preset = BAN_PRESETS.find(item => item.id === choice.preset)
    end = nowMs + (preset?.seconds ?? 0) * 1000
  }
  if (!Number.isFinite(end)) return { error: 'Choose when the ban ends.' }
  if (end - nowMs < 60_000) return { error: 'A temporary ban must end at least a minute from now.' }
  if (end - nowMs > 10 * 366 * 86400 * 1000) return { error: 'Temporary bans can last up to 10 years. Choose Permanent instead.' }
  return { permanent: false, until: new Date(end).toISOString() }
}

export const SANCTION_LABELS: Record<'warning' | 'ban' | 'unban' | 'ban_ended', string> = {
  warning: 'Warning',
  ban: 'Ban',
  unban: 'Ban lifted',
  ban_ended: 'Ban expired'
}
