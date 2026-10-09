import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { useAuth } from '../../contexts/AuthContext'
import { useData } from '../../contexts/DataContext'
import { useTheme } from '../../contexts/AppearanceContext'
import { useToast } from '../../contexts/ToastContext'
import { ChevronRight, LogOut } from '../icons'
import { Sheet } from '../ui/Overlays'
import { useShell } from './ShellContext'
import { DOCK_ITEMS, NAV_GROUPS } from './nav-items'

/** Every page that is not on the dock, grouped as on the website, plus sign out. */
export function MoreSheet() {
  const theme = useTheme()
  const router = useRouter()
  const shell = useShell()
  const { user, signOut } = useAuth()
  const { data } = useData()
  const { notify } = useToast()
  const name = data.settings.owner_name || data.profile?.display_name || user?.displayName || 'Your notebook'
  const dockPaths = new Set(DOCK_ITEMS.map(item => item.to))
  const open = (to: string) => {
    shell.closeMore()
    router.navigate(to as Href)
  }
  const onSignOut = () => {
    shell.closeMore()
    void signOut().catch(() => notify('Could not sign out. Try again.', 'error'))
  }
  return (
    <Sheet visible={shell.moreOpen} onClose={shell.closeMore} title={name} subtitle={user?.isLocal ? 'Local preview (not synced)' : user?.email}>
      <View style={styles.groups}>
        {NAV_GROUPS.map(group => {
          const items = group.items.filter(item => !dockPaths.has(item.to))
          if (!items.length) return null
          return (
            <View key={group.caption} style={styles.group}>
              <Text style={[theme.type.overline, styles.caption, { color: theme.colors.muted }]}>{group.caption}</Text>
              {items.map(item => {
                const Icon = item.icon
                return (
                  <Pressable
                    key={item.to}
                    accessibilityRole="link"
                    accessibilityLabel={item.label}
                    onPress={() => open(item.to)}
                    style={({ pressed }) => [styles.row, { borderColor: theme.colors.line, backgroundColor: pressed ? theme.colors.paperSoft : theme.colors.paper }]}
                  >
                    <Icon size={19} color={theme.colors.inkSoft} />
                    <Text style={[theme.type.label, styles.rowLabel, { color: theme.colors.ink }]}>{item.label}</Text>
                    <ChevronRight size={16} color={theme.colors.muted} />
                  </Pressable>
                )
              })}
            </View>
          )
        })}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        onPress={onSignOut}
        style={({ pressed }) => [styles.row, styles.signOut, { borderColor: theme.colors.line, backgroundColor: pressed ? theme.colors.paperSoft : theme.colors.paper }]}
      >
        <LogOut size={19} color={theme.colors.red} />
        <Text style={[theme.type.label, styles.rowLabel, { color: theme.colors.red }]}>Sign out</Text>
      </Pressable>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  groups: { gap: 14 },
  group: { gap: 6 },
  caption: { fontSize: 11.5, lineHeight: 15, marginBottom: 2 },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  rowLabel: { flex: 1 },
  signOut: { marginTop: 14 }
})
