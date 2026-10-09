import { StyleSheet, Text, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { useTheme } from '../../contexts/AppearanceContext'

const clamp = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0)

export function ProgressBar({ value, color, label }: { value: number; color?: string; label?: string }) {
  const { colors, type } = useTheme()
  const safe = clamp(value)
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label ?? 'Progress'} accessibilityValue={{ min: 0, max: 100, now: Math.round(safe) }}>
      <View style={[styles.track, { backgroundColor: colors.paperMuted, borderColor: colors.line }]}>
        <View style={[styles.fill, { width: `${safe}%`, backgroundColor: color ?? colors.accent }]} />
      </View>
      {label ? <Text style={[type.caption, { color: colors.muted, marginTop: 4 }]}>{label}</Text> : null}
    </View>
  )
}

export function ProgressRing({ value, size = 94, label, sublabel, color }: { value: number; size?: number; label?: string; sublabel?: string; color?: string }) {
  const { colors, type } = useTheme()
  const safe = clamp(value)
  const radius = 40
  const circumference = 2 * Math.PI * radius
  const dash = (circumference * safe) / 100
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="image" accessibilityLabel={`${Math.round(safe)} percent${sublabel ? `, ${sublabel}` : ''}`}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Circle cx="50" cy="50" r={radius} stroke={colors.ringTrack} strokeWidth={9} fill="none" />
        <Circle
          cx="50" cy="50" r={radius} stroke={color ?? colors.ink} strokeWidth={9} fill="none"
          strokeLinecap="round" strokeDasharray={`${dash} ${circumference}`} transform="rotate(-90 50 50)"
        />
      </Svg>
      <View style={styles.ringLabel}>
        <Text style={[type.metric, { color: colors.ink, fontSize: size >= 90 ? 24 : 18, lineHeight: size >= 90 ? 26 : 20 }]}>{label ?? `${Math.round(safe)}%`}</Text>
        {sublabel ? <Text style={[type.caption, { color: colors.muted, fontSize: 11 }]}>{sublabel}</Text> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  track: { height: 10, borderRadius: 999, borderWidth: 1, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
  ringLabel: { position: 'absolute', alignItems: 'center' }
})
