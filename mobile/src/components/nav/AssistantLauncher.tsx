import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../contexts/AppearanceContext'
import { useAI } from '../../contexts/AIContext'
import { Sparkles } from '../icons'
import { FAB_CORNERS } from '../ui/notebook'
import { TAB_BAR_HEIGHT } from '../ui/Screen'

/**
 * The website's floating "Ask Stracker" launcher. It opens the assistant screen. While an AI task runs
 * the launcher shows a live dot, and the task keeps running when the user leaves the assistant.
 */
export function AssistantLauncher() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { isBusy, activeTask } = useAI()
  const label = isBusy ? 'Working…' : 'Ask Stracker'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isBusy ? `Open Stracker AI Assistant. ${activeTask?.progress ?? 'A task is running.'}` : 'Open Stracker AI Assistant'}
      onPress={() => router.navigate('/assistant' as Href)}
      style={({ pressed }) => [
        styles.launcher,
        theme.shadow.float,
        { bottom: TAB_BAR_HEIGHT + insets.bottom + 14, left: 18, backgroundColor: theme.colors.fabBg, borderColor: theme.colors.fabBorder, opacity: pressed ? 0.85 : 1 }
      ]}
    >
      <Sparkles size={18} color={theme.colors.fabInk} />
      <Text style={[theme.type.label, { color: theme.colors.fabInk }]}>{label}</Text>
      {isBusy ? <View style={[styles.busy, { backgroundColor: theme.colors.accent }]} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  launcher: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 48,
    paddingHorizontal: 15,
    borderWidth: 1.5,
    ...FAB_CORNERS
  },
  busy: { position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 999 }
})
