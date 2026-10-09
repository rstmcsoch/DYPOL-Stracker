import { Pressable, StyleSheet, Text, View } from 'react-native'
import { usePathname, useRouter, type Href } from 'expo-router'
import { useTheme } from '../../contexts/AppearanceContext'
import { useData } from '../../contexts/DataContext'
import { StrackerMark } from '../brand/Logo'
import { ArrowLeft, Cloud, CloudOff, Search, ShieldCheck } from '../icons'
import { IconButton } from '../ui/Button'
import { useShell } from './ShellContext'
import { DOCK_ITEMS, NAV_GROUPS } from './nav-items'

const ALL_PAGES = [...DOCK_ITEMS, ...NAV_GROUPS.flatMap(group => group.items)]

/** Top bar for every app page: back navigation, the page name, sync status, and search. */
export function AppTopbar() {
  const theme = useTheme()
  const router = useRouter()
  const pathname = usePathname()
  const shell = useShell()
  const { syncState, pendingCount, syncError, refresh } = useData()
  const label = pathname === '/home' ? 'Study home' : ALL_PAGES.find(item => item.to === pathname)?.label ?? 'Notebook'
  const isHome = pathname === '/home'
  const statusLabel = syncState === 'loading' ? 'Loading'
    : syncState === 'syncing' ? 'Syncing'
      : syncState === 'offline' ? 'Offline'
        : syncState === 'error' ? 'Sync issue'
          : syncState === 'local' ? 'On this device'
            : pendingCount ? `${pendingCount} pending` : 'Synced'
  const StatusIcon = syncState === 'offline' || syncState === 'error' ? CloudOff : syncState === 'local' ? ShieldCheck : Cloud
  const goBack = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/home' as Href)
  }
  return (
    <View style={[styles.bar, { borderBottomColor: theme.colors.line, backgroundColor: theme.colors.paper }]}>
      {isHome ? <StrackerMark size={30} /> : <IconButton label="Go back" onPress={goBack}><ArrowLeft size={20} color={theme.colors.inkSoft} /></IconButton>}
      <View style={styles.crumb}>
        <Text numberOfLines={1} style={[theme.type.caption, { color: theme.colors.muted, fontFamily: theme.fonts.bodySemibold, fontSize: 12 }]}>JEE 2027</Text>
        <Text numberOfLines={1} accessibilityRole="header" style={[theme.type.h3, { color: theme.colors.ink }]}>{label}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Sync status: ${statusLabel}`}
        accessibilityHint="Syncs your notebook now"
        onPress={() => void refresh()}
        style={({ pressed }) => [styles.sync, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft, opacity: pressed ? 0.7 : 1 }]}
      >
        <StatusIcon size={16} color={syncState === 'error' ? theme.colors.red : theme.colors.inkSoft} />
        {pendingCount > 0 ? <View style={[styles.dot, { backgroundColor: theme.colors.accent }]} /> : null}
      </Pressable>
      <IconButton label="Search your notebook" onPress={shell.openSearch}><Search size={19} color={theme.colors.inkSoft} /></IconButton>
      {syncError ? <Text accessibilityLiveRegion="polite" style={styles.hidden}>{syncError}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, minHeight: 56 },
  crumb: { flex: 1, minWidth: 0 },
  sync: { width: 42, height: 42, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 9, right: 9, width: 8, height: 8, borderRadius: 4 },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 }
})
