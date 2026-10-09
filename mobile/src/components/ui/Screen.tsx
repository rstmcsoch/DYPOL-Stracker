import type { ReactNode, RefObject } from 'react'
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../contexts/AppearanceContext'
import { AppTopbar } from '../nav/AppTopbar'

/** Faint ruled lines behind every screen, the notebook paper the website draws with a repeating gradient. */
export function NotebookBackground() {
  const { colors, isDark } = useTheme()
  const rule = isDark ? 'rgba(220, 226, 213, 0.07)' : 'rgba(148, 159, 152, 0.1)'
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <Pattern id="ruled" x="0" y="0" width="100" height="36" patternUnits="userSpaceOnUse">
          <Line x1="0" y1="35.5" x2="100" y2="35.5" stroke={rule} strokeWidth={1} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={colors.bg} />
      <Rect width="100%" height="100%" fill="url(#ruled)" />
    </Svg>
  )
}

/** Height of the bottom dock, excluding the device's bottom inset. */
export const TAB_BAR_HEIGHT = 64

interface ScreenProps {
  children: ReactNode
  /** Scroll the content. Pages with a long list manage their own list instead. */
  scroll?: boolean
  refreshing?: boolean
  onRefresh?: () => void
  /**
   * App pages show the top bar and reserve room for the bottom dock. Auth, landing, and the
   * launch screens turn this off.
   */
  chrome?: boolean
  contentStyle?: StyleProp<ViewStyle>
  /** Lets a page scroll to its own sections, for example the landing page's section links. */
  scrollRef?: RefObject<ScrollView | null>
}

/**
 * Page frame used by every screen: notebook background, safe-area insets on every edge, keyboard
 * avoidance for forms, and pull-to-refresh for the synced lists.
 */
export function Screen({ children, scroll = true, refreshing = false, onRefresh, chrome = true, contentStyle, scrollRef }: ScreenProps) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const bottom = (chrome ? TAB_BAR_HEIGHT : 0) + insets.bottom + 24
  const padding = { paddingHorizontal: 16, paddingTop: 12, paddingBottom: bottom }
  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[padding, contentStyle]}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, padding, contentStyle]}>{children}</View>
  )
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: colors.bg }]}>
      <NotebookBackground />
      {chrome ? <AppTopbar /> : null}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 }
})
