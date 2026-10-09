import { Animated, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../contexts/AppearanceContext'
import { StrackerMark } from './Logo'

/**
 * In-app launch screen. The native splash shows the mark; this layer adds the DYPOL LABS line near the
 * bottom edge, offset by the device's bottom inset so gesture bars and notches never cover it.
 */
export function SplashOverlay({ opacity }: { opacity: Animated.Value }) {
  const { colors, appearance, type } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.root, { opacity, backgroundColor: colors.bg }]}>
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <StrackerMark size={160} />
      </View>
      <Text style={[type.h3, styles.footer, { color: colors.muted, paddingBottom: Math.max(insets.bottom, 12) + 24 }]} accessibilityLabel="DYPOL LABS">
        DYPOL LABS
      </Text>
      {appearance === 'dark' ? <View style={StyleSheet.absoluteFill} /> : null}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  root: { zIndex: 1000, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  footer: { textAlign: 'center', letterSpacing: 3 }
})
