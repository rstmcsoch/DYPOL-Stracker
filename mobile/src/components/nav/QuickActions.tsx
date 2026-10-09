import { Pressable, StyleSheet } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../contexts/AppearanceContext'
import { ClipboardList, Focus, ListChecks, ListTodo, Plus, Sparkles } from '../icons'
import { ActionMenu, type MenuItem } from '../ui/Overlays'
import { FAB_CORNERS } from '../ui/notebook'
import { TAB_BAR_HEIGHT } from '../ui/Screen'
import { useShell } from './ShellContext'

/** The floating quick-action button. Its menu offers the fast entry points from the website, plus the assistant. */
export function QuickActions() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const shell = useShell()
  const go = (href: string) => {
    shell.setQuickActionsOpen(false)
    router.navigate(href as Href)
  }
  const items: MenuItem[] = [
    { id: 'task', label: 'Plan a task', icon: <ListTodo size={18} color={theme.colors.ink} />, onSelect: shell.openQuickTask },
    { id: 'test', label: 'Add a test', icon: <ListChecks size={18} color={theme.colors.ink} />, onSelect: () => go('/tests?add=1') },
    { id: 'practice', label: 'Log practice', icon: <ClipboardList size={18} color={theme.colors.ink} />, onSelect: () => go('/practice?add=1') },
    { id: 'focus', label: 'Focus session', icon: <Focus size={18} color={theme.colors.ink} />, onSelect: () => go('/focus') },
    { id: 'assistant', label: 'Ask Stracker', icon: <Sparkles size={18} color={theme.colors.ink} />, onSelect: () => go('/assistant') }
  ]
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Quick actions"
        onPress={() => shell.setQuickActionsOpen(true)}
        style={({ pressed }) => [
          styles.fab,
          theme.shadow.float,
          { bottom: TAB_BAR_HEIGHT + insets.bottom + 14, right: 18, backgroundColor: theme.colors.fabBg, borderColor: theme.colors.fabBorder, opacity: pressed ? 0.85 : 1 }
        ]}
      >
        <Plus size={26} color={theme.colors.fabInk} />
      </Pressable>
      <ActionMenu visible={shell.quickActionsOpen} onClose={() => shell.setQuickActionsOpen(false)} title="Quick actions" items={items} />
    </>
  )
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    ...FAB_CORNERS
  }
})
