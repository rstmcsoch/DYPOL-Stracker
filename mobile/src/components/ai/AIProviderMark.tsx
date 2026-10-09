import { StyleSheet, Text, View } from 'react-native'
import { Gem, Hexagon, Sparkles, Waves } from '../icons'
import { useTheme } from '../../contexts/AppearanceContext'
import { AI_PROVIDER_IDS, type AIProviderId } from '../../shared/lib/ai/catalog'

const LETTERS: Partial<Record<AIProviderId, string>> = { openai: 'O', anthropic: 'A' }

/** Provider badge: the same glyph or letter the website uses for each provider. Decorative only. */
export function AIProviderMark({ provider, small = false }: { provider: AIProviderId | string; small?: boolean }) {
  const theme = useTheme()
  const id = (AI_PROVIDER_IDS as readonly string[]).includes(provider) ? (provider as AIProviderId) : 'custom'
  const size = small ? 14 : 18
  const tint = theme.colors.accent
  const letter = LETTERS[id]
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.mark, small ? styles.small : null, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}
    >
      {id === 'gemini' ? <Gem size={size} color={tint} strokeWidth={2.1} />
        : id === 'deepseek' ? <Waves size={size} color={tint} strokeWidth={2.1} />
          : id === 'qwen' ? <Hexagon size={size} color={tint} strokeWidth={2.1} />
            : letter ? <Text style={[theme.type.label, { color: tint, fontSize: small ? 12 : 15, lineHeight: small ? 14 : 18 }]}>{letter}</Text>
              : <Sparkles size={size} color={tint} strokeWidth={2.1} />}
    </View>
  )
}

const styles = StyleSheet.create({
  mark: { width: 34, height: 34, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  small: { width: 24, height: 24 }
})
