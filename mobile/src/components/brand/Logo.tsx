import { Text, View } from 'react-native'
import { SvgXml } from 'react-native-svg'
import { STRACKER_MARK_SVG } from './stracker-mark.generated'
import { useTheme } from '../../contexts/AppearanceContext'

/** The Stracker mark: the same outlined SVG the website and the launcher icon are generated from. */
export function StrackerMark({ size = 48 }: { size?: number }) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Stracker logo" style={{ width: size, height: size }}>
      <SvgXml xml={STRACKER_MARK_SVG} width={size} height={size} />
    </View>
  )
}

/** Mark plus wordmark, as in the website's sidebar brand block. */
export function BrandLockup({ size = 40 }: { size?: number }) {
  const { colors, type } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <StrackerMark size={size} />
      <View>
        <Text style={[type.brand, { color: colors.ink, fontSize: 24, lineHeight: 24 }]}>Stracker</Text>
        <Text style={{ color: colors.muted, fontFamily: type.overline.fontFamily, fontSize: 9, letterSpacing: 1.5, marginTop: 3 }}>JEE 2027 NOTEBOOK</Text>
      </View>
    </View>
  )
}
