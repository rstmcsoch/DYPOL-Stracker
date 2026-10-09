import { useEffect, useState, type ReactNode } from 'react'
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from '../icons'
import { useTheme } from '../../contexts/AppearanceContext'
import { DIALOG_CORNERS, notebookCorners } from './notebook'
import { Button, IconButton } from './Button'

/** Bottom sheet. Android's back gesture closes it through Modal's onRequestClose. */
export function Sheet({ visible, onClose, title, subtitle, children }: { visible: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode }) {
  const { colors, shadow, type } = useTheme()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const [slide] = useState(() => new Animated.Value(0))
  useEffect(() => {
    if (visible) Animated.timing(slide, { toValue: 1, duration: 220, useNativeDriver: true }).start()
    else slide.setValue(0)
  }, [visible, slide])
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.sheetBackdrop}>
        <Pressable accessibilityLabel="Close" accessibilityRole="button" style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            shadow.float,
            { backgroundColor: colors.paper, borderColor: colors.line, paddingBottom: 16 + insets.bottom, maxHeight: height * 0.86 },
            { transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }], opacity: slide }
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.lineStrong }]} />
          <View style={styles.sheetHead}>
            <View style={{ flex: 1 }}>
              <Text accessibilityRole="header" style={[type.h2, { color: colors.ink }]}>{title}</Text>
              {subtitle ? <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]}>{subtitle}</Text> : null}
            </View>
            <IconButton label="Close" onPress={onClose}><X size={19} color={colors.inkSoft} /></IconButton>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 6 }}>{children}</ScrollView>
        </Animated.View>
      </View>
    </Modal>
  )
}

/** Centred dialog for focused tasks such as editing a record. Escape-free by design: Android back closes it. */
export function Dialog({ visible, onClose, title, subtitle, children, footer }: { visible: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const { colors, shadow, type } = useTheme()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.dialogBackdrop, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <View accessibilityViewIsModal style={[styles.dialog, DIALOG_CORNERS, shadow.float, { backgroundColor: colors.paper, borderColor: colors.lineStrong, maxHeight: height * 0.9 }]}>
          <View style={styles.dialogHead}>
            <View style={{ flex: 1 }}>
              <Text accessibilityRole="header" style={[type.h2, { color: colors.ink }]}>{title}</Text>
              {subtitle ? <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]}>{subtitle}</Text> : null}
            </View>
            <IconButton label="Close dialog" onPress={onClose}><X size={19} color={colors.inkSoft} /></IconButton>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 4 }}>{children}</ScrollView>
          {footer ? <View style={styles.dialogFooter}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  )
}

export function ConfirmDialog({ visible, title, message, confirmLabel = 'Delete', danger = true, loading = false, onConfirm, onCancel }: {
  visible: boolean; title: string; message: string; confirmLabel?: string; danger?: boolean; loading?: boolean; onConfirm: () => void; onCancel: () => void
}) {
  const { colors, type } = useTheme()
  return (
    <Dialog
      visible={visible}
      onClose={onCancel}
      title={title}
      footer={(
        <View style={styles.actions}>
          <Button variant="secondary" onPress={onCancel} disabled={loading}>Keep it</Button>
          <Button variant={danger ? 'danger' : 'primary'} onPress={onConfirm} loading={loading}>{loading ? 'Working…' : confirmLabel}</Button>
        </View>
      )}
    >
      <Text style={[type.body, { color: colors.inkSoft }]}>{message}</Text>
    </Dialog>
  )
}

export interface MenuItem { id: string; label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect: () => void }

/** Row action menu. Opens as a sheet of actions, which replaces the website's floating ⋯ popover. */
export function ActionMenu({ visible, onClose, title, items }: { visible: boolean; onClose: () => void; title: string; items: MenuItem[] }) {
  const { colors, type } = useTheme()
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ gap: 6 }}>
        {items.map(item => (
          <Pressable
            key={item.id}
            accessibilityRole="menuitem"
            accessibilityState={{ disabled: item.disabled }}
            disabled={item.disabled}
            onPress={() => { onClose(); item.onSelect() }}
            style={({ pressed }) => [styles.menuItem, notebookCorners(9, 11, 10, 8), { borderColor: colors.line, backgroundColor: pressed ? colors.paperMuted : colors.paperSoft, opacity: item.disabled ? 0.45 : 1 }]}
          >
            {item.icon}
            <Text style={[type.body, { color: item.danger ? colors.red : colors.ink, fontWeight: '600', flex: 1 }]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(27, 31, 28, 0.45)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, paddingHorizontal: 20, paddingTop: 8 },
  handle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, marginBottom: 10 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  dialogBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18, backgroundColor: 'rgba(26, 31, 28, 0.47)' },
  dialog: { width: '100%', maxWidth: 560, borderWidth: 1, padding: 18 },
  dialogHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  dialogFooter: { marginTop: 14 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingHorizontal: 14, borderWidth: 1 }
})
