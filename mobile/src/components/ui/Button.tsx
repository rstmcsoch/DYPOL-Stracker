import { useState } from 'react'
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle, type AccessibilityRole } from 'react-native'
import * as Haptics from 'expo-haptics'
import { useTheme } from '../../contexts/AppearanceContext'
import { BUTTON_CORNERS } from './notebook'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'marker'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps {
  children: React.ReactNode
  onPress?: () => void
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  disabled?: boolean
  icon?: React.ReactNode
  fullWidth?: boolean
  accessibilityLabel?: string
  accessibilityRole?: AccessibilityRole
  style?: StyleProp<ViewStyle>
  testID?: string
}

const HEIGHT: Record<ButtonSize, number> = { sm: 36, md: 42, lg: 48 }

/**
 * The website's tactile button: a 3px bottom shadow on primary and danger actions, a notebook corner
 * radius, and a light press response. Touch targets are never smaller than 42 dp.
 */
export function Button({
  children, onPress, variant = 'primary', size = 'md', loading = false, disabled = false, icon, fullWidth = false,
  accessibilityLabel, accessibilityRole = 'button', style, testID
}: ButtonProps) {
  const theme = useTheme()
  const { colors, fonts } = theme
  const [scale] = useState(() => new Animated.Value(1))
  const isDisabled = disabled || loading
  const palette = (() => {
    switch (variant) {
      case 'primary': return { bg: colors.buttonPrimaryBg, border: colors.buttonPrimaryBorder, ink: colors.buttonPrimaryInk, shadow: colors.buttonPrimaryShadow }
      case 'danger': return { bg: colors.buttonDangerBg, border: colors.buttonDangerBorder, ink: colors.buttonDangerInk, shadow: colors.buttonDangerShadow }
      case 'marker': return { bg: '#ecd79e', border: '#bf9654', ink: '#453d2c', shadow: '#c6a967' }
      case 'secondary': return { bg: colors.paper, border: colors.lineStrong, ink: colors.inkSoft, shadow: 'rgba(71, 70, 57, 0.07)' }
      case 'quiet': return { bg: 'transparent', border: 'transparent', ink: colors.inkSoft, shadow: 'transparent' }
    }
  })()
  const raised = variant === 'primary' || variant === 'danger' || variant === 'marker'
  const press = (pressed: boolean) => Animated.spring(scale, { toValue: pressed ? 0.97 : 1, useNativeDriver: true, speed: 40, bounciness: 0 }).start()
  const fontSize = size === 'lg' ? 17 : size === 'sm' ? 14 : 15

  return (
    <Animated.View style={[{ transform: [{ scale }] }, fullWidth && styles.full, style, isDisabled && styles.disabled]}>
      {raised ? <View pointerEvents="none" style={[styles.shadowBar, BUTTON_CORNERS, { backgroundColor: palette.shadow }]} /> : null}
      <Pressable
        testID={testID}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        disabled={isDisabled}
        onPressIn={() => press(true)}
        onPressOut={() => press(false)}
        onPress={() => {
          if (variant === 'primary' || variant === 'danger') void Haptics.selectionAsync()
          onPress?.()
        }}
        style={[
          styles.button,
          BUTTON_CORNERS,
          { height: HEIGHT[size], minWidth: 44, paddingHorizontal: size === 'sm' ? 11 : 14, backgroundColor: palette.bg, borderColor: palette.border },
          variant === 'secondary' && { borderBottomWidth: 2 },
          fullWidth && styles.full
        ]}
      >
        {loading ? <ActivityIndicator size="small" color={palette.ink} /> : icon}
        <Text
          numberOfLines={2}
          style={[styles.label, { color: palette.ink, fontFamily: fonts.bodySemibold, fontSize }] as StyleProp<TextStyle>}
        >
          {children}
        </Text>
      </Pressable>
    </Animated.View>
  )
}

interface IconButtonProps {
  label: string
  onPress?: () => void
  children: React.ReactNode
  disabled?: boolean
  active?: boolean
  style?: StyleProp<ViewStyle>
}

/** A 42 dp square icon control with an accessible name, used in headers and toolbars. */
export function IconButton({ label, onPress, children, disabled = false, active = false, style }: IconButtonProps) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.icon,
        { borderColor: active ? colors.lineStrong : 'transparent', backgroundColor: pressed || active ? colors.paperMuted : 'transparent' },
        disabled && styles.disabled,
        style
      ]}
    >
      <View>{children}</View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, overflow: 'hidden' },
  shadowBar: { position: 'absolute', left: 0, right: 0, top: 3, bottom: -3 },
  label: { textAlign: 'center', flexShrink: 1 },
  full: { width: '100%' },
  disabled: { opacity: 0.45 },
  icon: { width: 42, height: 42, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }
})
