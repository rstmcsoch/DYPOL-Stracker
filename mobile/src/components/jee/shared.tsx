import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Check, Circle, CircleDashed } from '../icons'
import { useTheme } from '../../contexts/AppearanceContext'
import type { StageState } from '../../shared/lib/jee/progress'
import type { Chapter, Subject } from '../../shared/types'
import { Chip, SelectField } from '../ui/Forms'
import { StatusBadge } from '../ui/Surfaces'

/** Horizontal chip filter. Every chip is a 42dp touch target. */
export function ChipFilter<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  const theme = useTheme()
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: 6 }}>
      <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11 }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
        {options.map(option => (
          <Chip key={option.value} label={option.label} selected={value === option.value} onPress={() => onChange(option.value)} />
        ))}
      </ScrollView>
    </View>
  )
}

/** The five-stage chapter pipeline as wrapping tokens. */
export function StagePipeline({ stages, compact = false }: { stages: StageState[]; compact?: boolean }) {
  const theme = useTheme()
  return (
    <View accessibilityLabel="Chapter stages" style={styles.pipeline}>
      {stages.map(stage => {
        const partial = !stage.done && stage.progress > 0
        const Icon = stage.done ? Check : partial ? CircleDashed : Circle
        const sourceNote = stage.source === 'evidence' ? 'from your records' : stage.source === 'manual' ? 'marked by you' : stage.source === 'partial' ? 'in progress' : 'not yet'
        const tint = stage.done ? theme.colors.green : partial ? theme.colors.orange : theme.colors.muted
        return (
          <View
            key={stage.key}
            accessibilityLabel={`${stage.label}: ${stage.done ? 'complete' : partial ? 'in progress' : 'not started'}, ${sourceNote}`}
            style={[styles.stage, { borderColor: theme.colors.line, backgroundColor: stage.done ? theme.colors.greenBg : theme.colors.paperSoft }, compact && styles.stageCompact]}
          >
            <Icon size={12} color={tint} />
            <Text style={[theme.type.badge, { color: theme.colors.inkSoft }]}>{stage.label}</Text>
            {stage.key === 'pyqs' && stage.progress > 0 ? <Text style={[theme.type.badge, { color: theme.colors.muted }]}>{Math.round(stage.progress * 100)}%</Text> : null}
          </View>
        )
      })}
    </View>
  )
}

export function EvidenceNote({ children }: { children: ReactNode }) {
  const theme = useTheme()
  return <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>{children}</Text>
}

/** A horizontal meter. A null value shows an empty track, and the label is announced as a progress bar. */
export function Meter({ value, label, tone = 'blue' }: { value: number | null; label: string; tone?: 'blue' | 'green' | 'orange' | 'muted' }) {
  const theme = useTheme()
  const safe = value === null ? 0 : Math.max(0, Math.min(100, value))
  const color = tone === 'green' ? theme.colors.green : tone === 'orange' ? theme.colors.orange : tone === 'muted' ? theme.colors.muted : theme.colors.accent
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: value === null ? undefined : Math.round(safe), text: value === null ? 'No data' : `${Math.round(safe)} percent` }}
      style={[styles.meter, { backgroundColor: theme.colors.ringTrack }]}
    >
      <View style={{ width: `${safe}%`, height: '100%', backgroundColor: color, borderRadius: 999 }} />
    </View>
  )
}

export function Pct({ value, digits = 0 }: { value: number | null | undefined; digits?: number }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <>—</>
  return <>{value.toFixed(digits)}%</>
}

export function SourceTag({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'good' | 'warn' | 'bad' | 'info' }) {
  return <StatusBadge tone={tone}>{children}</StatusBadge>
}

export function minutesLabel(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—'
  const safe = Math.max(0, Math.round(minutes))
  const hours = Math.floor(safe / 60)
  const mins = safe % 60
  return hours ? `${hours}h ${String(mins).padStart(2, '0')}m` : `${mins}m`
}

/** Parse a whole-number form field. Returns NaN for blank or non-integer input so validation can reject it. */
export function wholeNumber(value: string): number {
  if (value.trim() === '') return Number.NaN
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : Number.NaN
}

export function uuidOrNull(value: string): string | null {
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null
}

const styles = StyleSheet.create({
  pipeline: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  stage: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  stageCompact: { paddingVertical: 2 },
  meter: { height: 8, borderRadius: 999, overflow: 'hidden' }
})

/** Subject picker with an optional "all subjects" choice. */
export function SubjectSelect({ value, onChange, allowAll = true, label = 'Subject' }: {
  value: string
  onChange: (value: string) => void
  allowAll?: boolean
  label?: string
}) {
  const options = [
    ...(allowAll ? [{ value: 'all', label: 'All subjects' }] : []),
    { value: 'Physics', label: 'Physics' },
    { value: 'Chemistry', label: 'Chemistry' },
    { value: 'Maths', label: 'Maths' }
  ]
  return <SelectField<string> label={label} value={value} options={options} onChange={onChange} />
}

/** Chapter picker, grouped by subject through each option's description. */
export function ChapterSelect({ chapters, value, onChange, subject, label = 'Chapter', allowNone = false, noneLabel = 'All chapters' }: {
  chapters: Chapter[]
  value: string
  onChange: (value: string) => void
  subject?: Subject | 'all' | ''
  label?: string
  allowNone?: boolean
  noneLabel?: string
}) {
  const visible = chapters.filter(chapter => !subject || subject === 'all' || chapter.subject === subject)
  const options = [
    ...(allowNone ? [{ value: '', label: noneLabel }] : [{ value: '', label: 'Choose a chapter' }]),
    ...visible.map(chapter => ({ value: chapter.id, label: chapter.name, description: chapter.subject }))
  ]
  return <SelectField<string> label={label} value={value} options={options} onChange={onChange} />
}
