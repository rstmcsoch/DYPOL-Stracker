import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { BrandLockup } from '../brand/Logo'
import { ArrowLeft, LockKeyhole, Sparkles } from '../icons'
import { useTheme } from '../../contexts/AppearanceContext'
import { NotebookCard } from '../ui/Surfaces'
import { Screen } from '../ui/Screen'

/** Shared chrome for log in, sign up, and password reset: the website's standalone auth layout. */
export function AuthScaffold({ kicker, title, emphasis, blurb, note, children }: {
  kicker: string
  title: string
  /** Second line of the heading, drawn in the accent colour as on the website's `<em>`. */
  emphasis?: string
  blurb: string
  note?: string
  children: ReactNode
}) {
  const theme = useTheme()
  const router = useRouter()
  return (
    <Screen chrome={false}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Back to Stracker"
          onPress={() => router.replace('/')}
          style={({ pressed }) => [styles.back, { opacity: pressed ? 0.7 : 1 }]}
        >
          <ArrowLeft size={14} color={theme.colors.inkSoft} />
          <Text style={[theme.type.caption, { color: theme.colors.inkSoft, fontFamily: theme.fonts.bodySemibold, fontSize: 13 }]}>Back to Stracker</Text>
        </Pressable>
        <View style={styles.private}>
          <LockKeyhole size={13} color={theme.colors.muted} />
          <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11, lineHeight: 14 }]}>Private notebook</Text>
        </View>
      </View>
      <View style={styles.brand}><BrandLockup size={40} /></View>
      <View style={styles.intro}>
        <Text style={[theme.type.overline, { color: theme.colors.accent }]}>✎ {kicker}</Text>
        <Text accessibilityRole="header" style={[theme.type.display, { color: theme.colors.ink }]}>
          {title}
          {emphasis ? <Text style={{ color: theme.colors.accent }}>{` ${emphasis}`}</Text> : null}
        </Text>
        <Text style={[theme.type.body, { color: theme.colors.inkSoft }]}>{blurb}</Text>
        {note ? (
          <View style={styles.note}>
            <Sparkles size={14} color={theme.colors.accent} />
            <Text style={[theme.type.caption, { color: theme.colors.inkSoft, flex: 1 }]}>{note}</Text>
          </View>
        ) : null}
      </View>
      {children}
      <View style={styles.footer}>
        <View style={[styles.rule, { backgroundColor: theme.colors.line }]} />
        <Text style={[theme.type.brand, { color: theme.colors.ink, fontSize: 16, lineHeight: 18 }]}>Stracker <Text style={{ color: theme.colors.muted, fontSize: 13 }}>by DYPOL LABS</Text></Text>
        <View style={[styles.rule, { backgroundColor: theme.colors.line }]} />
      </View>
    </Screen>
  )
}

/** The notebook card that holds each auth form, with a small sticker label and an icon header. */
export function AuthCard({ sticker, icon, eyebrow, heading, children, footer }: {
  sticker: string
  icon: ReactNode
  eyebrow: string
  heading: string
  children: ReactNode
  footer?: string
}) {
  const theme = useTheme()
  return (
    <NotebookCard padding={18} style={styles.card}>
      <View style={[styles.sticker, { backgroundColor: theme.colors.surfaceCoolAccentBg, borderColor: theme.colors.line }]}>
        <Text style={[theme.type.overline, { color: theme.colors.accent, fontSize: 11, lineHeight: 14 }]}>{sticker}</Text>
      </View>
      <View style={styles.head}>
        <View style={[styles.iconTile, { backgroundColor: theme.colors.paperSoft, borderColor: theme.colors.line }]}>{icon}</View>
        <View style={{ flex: 1 }}>
          <Text style={[theme.type.overline, { color: theme.colors.muted }]}>{eyebrow}</Text>
          <Text accessibilityRole="header" style={[theme.type.h2, { color: theme.colors.ink }]}>{heading}</Text>
        </View>
      </View>
      <View style={styles.body}>{children}</View>
      {footer ? (
        <View style={[styles.foot, { borderTopColor: theme.colors.line }]}>
          <LockKeyhole size={13} color={theme.colors.muted} />
          <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5, flex: 1 }]}>{footer}</Text>
        </View>
      ) : null}
    </NotebookCard>
  )
}

/** A bordered error or status box. Errors are announced to screen readers. */
export function FormNotice({ tone, children }: { tone: 'error' | 'status'; children: ReactNode }) {
  const theme = useTheme()
  const color = tone === 'error' ? theme.colors.red : theme.colors.inkSoft
  const background = tone === 'error' ? theme.colors.redBg : theme.colors.paperSoft
  return (
    <View accessibilityRole={tone === 'error' ? 'alert' : 'text'} accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'} style={[styles.notice, { borderColor: color, backgroundColor: background }]}>
      <Text style={[theme.type.caption, { color, flex: 1 }]}>{children}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 42 },
  private: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  brand: { marginTop: 4, marginBottom: 12 },
  intro: { gap: 10, marginBottom: 18 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 4 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 26 },
  rule: { flex: 1, height: 1 },
  card: { gap: 14 },
  sticker: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconTile: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  body: { gap: 14 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  notice: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }
})
