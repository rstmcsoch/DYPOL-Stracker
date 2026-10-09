import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { Redirect, Stack, usePathname } from 'expo-router'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../contexts/AppearanceContext'
import { AIProvider } from '../../contexts/AIContext'
import { FocusProvider } from '../../contexts/FocusContext'
import { MobileDock } from '../../components/nav/MobileDock'
import { QuickActions } from '../../components/nav/QuickActions'
import { AssistantLauncher } from '../../components/nav/AssistantLauncher'
import { ShellOverlays } from '../../components/nav/ShellOverlays'
import { ShellProvider } from '../../components/nav/ShellContext'
import { useData } from '../../contexts/DataContext'
import { indiaToday } from '../../shared/lib/date'
import { syncDeviceReminder } from '../../lib/device-reminders'

/**
 * The signed-in app. Every page sits in one stack, so Android back behaves like the website's browser
 * history. AI and focus state are scoped to the account. The dock, quick actions, and the Ask Stracker
 * launcher stay on top of every page, except the immersive focus page, which hides them as the website's
 * focus page does. The assistant page itself hides the launcher.
 */
export default function AppLayout() {
  const { user, loading, recovering } = useAuth()
  const theme = useTheme()
  const pathname = usePathname()
  if (loading) return null
  if (!user) return <Redirect href="/login" />
  if (recovering) return <Redirect href="/reset-password" />
  const immersive = pathname === '/focus'
  return (
    <AIProvider key={user.id}>
      <FocusProvider key={user.id}>
        <ShellProvider>
          <View style={styles.fill}>
            <Stack
              screenOptions={{
                headerShown: false,
                animation: 'slide_from_right',
                contentStyle: { backgroundColor: theme.colors.bg }
              }}
            />
            {immersive ? null : <MobileDock />}
            {immersive || pathname === '/assistant' ? null : <AssistantLauncher />}
            {immersive ? null : <QuickActions />}
            <ShellOverlays />
            <ReminderSync />
          </View>
        </ShellProvider>
      </FocusProvider>
    </AIProvider>
  )
}

/** Keeps the one daily device notification in step with the data: it is rescheduled whenever the notebook changes. */
function ReminderSync() {
  const { data, loading } = useData()
  useEffect(() => {
    if (loading) return
    void syncDeviceReminder(data, indiaToday()).catch(() => undefined)
  }, [data, loading])
  return null
}

const styles = StyleSheet.create({
  fill: { flex: 1 }
})
