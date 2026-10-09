import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Switch, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from '../icons'
import { useTheme } from '../../contexts/AppearanceContext'
import { Sheet } from './Overlays'
import { BUTTON_CORNERS } from './notebook'

interface FieldProps {
  label: string
  hint?: string
  error?: string | null
  required?: boolean
  children: ReactNode
  style?: StyleProp<ViewStyle>
}

/** Label, control, hint, and error for one form row. Errors are announced to screen readers. */
export function Field({ label, hint, error, required, children, style }: FieldProps) {
  const { colors, type } = useTheme()
  return (
    <View style={[styles.field, style]}>
      <Text style={[type.label, { color: colors.inkSoft }]}>
        {label}
        {required ? <Text style={{ color: colors.red }}> *</Text> : null}
      </Text>
      {children}
      {hint && !error ? <Text style={[type.caption, { color: colors.muted, fontSize: 13 }]}>{hint}</Text> : null}
      {error ? <Text accessibilityLiveRegion="polite" style={[type.caption, { color: colors.red, fontSize: 13 }]}>{error}</Text> : null}
    </View>
  )
}

export function inputStyle(theme: ReturnType<typeof useTheme>, invalid = false) {
  return {
    minHeight: 46,
    borderWidth: 1,
    borderColor: invalid ? theme.colors.red : theme.colors.lineStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.ink,
    backgroundColor: theme.colors.paperSoft,
    fontFamily: theme.fonts.body,
    fontSize: 16
  } as const
}

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string
  hint?: string
  error?: string | null
  required?: boolean
  containerStyle?: StyleProp<ViewStyle>
  /** Optional icon or control drawn inside the field, before the text. */
  leading?: ReactNode
  /** Optional control drawn inside the field, after the text (for example a show-password toggle). */
  trailing?: ReactNode
}

export function TextField({ label, hint, error, required, containerStyle, multiline, leading, trailing, ...input }: TextFieldProps) {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  const focusBorder = focused ? { borderColor: theme.colors.accent } : null
  const handleFocus: TextInputProps['onFocus'] = event => { setFocused(true); input.onFocus?.(event) }
  const handleBlur: TextInputProps['onBlur'] = event => { setFocused(false); input.onBlur?.(event) }
  if (leading || trailing) {
    return (
      <Field label={label} hint={hint} error={error} required={required} style={containerStyle}>
        <View style={[inputShellStyle(theme, Boolean(error)), focusBorder]}>
          {leading}
          <TextInput
            accessibilityLabel={label}
            placeholderTextColor={theme.colors.muted}
            onFocus={handleFocus}
            onBlur={handleBlur}
            style={[styles.bare, { color: theme.colors.ink, fontFamily: theme.fonts.body, fontSize: theme.type.body.fontSize }]}
            {...input}
          />
          {trailing}
        </View>
      </Field>
    )
  }
  return (
    <Field label={label} hint={hint} error={error} required={required} style={containerStyle}>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.colors.muted}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={[inputStyle(theme, Boolean(error)), multiline && { minHeight: 96 }, focusBorder]}
        {...input}
      />
    </Field>
  )
}

/** Container for an input with an icon or toggle inside it. The text input itself is borderless. */
export function inputShellStyle(theme: ReturnType<typeof useTheme>, invalid = false): ViewStyle {
  return {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingLeft: 13,
    paddingRight: 6,
    borderRadius: theme.radius.input,
    borderWidth: 1.5,
    borderColor: invalid ? theme.colors.red : theme.colors.lineStrong,
    backgroundColor: theme.colors.paper
  }
}

export interface SelectOption<T extends string> { value: T; label: string; description?: string }

export function SelectField<T extends string>({ label, value, options, onChange, hint, error, required }: {
  label: string; value: T; options: readonly SelectOption<T>[]; onChange: (value: T) => void; hint?: string; error?: string | null; required?: boolean
}) {
  const { colors, type } = useTheme()
  const [open, setOpen] = useState(false)
  const current = options.find(option => option.value === value)
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? value}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.select, BUTTON_CORNERS, { borderColor: colors.lineStrong, backgroundColor: pressed ? colors.paperMuted : colors.paperSoft }]}
      >
        <Text style={[type.body, { color: colors.ink, flex: 1 }]} numberOfLines={1}>{current?.label ?? value}</Text>
        <ChevronDown size={18} color={colors.muted} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        <View style={{ gap: 6 }}>
          {options.map(option => {
            const selected = option.value === value
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => { onChange(option.value); setOpen(false) }}
                style={({ pressed }) => [styles.option, BUTTON_CORNERS, {
                  borderColor: selected ? colors.accent : colors.line,
                  backgroundColor: selected ? colors.accentLight : pressed ? colors.paperMuted : colors.paper
                }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: colors.ink, fontWeight: '600' }]}>{option.label}</Text>
                  {option.description ? <Text style={[type.caption, { color: colors.muted }]}>{option.description}</Text> : null}
                </View>
                {selected ? <Text style={{ color: colors.accentDark, fontSize: 16 }}>✓</Text> : null}
              </Pressable>
            )
          })}
        </View>
      </Sheet>
    </Field>
  )
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) }
}

function isoOf(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Calendar date control. Dates are stored as YYYY-MM-DD strings, exactly like the website's date
 * inputs, so the value round-trips through the same validators. Typing a date is also accepted.
 */
export function DateField({ label, value, onChange, hint, error, required, allowClear = true, minDate, maxDate }: {
  label: string; value: string; onChange: (value: string) => void; hint?: string; error?: string | null; required?: boolean
  allowClear?: boolean; minDate?: string; maxDate?: string
}) {
  const theme = useTheme()
  const { colors, type } = theme
  const [open, setOpen] = useState(false)
  const initial = parseIsoDate(value) ?? parseIsoDate(new Date().toISOString().slice(0, 10))!
  const [view, setView] = useState({ year: initial.year, month: initial.month })
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(view.year, view.month, 1))
    const offset = (first.getUTCDay() + 6) % 7
    const days = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate()
    return [...Array(offset).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)] as (number | null)[]
  }, [view])
  const selected = parseIsoDate(value)
  const todayIso = new Date().toISOString().slice(0, 10)

  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <View style={styles.dateRow}>
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          style={[inputStyle(theme, Boolean(error)), { flex: 1 }]}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={`Pick ${label}`} onPress={() => { const base = parseIsoDate(value) ?? initial; setView({ year: base.year, month: base.month }); setOpen(true) }} style={[styles.dateButton, BUTTON_CORNERS, { borderColor: colors.lineStrong, backgroundColor: colors.paperSoft }]}>
          <CalendarDays size={20} color={colors.accentDark} />
        </Pressable>
        {allowClear && value ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label}`} onPress={() => onChange('')} style={[styles.dateButton, BUTTON_CORNERS, { borderColor: colors.lineStrong }]}>
            <X size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        <View style={styles.calendarHead}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setView(current => current.month === 0 ? { year: current.year - 1, month: 11 } : { year: current.year, month: current.month - 1 })} style={styles.dateButton}>
            <ChevronLeft size={20} color={colors.ink} />
          </Pressable>
          <Text style={[type.h3, { color: colors.ink }]}>{MONTHS[view.month]} {view.year}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setView(current => current.month === 11 ? { year: current.year + 1, month: 0 } : { year: current.year, month: current.month + 1 })} style={styles.dateButton}>
            <ChevronRight size={20} color={colors.ink} />
          </Pressable>
        </View>
        <View style={styles.weekRow}>
          {WEEKDAYS.map(day => <Text key={day} style={[type.caption, { color: colors.muted, width: '14.28%', textAlign: 'center' }]}>{day}</Text>)}
        </View>
        <View style={styles.grid}>
          {cells.map((day, index) => {
            if (day === null) return <View key={`blank-${index}`} style={styles.cell} />
            const iso = isoOf(view.year, view.month, day)
            const disabled = (minDate !== undefined && iso < minDate) || (maxDate !== undefined && iso > maxDate)
            const isSelected = Boolean(selected && iso === value)
            const isToday = iso === todayIso
            return (
              <Pressable
                key={iso}
                accessibilityRole="button"
                accessibilityLabel={iso}
                accessibilityState={{ selected: isSelected, disabled }}
                disabled={disabled}
                onPress={() => { onChange(iso); setOpen(false) }}
                style={[styles.cell, styles.dayCell, {
                  backgroundColor: isSelected ? colors.accentDark : 'transparent',
                  borderColor: isToday ? colors.accent : 'transparent',
                  opacity: disabled ? 0.35 : 1
                }]}
              >
                <Text style={[type.body, { color: isSelected ? colors.buttonPrimaryInk : colors.ink, fontSize: 15 }]}>{day}</Text>
              </Pressable>
            )
          })}
        </View>
        <Pressable accessibilityRole="button" onPress={() => { onChange(todayIso); setOpen(false) }} style={[styles.todayButton, BUTTON_CORNERS, { borderColor: colors.lineStrong }]}>
          <Text style={[type.button, { color: colors.inkSoft }]}>Today</Text>
        </Pressable>
      </Sheet>
    </Field>
  )
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void; label: string }) {
  const { colors, type } = useTheme()
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.segmented, BUTTON_CORNERS, { borderColor: colors.lineStrong, backgroundColor: colors.paperSoft }]}>
      {options.map(option => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, BUTTON_CORNERS, selected && { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.lineStrong }]}
          >
            <Text style={[type.button, { color: selected ? colors.ink : colors.muted, fontSize: 14 }]} numberOfLines={1}>{option.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function Chip({ label, selected, onPress, tint }: { label: string; selected: boolean; onPress: () => void; tint?: string }) {
  const { colors, type } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, { borderColor: selected ? (tint ?? colors.accent) : colors.line, backgroundColor: selected ? colors.accentLight : colors.paper }]}
    >
      <Text style={[type.caption, { color: selected ? colors.accentDark : colors.inkSoft, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  )
}

export function SwitchRow({ label, description, value, onValueChange, disabled }: { label: string; description?: string; value: boolean; onValueChange: (value: boolean) => void; disabled?: boolean }) {
  const { colors, type } = useTheme()
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { color: colors.ink, fontWeight: '600' }]}>{label}</Text>
        {description ? <Text style={[type.caption, { color: colors.muted }]}>{description}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.ringTrack, true: colors.accent }}
        thumbColor={colors.paper}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  bare: { flex: 1, minHeight: 46, paddingVertical: 10 },
  field: { gap: 7, minWidth: 0 },
  select: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent', borderRadius: 10 },
  calendarHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  dayCell: { borderRadius: 999, borderWidth: 1 },
  todayButton: { marginTop: 12, minHeight: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  segmented: { flexDirection: 'row', borderWidth: 1, padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, borderWidth: 1, borderColor: 'transparent' },
  chip: { minHeight: 34, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 }
})
