import { useEffect, useState } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useToast, type ToastItem } from '../../contexts/ToastContext'
import { useTheme } from '../../contexts/AppearanceContext'
import { TAB_BAR_HEIGHT } from './Screen'
import { BUTTON_CORNERS } from './notebook'

function ToastRow({ toast, onDismiss, raised }: { toast: ToastItem; onDismiss: () => void; raised: boolean }) {
  const { colors, shadow, type } = useTheme()
  const [fade] = useState(() => new Animated.Value(0))
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start()
  }, [fade])
  const tone = toast.tone === 'error'
    ? { bg: colors.redBg, border: colors.red, ink: colors.red }
    : toast.tone === 'success'
      ? { bg: colors.greenBg, border: colors.green, ink: colors.green }
      : { bg: colors.paper, border: colors.lineStrong, ink: colors.ink }
  return (
    <Animated.View style={{ opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
      <Pressable
        accessibilityRole="alert"
        accessibilityLiveRegion={toast.tone === 'error' ? 'assertive' : 'polite'}
        onPress={onDismiss}
        style={[styles.toast, BUTTON_CORNERS, shadow.card, { backgroundColor: tone.bg, borderColor: tone.border, marginBottom: raised ? 0 : 8 }]}
      >
        <Text style={[type.body, { color: tone.ink, fontSize: 14.5, lineHeight: 20 }]}>{toast.message}</Text>
      </Pressable>
    </Animated.View>
  )
}

/** Toast stack shown above the tab bar. Tapping a toast dismisses it. */
export function ToastViewport({ raised = true }: { raised?: boolean }) {
  const { toasts, dismiss } = useToast()
  const insets = useSafeAreaInsets()
  if (!toasts.length) return null
  return (
    <View pointerEvents="box-none" style={[styles.viewport, { bottom: (raised ? TAB_BAR_HEIGHT + insets.bottom : insets.bottom) + 10 }]}>
      {toasts.map(toast => <ToastRow key={toast.id} toast={toast} raised={raised} onDismiss={() => dismiss(toast.id)} />)}
    </View>
  )
}

const styles = StyleSheet.create({
  viewport: { position: 'absolute', left: 14, right: 14, gap: 8, zIndex: 900 },
  toast: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11 }
})
