import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { computeReminders } from '../shared/lib/jee/reminders'
import type { AppData } from '../shared/types'

/**
 * One daily device notification, scheduled by the operating system so it can fire while Stracker is
 * closed. Its wording is built from the reminders that really apply when the app syncs. If nothing
 * needs the student that day, nothing is scheduled, which matches the in-app rule of never nagging.
 */
const CHANNEL_ID = 'daily-reminders'

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false })
})

export type ReminderPermission = 'granted' | 'denied' | 'undetermined'

function toPermission(status: string): ReminderPermission {
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined'
}

export async function getReminderPermission(): Promise<ReminderPermission> {
  return toPermission((await Notifications.getPermissionsAsync()).status)
}

export async function requestReminderPermission(): Promise<ReminderPermission> {
  return toPermission((await Notifications.requestPermissionsAsync()).status)
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Daily reminders',
    description: 'One reminder a day, only when something needs you.',
    importance: Notifications.AndroidImportance.DEFAULT
  })
}

/** Replaces the single scheduled reminder with one that matches the current state, or removes it. */
export async function syncDeviceReminder(data: AppData, today: string): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync()
  if (!data.settings.reminders_enabled) return
  if ((await getReminderPermission()) !== 'granted') return
  const items = computeReminders(data, today)
  if (items.length === 0) return

  const body = items.length === 1
    ? `${items[0]?.title ?? 'Stracker'}: ${items[0]?.body ?? ''}`
    : `${items.length} things need you today — ${items.map(item => item.title).join(', ')}.`
  const [hourText = '8', minuteText = '0'] = data.settings.reminder_time.split(':')
  await ensureChannel()
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Stracker', body, data: { route: '/home' } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: Number(hourText),
      minute: Number(minuteText),
      channelId: CHANNEL_ID
    }
  })
}

export async function cancelDeviceReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync()
}
