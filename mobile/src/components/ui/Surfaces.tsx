import type { ReactNode } from 'react'
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { Star } from '../icons'
import { useTheme } from '../../contexts/AppearanceContext'
import { subjectColors } from '../../theme/theme'
import { CARD_CORNERS } from './notebook'

export type CardAccent = 'blue' | 'green' | 'orange' | 'yellow' | 'plain'

/** A ruled notebook card: paper surface, hairline border, asymmetric corners, soft shadow. */
export function NotebookCard({ children, accent = 'plain', style, padding = 18 }: { children: ReactNode; accent?: CardAccent; style?: StyleProp<ViewStyle>; padding?: number }) {
  const { colors, shadow } = useTheme()
  const accentColor = {
    blue: colors.accent,
    green: colors.green,
    orange: colors.orange,
    yellow: colors.focusAccent,
    plain: 'transparent'
  }[accent]
  return (
    <View style={[styles.card, CARD_CORNERS, shadow.card, { backgroundColor: colors.paper, borderColor: colors.line, padding }, style]}>
      {accent !== 'plain' ? <View pointerEvents="none" style={[styles.accentBar, { backgroundColor: accentColor }]} /> : null}
      {children}
    </View>
  )
}

export function PageHeader({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: string; subtitle?: string; action?: ReactNode }) {
  const { colors, type } = useTheme()
  return (
    <View style={styles.pageHeader}>
      <View style={styles.pageHeaderCopy}>
        {eyebrow ? <Text style={[type.overline, { color: colors.muted }]}>{eyebrow}</Text> : null}
        <Text accessibilityRole="header" style={[type.h1, { color: colors.ink, marginTop: 4 }]}>{title}</Text>
        {subtitle ? <Text style={[type.body, { color: colors.inkSoft, marginTop: 4 }]}>{subtitle}</Text> : null}
      </View>
      {action ? <View style={styles.pageHeaderAction}>{action}</View> : null}
    </View>
  )
}

export function SectionHeading({ title, note, action }: { title: string; note?: string; action?: ReactNode }) {
  const { colors, type } = useTheme()
  return (
    <View style={styles.sectionHeading}>
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={[type.h2, { color: colors.ink }]}>{title}</Text>
        {note ? <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]}>{note}</Text> : null}
      </View>
      {action}
    </View>
  )
}

export function EmptyState({ title, description, action, icon }: { title: string; description: string; action?: ReactNode; icon?: ReactNode }) {
  const { colors, type } = useTheme()
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyMark, { borderColor: colors.line, backgroundColor: colors.paperSoft }]}>
        {icon ?? <Star size={20} color={colors.tintWarm} />}
      </View>
      <Text style={[type.h3, { color: colors.ink, textAlign: 'center', marginTop: 8 }]}>{title}</Text>
      <Text style={[type.caption, { color: colors.muted, textAlign: 'center', marginTop: 4, maxWidth: 340 }]}>{description}</Text>
      {action ? <View style={{ marginTop: 14 }}>{action}</View> : null}
    </View>
  )
}

export function SubjectBadge({ subject }: { subject: string | null | undefined }) {
  const theme = useTheme()
  const { fg, bg } = subjectColors(theme, subject)
  return (
    <View style={[styles.badge, { backgroundColor: bg, borderColor: `${fg}55` }]} accessibilityLabel={subject ?? 'General'}>
      <Text style={[theme.type.badge, { color: fg }]}>{subject ?? 'General'}</Text>
    </View>
  )
}

export type StatusTone = 'muted' | 'good' | 'warn' | 'bad' | 'info'

export function StatusBadge({ children, tone = 'muted' }: { children: ReactNode; tone?: StatusTone }) {
  const { colors, type } = useTheme()
  const palette = {
    muted: { fg: colors.inkSoft, bg: colors.paperMuted },
    good: { fg: colors.green, bg: colors.greenBg },
    warn: { fg: colors.orange, bg: colors.orangeBg },
    bad: { fg: colors.red, bg: colors.redBg },
    info: { fg: colors.accentDark, bg: colors.accentLight }
  }[tone]
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg, borderColor: `${palette.fg}55` }]}>
      <Text style={[type.badge, { color: palette.fg }]}>{children}</Text>
    </View>
  )
}

export function StatCard({ label, value, note, icon }: { label: string; value: ReactNode; note?: ReactNode; icon?: ReactNode }) {
  const { colors, type } = useTheme()
  return (
    <NotebookCard style={styles.statCard}>
      <View style={styles.statTop}>
        <Text style={[type.caption, { color: colors.muted, flex: 1 }]} numberOfLines={2}>{label}</Text>
        {icon}
      </View>
      <Text style={[type.metric, { color: colors.ink, marginTop: 6 }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {note ? <Text style={[type.caption, { color: colors.muted, marginTop: 4 }]}>{note}</Text> : null}
    </NotebookCard>
  )
}

export function CheckMark({ checked }: { checked: boolean }) {
  const { colors } = useTheme()
  return (
    <View style={[styles.check, { borderColor: checked ? colors.green : colors.lineStrong, backgroundColor: checked ? colors.greenBg : colors.paper }]}>
      {checked ? <Text style={{ color: colors.green, fontSize: 13, fontWeight: '700', lineHeight: 15 }}>✓</Text> : null}
    </View>
  )
}

/** Ruled-line divider in the hand-drawn style of the website's hand-line. */
export function HandLine() {
  const { colors } = useTheme()
  return <View style={[styles.handLine, { backgroundColor: colors.lineStrong }]} />
}

const styles = StyleSheet.create({
  card: { position: 'relative', overflow: 'hidden', borderWidth: 1 },
  accentBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  pageHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, paddingTop: 4, paddingBottom: 8 },
  pageHeaderCopy: { flex: 1 },
  pageHeaderAction: { flexShrink: 0, paddingBottom: 3 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, marginTop: 6 },
  empty: { width: '100%', minHeight: 160, alignItems: 'center', justifyContent: 'center', paddingVertical: 22, paddingHorizontal: 12 },
  emptyMark: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, minHeight: 22, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1 },
  statCard: { flexGrow: 1, flexBasis: '46%', minWidth: 140 },
  statTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  check: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  handLine: { height: 1, width: '100%', opacity: 0.6, marginVertical: 10 }
})
