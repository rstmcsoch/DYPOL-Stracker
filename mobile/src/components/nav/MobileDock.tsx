import { Pressable, StyleSheet, Text, View } from 'react-native'
import { usePathname, useRouter, type Href } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../contexts/AppearanceContext'
import { MoreHorizontal, type LucideIcon } from '../icons'
import { useShell } from './ShellContext'
import { DOCK_ITEMS, MORE_PATHS } from './nav-items'
import { TAB_BAR_HEIGHT } from '../ui/Screen'

/** The bottom dock: the four daily destinations and More. It stays on every app page, as on the website. */
export function MobileDock() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const pathname = usePathname()
  const router = useRouter()
  const shell = useShell()
  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={[styles.dock, { backgroundColor: theme.colors.paper, borderTopColor: theme.colors.line, paddingBottom: insets.bottom, height: TAB_BAR_HEIGHT + insets.bottom }]} accessibilityRole="tablist">
        {DOCK_ITEMS.map(item => (
          <DockButton
            key={item.to}
            label={item.label}
            icon={item.icon}
            active={pathname === item.to}
            onPress={() => router.navigate(item.to as Href)}
          />
        ))}
        <DockButton label="More" icon={MoreHorizontal} active={MORE_PATHS.has(pathname)} onPress={shell.openMore} />
      </View>
    </View>
  )
}

function DockButton({ label, icon: Icon, active, onPress }: { label: string; icon: LucideIcon; active: boolean; onPress: () => void }) {
  const theme = useTheme()
  const tint = active ? theme.colors.accent : theme.colors.muted
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.item, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.pill, { backgroundColor: active ? theme.colors.surfaceCoolAccentBg : 'transparent' }]}>
        <Icon size={21} color={tint} strokeWidth={active ? 2.4 : 2} />
      </View>
      <Text numberOfLines={1} style={[styles.label, { color: tint, fontFamily: active ? theme.fonts.bodyBold : theme.fonts.bodySemibold }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end' },
  dock: { flexDirection: 'row', borderTopWidth: 1, paddingHorizontal: 6 },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 56 },
  pill: { paddingHorizontal: 16, paddingVertical: 4, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11.5, lineHeight: 14 }
})
